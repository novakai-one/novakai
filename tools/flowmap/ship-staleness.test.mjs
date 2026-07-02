/* ship-staleness.test.mjs — offline acceptance for the M2 Stop-hook ship gate.
   Spawns the real CLI inside deterministic fixture repos (the handoff-fresh
   test pattern) and proves every allow/deny branch. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'ship-staleness.mjs');

function gate(cwd, payload = {}) {
  const r = spawnSync('node', [CLI], {
    cwd, encoding: 'utf8', input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, FLOWMAP_ROOT: cwd },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Fixture repo: src + map committed together at T0; then optionally a
    src-only commit at T1 (staleCode) and/or working-tree edits. */
function mkrepo({ staleCode = false, dirtySrc = false, dirtyMap = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-stale-'));
  const g = (cmd, at) => execSync(cmd, {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  const T0 = '2026-01-01T00:00:00Z', T1 = '2026-01-01T01:00:00Z';
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'flowmap'), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.ts'), 'export {};\n');
  writeFileSync(join(dir, 'docs', 'flowmap', '_bundle.mmd'), 'flowchart LR\n');
  g('git add -A && git commit -qm base', T0);
  if (staleCode) {
    appendFileSync(join(dir, 'src', 'main.ts'), '// change\n');
    g('git add -A && git commit -qm code-only', T1);
  }
  if (dirtySrc) appendFileSync(join(dir, 'src', 'main.ts'), '// wip\n');
  if (dirtyMap) appendFileSync(join(dir, 'docs', 'flowmap', '_bundle.mmd'), '%% resync\n');
  return dir;
}

test('ALLOW: map committed together with the code is fresh (exit 0)', () => {
  const dir = mkrepo();
  try { assert.equal(gate(dir).status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: committed src newer than the committed map blocks the stop (exit 2, names flowmap:ship)', () => {
  const dir = mkrepo({ staleCode: true });
  try {
    const r = gate(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /flowmap:ship/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: uncommitted src changes with an untouched map block the stop (exit 2)', () => {
  const dir = mkrepo({ dirtySrc: true });
  try { assert.equal(gate(dir).status, 2); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: dirty src AND dirty map — a re-sync is in progress (exit 0)', () => {
  const dir = mkrepo({ dirtySrc: true, dirtyMap: true });
  try { assert.equal(gate(dir).status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW (anti-loop): stop_hook_active suppresses the gate even when stale (exit 0)', () => {
  const dir = mkrepo({ staleCode: true });
  try { assert.equal(gate(dir, { stop_hook_active: true }).status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW (fail-open): not a git repository — the gate must not wedge the stop (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-nogit-'));
  try { assert.equal(gate(dir).status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: malformed stdin is tolerated — the git checks still decide (exit 0 on fresh repo)', () => {
  const dir = mkrepo();
  try { assert.equal(gate(dir, 'not json').status, 0); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M2b: the block/fresh decisions are metered; the anti-loop passthrough is NOT (exit codes unchanged)', () => {
  const readLog = (dir) => {
    const p = join(dir, 'docs', 'flowmap', 'metrics', 'session-log.jsonl');
    try { return readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); }
    catch { return []; }
  };
  const stale = mkrepo({ staleCode: true });
  const fresh = mkrepo();
  try {
    assert.equal(gate(stale).status, 2, 'the deny exit code is untouched by telemetry');
    assert.equal(gate(stale, { stop_hook_active: true }).status, 0);
    assert.equal(gate(fresh).status, 0, 'the allow exit code is untouched by telemetry');
    const staleEvents = readLog(stale);
    assert.deepEqual(staleEvents.map((l) => [l.gate, l.decision]), [['ship-staleness', 'deny']],
      'one deny recorded; the stop_hook_active passthrough is not a decision');
    assert.deepEqual(readLog(fresh).map((l) => [l.gate, l.decision]), [['ship-staleness', 'allow']]);
  } finally {
    rmSync(stale, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
  }
});
