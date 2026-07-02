/* edit-gate.test.mjs — offline acceptance for the M2 Edit|Write quiz-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin against fixture checkouts (FLOWMAP_ROOT seam), independent of the
   live session's own quiz state. Same harness pattern as contract-gate.test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256hex } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'edit-gate.mjs');

function gate(payload, env = {}) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Fixture checkout: the real map's bytes, plus a quiz pass in one of three
    states — 'none' (never taken), 'valid' (bound to these map bytes), or
    'stale' (bound to a different map). */
function mkroot({ pass = 'none' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edit-gate-'));
  mkdirSync(join(dir, 'docs', 'flowmap'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  const mapBytes = readFileSync(join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
  writeFileSync(join(dir, 'docs', 'flowmap', '_bundle.mmd'), mapBytes);
  if (pass !== 'none') {
    writeFileSync(join(dir, '.flowmap-quiz-pass.json'), JSON.stringify({
      map: 'docs/flowmap/_bundle.mmd', seed: 1, n: 12, score: '12/12',
      mapHash: pass === 'valid' ? sha256hex(mapBytes) : sha256hex(Buffer.from('other map')),
    }) + '\n');
  }
  return dir;
}

test('ALLOW: a non-Edit/Write tool is never gated (exit 0)', () => {
  const r = gate({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  assert.equal(r.status, 0);
});

test('DENY (fail-closed): malformed stdin cannot be verified, so it blocks (exit 2)', () => {
  const r = gate('not json at all');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"deny"/);
});

test('DENY (fail-closed): Edit payload with no file_path cannot be scoped (exit 2)', () => {
  const r = gate({ tool_name: 'Edit', tool_input: {} });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /file_path/);
});

test('ALLOW: an edit OUTSIDE src/ is ungated by design (exit 0, even with no quiz pass)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'tools', 'x.mjs') } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a src/ edit with NO quiz pass blocks with the re-take instruction (exit 2)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'main.ts') } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"decision":"deny"/);
    assert.match(r.stdout, /quiz/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a src/ edit with a STALE quiz pass (map changed since scoring) blocks (exit 2)', () => {
  const dir = mkroot({ pass: 'stale' });
  try {
    const r = gate({ tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'new.ts') } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /stale/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: a src/ edit with a quiz pass bound to the CURRENT map bytes (exit 0)', () => {
  const dir = mkroot({ pass: 'valid' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'main.ts') } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: Write outside src/ passes through (exit 0)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Write', tool_input: { file_path: join(dir, 'docs', 'notes.md') } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
