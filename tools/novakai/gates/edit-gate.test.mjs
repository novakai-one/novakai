/* edit-gate.test.mjs — offline acceptance for the M2 Edit|Write quiz-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin against fixture checkouts (NOVAKAI_ROOT seam), independent of the
   live session's own quiz state. Same harness pattern as contract-gate.test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256hex } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'edit-gate.mjs');

// M2b: default metrics sink for calls that pass no fixture root, so fixture
// decisions never append to the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'edit-gate-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));

function gate(payload, env = {}) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: SINK, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Fixture checkout: the real map's bytes, plus a quiz pass in one of three
    states — 'none' (never taken), 'valid' (bound to these map bytes), or
    'stale' (bound to a different map). */
function mkroot({ pass = 'none' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edit-gate-'));
  mkdirSync(join(dir, 'docs', 'novakai'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  const mapBytes = readFileSync(join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  writeFileSync(join(dir, 'docs', 'novakai', '_bundle.mmd'), mapBytes);
  if (pass !== 'none') {
    writeFileSync(join(dir, '.novakai-quiz-pass.json'), JSON.stringify({
      map: 'docs/novakai/_bundle.mmd', seed: 1, n: 12, score: '12/12',
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
  assert.match(r.stdout, /"decision":"block"/);
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
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a src/ edit with NO quiz pass blocks with the re-take instruction (exit 2)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'main.ts') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"decision":"block"/);
    assert.match(r.stdout, /quiz/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a src/ edit with a STALE quiz pass (map changed since scoring) blocks (exit 2)', () => {
  const dir = mkroot({ pass: 'stale' });
  try {
    // Existing file — the new-file bootstrap exemption (below) must not apply
    // here; staleness must still gate a Write to a file the map already covers.
    const existing = join(dir, 'src', 'new.ts');
    writeFileSync(existing, '// already here\n');
    const r = gate({ tool_name: 'Write', tool_input: { file_path: existing } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /stale/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: a src/ edit with a quiz pass bound to the CURRENT map bytes (exit 0)', () => {
  const dir = mkroot({ pass: 'valid' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'main.ts') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: Write outside src/ passes through (exit 0)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Write', tool_input: { file_path: join(dir, 'docs', 'notes.md') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- new-file bootstrap (chicken-and-egg: a brand-new src/ file has
   no fragment yet, so a scoped quiz verify can never pass for it). Only
   Write to a path ABSENT from disk is exempted; Edit never is, and a Write
   to a path that already exists must still clear the quiz gate. ---------- */

test('ALLOW: Write to a NONEXISTENT src/ path bootstraps past the gate (exit 0, no quiz pass)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Write', tool_input: { file_path: join(dir, 'src', 'brand-new.ts') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: Write to an EXISTING src/ path still requires the quiz pass (exit 2)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const existing = join(dir, 'src', 'main.ts');
    writeFileSync(existing, '// already here\n');
    const r = gate({ tool_name: 'Write', tool_input: { file_path: existing } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"decision":"block"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: Edit to a NONEXISTENT src/ path is NOT exempted — only Write is (exit 2)', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const r = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'brand-new.ts') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"decision":"block"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M2b: decisions are metered into the fixture log — exit codes unchanged', () => {
  const dir = mkroot({ pass: 'none' });
  try {
    const d = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'src', 'main.ts') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(d.status, 2, 'the deny exit code is untouched by telemetry');
    const a = gate({ tool_name: 'Edit', tool_input: { file_path: join(dir, 'docs', 'notes.md') } },
      { NOVAKAI_ROOT: dir });
    assert.equal(a.status, 0, 'the allow exit code is untouched by telemetry');
    const log = join(dir, 'docs', 'novakai', 'metrics', 'session-log.jsonl');
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => [l.event, l.gate, l.decision]),
      [['gate', 'edit', 'deny'], ['gate', 'edit', 'allow']]);
    assert.match(lines[0].target, /src/, 'the deny names its target');
    assert.match(lines[0].reason, /quiz/i, 'the logged reason is the printed reason');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- onboard-cost item 4 (session-bound pass; design:
   docs/novakai/onboard-cost-design.md). The gate forwards the payload's
   session_id to `quiz verify --session`; a sessionless payload keeps the
   flagless hash-only path (pinned above by the pre-item-4 cases). ---------- */

function mkrootSession(session) {
  const dir = mkroot({ pass: 'valid' });
  const p = join(dir, '.novakai-quiz-pass.json');
  const pass = JSON.parse(readFileSync(p, 'utf8'));
  if (session !== undefined) pass.session = session;
  writeFileSync(p, JSON.stringify(pass) + '\n');
  return dir;
}

test('session ALLOW: payload session matches the pass artifact session (exit 0)', () => {
  const dir = mkrootSession('sess-1');
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/anything.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('session DENY: payload session differs from the pass artifact session (exit 2)', () => {
  const dir = mkrootSession('sess-1');
  const r = gate({ tool_name: 'Edit', session_id: 'sess-2',
    tool_input: { file_path: 'src/anything.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
  assert.match(r.stdout, /session/i);
});

test('session DENY (fail closed): an anonymous/legacy pass cannot be claimed by a session (exit 2)', () => {
  const dir = mkroot({ pass: 'valid' }); // artifact carries no session field
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/anything.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
});

/* ---------- onboard-cost item 2 (per-module staleness through the gate).
   Fixture: camera --> wires edge, state unrelated; per-fragment v2 artifact.
   The legacy mkroot fixtures above stay green via the documented pre-v2
   fallback (whole-map semantics for artifacts without `fragments`). ---------- */

const FRAG_MMD = `flowchart TD
  camera["camera"]
  wires["wires"]
  state["state"]
  camera__toWorld("toWorld")
  camera --> wires
%% kind camera module
%% kind wires module
%% kind state module
%% kind camera__toWorld function
%% src camera__toWorld src/core/camera/camera.ts#toWorld
%% src wires src/render/wires.ts
%% src state src/core/state/state.ts
`;

function mkrootFrag({ session = 'sess-1' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edit-gate-frag-'));
  mkdirSync(join(dir, 'docs', 'novakai'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'novakai', '_bundle.mmd'), FRAG_MMD);
  const fragments = {};
  for (const [mod, rel] of [
    ['camera', 'src/core/camera/camera.novakai.mmd'],
    ['wires', 'src/render/wires.novakai.mmd'],
    ['state', 'src/core/state/state.novakai.mmd'],
  ]) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    const bytes = `%% root ${mod}\nflowchart TD\n  ${mod}["${mod}"]\n`;
    writeFileSync(join(dir, rel), bytes);
    fragments[mod] = sha256hex(Buffer.from(bytes));
  }
  writeFileSync(join(dir, '.novakai-quiz-pass.json'), JSON.stringify({
    v: 2, map: 'docs/novakai/_bundle.mmd', seed: 1, n: 4, score: '4/4',
    mapHash: sha256hex(Buffer.from(FRAG_MMD)), session, scope: 'all', fragments,
  }) + '\n');
  return dir;
}

test('module ALLOW: fresh module + fresh neighbours pass the gate (exit 0)', () => {
  const dir = mkrootFrag();
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/core/camera/camera.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('module DENY: a stale direct edge-neighbour blocks the edit and is named (exit 2)', () => {
  const dir = mkrootFrag();
  writeFileSync(join(dir, 'src/render/wires.novakai.mmd'),
    `%% root wires\nflowchart TD\n  wires["wires CHANGED"]\n`);
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/core/camera/camera.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
  assert.match(r.stdout, /wires/);
});

test('module ALLOW: an unrelated stale module does not block (exit 0)', () => {
  const dir = mkrootFrag();
  writeFileSync(join(dir, 'src/core/state/state.novakai.mmd'),
    `%% root state\nflowchart TD\n  state["state CHANGED"]\n`);
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/core/camera/camera.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('module DENY (fail closed): a src file the map cannot account for blocks (exit 2)', () => {
  const dir = mkrootFrag();
  const r = gate({ tool_name: 'Edit', session_id: 'sess-1',
    tool_input: { file_path: 'src/unmapped/mystery.ts' } }, { NOVAKAI_ROOT: dir });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
});

/* ---------- C2: subagent contract-scope branch (payload carries agent_id).
   Hermetic via three seams: NOVAKAI_ROOT (fixture root + metrics sink),
   NOVAKAI_CONTRACT_CMD (a fixture packet emitter — no real plan needed), and
   a transcript file we control. The main-agent cases above run with no
   agent_id and prove that path is byte-for-byte unchanged. ---------- */

// A stand-in contract.mjs: ignores args, prints a packet whose editScope
// allows `allowed/**` and denies FROZEN (matching scope.mjs).
const FAKE_CONTRACT = join(SINK, 'fake-contract.mjs');
writeFileSync(FAKE_CONTRACT, `
process.stdout.write(JSON.stringify({
  coherent: true,
  editScope: { allow: ['allowed/**'], deny: [
    'tools/novakai/gates/**', '.claude/settings.json',
    'src/main.ts', 'src/ide/shell.ts', 'src/ide/pages.ts', 'css/styles.css',
  ] },
}) + '\\n');
`);

/** A subagent fixture root with a transcript that does/doesn't carry the sentinel. */
function mksub({ sentinel = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'edit-gate-sub-'));
  const tp = join(dir, 'agent.jsonl');
  writeFileSync(tp, sentinel
    ? '{"role":"user","content":"Implement this. NOVAKAI-CONTRACT:some-change"}\n'
    : '{"role":"user","content":"go read the code and summarise"}\n');
  return { dir, tp };
}

function subGate({ target, sentinel = true, transcript }) {
  const { dir, tp } = mksub({ sentinel });
  try {
    return gate({
      tool_name: 'Edit', agent_id: 'sub-a1',
      transcript_path: transcript === undefined ? tp : transcript,
      tool_input: { file_path: target },
    }, { NOVAKAI_ROOT: dir, NOVAKAI_CONTRACT_CMD: FAKE_CONTRACT });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// A stand-in that exits 3 unless it received the CLEAN plan path — proves PLAN_TAG
// extraction from a JSONL head where the newline after the tag is two literal chars \n.
const PICKY_CONTRACT = join(SINK, 'picky-contract.mjs');
writeFileSync(PICKY_CONTRACT, `
const i = process.argv.indexOf('--plan');
const plan = i > -1 ? process.argv[i + 1] : '(none)';
if (plan !== 'docs/novakai/plans/x.plan.json') { process.stderr.write('bad plan: ' + plan); process.exit(3); }
process.stdout.write(JSON.stringify({ coherent: true, editScope: { allow: ['allowed/**'], deny: [] } }) + '\\n');
`);

test('C2 subagent PLAN_TAG: JSONL-escaped newline after the plan path does not pollute the path (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'edit-gate-plan-'));
  const tp = join(dir, 'agent.jsonl');
  // exactly how a real transcript encodes "NOVAKAI-PLAN:<path>\nRegenerate ..." — \n here is two chars
  writeFileSync(tp, '{"role":"user","content":"NOVAKAI-CONTRACT:some-change\\nNOVAKAI-PLAN:docs/novakai/plans/x.plan.json\\nRegenerate the packet"}\n');
  try {
    const r = gate({
      tool_name: 'Edit', agent_id: 'sub-a1', transcript_path: tp,
      tool_input: { file_path: 'allowed/mod.ts' },
    }, { NOVAKAI_ROOT: dir, NOVAKAI_CONTRACT_CMD: PICKY_CONTRACT });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout, /"decision":"block"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('C2 subagent BLOCK: repo Edit with no contract sentinel names the dispatch remedy (exit 2)', () => {
  const r = subGate({ target: 'src/anything.ts', sentinel: false });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
  assert.match(r.stdout, /novakai:dispatch/);
});

test('C2 subagent BLOCK: a FROZEN deny-glob (.claude/settings.json) is always blocked (exit 2)', () => {
  const r = subGate({ target: '.claude/settings.json' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
  assert.match(r.stdout, /FROZEN/);
});

test('C2 subagent WARN: an out-of-allow target is allowed with a systemMessage (exit 0)', () => {
  const r = subGate({ target: 'src/somewhere/else.ts' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /systemMessage/);
  assert.match(r.stdout, /some-change/);       // names the change id
  assert.match(r.stdout, /else\.ts/);          // names the file
  assert.doesNotMatch(r.stdout, /"decision":"block"/);
});

test('C2 subagent ALLOW: an in-allow target passes cleanly, no warning (exit 0)', () => {
  const r = subGate({ target: 'allowed/mod.ts' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /systemMessage/);
});

test('C2 subagent BLOCK: an unreadable transcript blocks a repo write (exit 2)', () => {
  const r = subGate({ target: 'src/anything.ts', transcript: '/no/such/transcript.jsonl' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"block"/);
});

test('C2 subagent ALLOW: a target OUTSIDE the repo tree is not the contract business (exit 0)', () => {
  const r = subGate({ target: join(tmpdir(), 'outside-file.ts'), sentinel: false });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
