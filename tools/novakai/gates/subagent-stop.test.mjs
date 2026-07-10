/* subagent-stop.test.mjs — offline acceptance for the C9 SubagentStop verdict
   hook. Proves it by piping synthetic SubagentStop payloads on stdin against a
   fixture root (NOVAKAI_ROOT), a SHIMMED verify-change (NOVAKAI_VERIFY_CHANGE),
   and a fixed drift base (NOVAKAI_DRIFT_BASE, so no live git). Same harness
   style as edit-gate.test.mjs / contract-gate.test.mjs.

   The hook must NEVER block a stop: every case asserts exit 0. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'subagent-stop.mjs');
const VERDICT_DIR = '.novakai-verdicts';

/** A shim verify-change: emits a canonical verdict on stdout and, when handed
    --drift-out, writes a two-file drift report there — so the hook's verdict
    write + drift-count summary can be proven without the real C6' flags. */
function mkVerifyShim(dir) {
  const shimPath = join(dir, 'verify-shim.mjs');
  writeFileSync(shimPath, `
import { writeFileSync } from 'node:fs';
const arg = (f) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : null; };
const out = arg('--drift-out');
if (out) writeFileSync(out, JSON.stringify({ files: [{ path: 'a.ts' }, { path: 'b.ts' }], frozenHit: false }));
process.stdout.write(JSON.stringify({ verdict: 'PASS_UNPROVEN', change: arg('--change') }) + '\\n');
process.exit(1); // strict PASS_UNPROVEN exits non-zero; the hook must ignore it
`);
  return shimPath;
}

function hook({ payload, transcript, verifyShim = true }) {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-stop-'));
  try {
    const env = { ...process.env, NOVAKAI_ROOT: dir, NOVAKAI_DRIFT_BASE: 'BASE_REF' };
    if (verifyShim) env.NOVAKAI_VERIFY_CHANGE = mkVerifyShim(dir);
    // Materialise the transcript inside the fixture root if a body was given.
    let transcriptPath = payload.agent_transcript_path;
    if (transcript !== undefined) {
      transcriptPath = join(dir, 'agent.jsonl');
      writeFileSync(transcriptPath, transcript);
      payload = { ...payload, agent_transcript_path: transcriptPath };
    }
    const run = spawnSync('node', [CLI], {
      cwd: ROOT, input: JSON.stringify(payload), encoding: 'utf8',
      env, maxBuffer: 32 * 1024 * 1024,
    });
    return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '', dir };
  } finally {
    // caller inspects files before the dir is removed; remove after read below
    // (returning dir lets each test read then clean).
    process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  }
}

test('no sentinel in the transcript -> silent exit 0, no verdict written', () => {
  const result = hook({
    payload: { agent_id: 'a1', hook_event_name: 'SubagentStop' },
    transcript: '{"role":"user","content":"just go read the code and report"}\n',
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '', 'a non-contract subagent produces no output');
  assert.equal(existsSync(join(result.dir, VERDICT_DIR)), false, 'no verdict dir created');
});

test('unparseable stdin -> silent exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-stop-'));
  const result = spawnSync('node', [CLI], { cwd: ROOT, input: 'not json', encoding: 'utf8',
    env: { ...process.env, NOVAKAI_ROOT: dir } });
  rmSync(dir, { recursive: true, force: true });
  assert.equal(result.status, 0);
});

test('missing/unreadable transcript -> silent exit 0', () => {
  const result = hook({ payload: { agent_id: 'a1', agent_transcript_path: '/no/such/file.jsonl' } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), '');
});

test('sentinel present -> shimmed verify-change runs, verdict file written, drift counted (exit 0)', () => {
  const result = hook({
    payload: { agent_id: 'a1', hook_event_name: 'SubagentStop' },
    transcript: '{"role":"user","content":"Implement. NOVAKAI-CONTRACT:my-change"}\n',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  // verdict file materialised from the shim's stdout
  const verdictFile = join(result.dir, VERDICT_DIR, 'my-change.json');
  assert.ok(existsSync(verdictFile), 'verdict file written');
  assert.equal(JSON.parse(readFileSync(verdictFile, 'utf8')).change, 'my-change');
  // non-blocking one-line summary carries the verdict value + drift count
  assert.match(result.stdout, /additionalContext/);
  assert.match(result.stdout, /PASS_UNPROVEN/);
  assert.match(result.stdout, /2 file/);        // the shim wrote a 2-file drift report
  assert.doesNotMatch(result.stdout, /"decision"/, 'the hook never blocks a stop');
});

test('agent_transcript_path is preferred over transcript_path', () => {
  // Only agent_transcript_path carries the sentinel; a bogus transcript_path
  // must not be what the hook reads.
  const result = hook({
    payload: { agent_id: 'a1', transcript_path: '/no/such/main.jsonl', hook_event_name: 'SubagentStop' },
    transcript: '{"role":"user","content":"NOVAKAI-CONTRACT:pref-change"}\n',
  });
  assert.equal(result.status, 0);
  assert.ok(existsSync(join(result.dir, VERDICT_DIR, 'pref-change.json')));
});

test('verify-change itself crashing -> hook still exits 0 (never blocks)', () => {
  // No shim -> spawns the REAL verify-change with a bogus change id; it exits
  // non-zero / errors, but the hook must swallow it.
  const result = hook({
    payload: { agent_id: 'a1', hook_event_name: 'SubagentStop' },
    transcript: '{"role":"user","content":"NOVAKAI-CONTRACT:no-such-change-xyz"}\n',
    verifyShim: false,
  });
  assert.equal(result.status, 0);
});
