/* ship-staleness.test.mjs — offline acceptance for the M2 Stop-hook ship
   gate, redesigned 2026-07-04 to a content-hash predicate (KNOWN_EDGES.md).
   Spawns the real CLIs (ship-staleness.mjs, and ship-stamp.mjs to produce
   fixtures) inside deterministic fixture repos, and proves every
   allow/deny branch — including the map-neutral case that motivated the
   redesign: a stamp update with NO map diff must still be committable and
   must still flip the gate to allow. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, 'ship-staleness.mjs');
const STAMP_CLI = join(HERE, '..', 'verify', 'ship-stamp.mjs');

function gate(cwd, payload = {}) {
  const run = spawnSync('node', [CLI], {
    cwd, encoding: 'utf8', input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, NOVAKAI_ROOT: cwd },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** Runs the real stamp writer against a fixture repo (working-tree-aware:
    it hashes whatever is on disk under src/ right now, committed or not). */
function ship(cwd) {
  const run = spawnSync('node', [STAMP_CLI], { cwd, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: cwd } });
  assert.equal(run.status, 0, `ship-stamp.mjs failed: ${run.stdout}${run.stderr}`);
}

/** T0 content: one src file + one map file, the pair every fixture starts from. */
function seedFiles(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'novakai'), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.ts'), 'export {};\n');
  writeFileSync(join(dir, 'docs', 'novakai', '_bundle.mmd'), 'flowchart LR\n');
}

/** Fixture repo: src + map (+ optionally a ship-stamp) committed together
    at T0; then optionally more src changes, committed or left dirty. */
function mkrepo({ withStamp = true, staleCommit = false, dirty = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ship-stale-'));
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  seedFiles(dir);
  if (withStamp) ship(dir); // records the current (T0) src content
  execSync('git add -A && git commit -qm base', { cwd: dir });
  if (staleCommit) {
    appendFileSync(join(dir, 'src', 'main.ts'), '// change\n');
    execSync('git add -A && git commit -qm code-only', { cwd: dir });
  }
  if (dirty) appendFileSync(join(dir, 'src', 'main.ts'), '// wip\n');
  return dir;
}

function readLog(dir) {
  const logPath = join(dir, 'docs', 'novakai', 'metrics', 'session-log.jsonl');
  try {
    return readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

test('ALLOW: stamp matches committed src content (exit 0)', () => {
  const dir = mkrepo();
  try {
    assert.equal(gate(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: src committed after the stamp blocks the stop (exit 2, names novakai:ship)', () => {
  const dir = mkrepo({ staleCommit: true });
  try {
    const result = gate(dir);
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /novakai:ship/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: uncommitted src changes since the stamp block the stop (exit 2)', () => {
  const dir = mkrepo({ dirty: true });
  try {
    assert.equal(gate(dir).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: no stamp has ever been recorded (bootstrap) blocks the stop (exit 2)', () => {
  const dir = mkrepo({ withStamp: false });
  try {
    assert.equal(gate(dir).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test(
  'ALLOW: map-neutral re-ship — stamp updated to match new src, map diff is zero, stamp not yet committed (exit 0)',
  () => {
    // This is the exact edge the redesign targets: a src change whose
    // regenerated map is byte-identical has NO map diff to commit, so a
    // timestamp-based predicate could never be satisfied again. The stamp
    // always has something to write (the new hash), and the gate reads it
    // straight off the working tree — no commit required to pass.
    const dir = mkrepo({ staleCommit: true });
    try {
      assert.equal(gate(dir).status, 2, 'precondition: stale before re-ship');
      ship(dir); // novakai:ship reruns; ship-stamp.json now dirty (uncommitted) but current
      assert.equal(gate(dir).status, 0, 'stamp read from the working tree, not git history');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
);

test(
  'ship-stamp.json is content-only and write-if-different: '
    + 'two consecutive ships with unchanged src leave it byte-identical',
  () => {
    const dir = mkrepo();
    const stampPath = join(dir, 'docs', 'novakai', 'ship-stamp.json');
    try {
      const before = readFileSync(stampPath, 'utf8');
      assert.doesNotMatch(before, /shippedAt/, 'stamp must not carry a wall-clock field');
      ship(dir); // re-run novakai:ship with no src change
      const after = readFileSync(stampPath, 'utf8');
      assert.equal(after, before, 'unchanged src must produce a byte-identical stamp (ship idempotency)');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },
);

test('ALLOW (anti-loop): stop_hook_active suppresses the gate even when stale (exit 0)', () => {
  const dir = mkrepo({ staleCommit: true });
  try {
    assert.equal(gate(dir, { stop_hook_active: true }).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW (fail-open): not a git repository — the gate must not wedge the stop (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ship-nogit-'));
  try {
    assert.equal(gate(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: malformed stdin is tolerated — the git checks still decide (exit 0 on fresh repo)', () => {
  const dir = mkrepo();
  try {
    assert.equal(gate(dir, 'not json').status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M2b: the block/fresh decisions are metered; the anti-loop passthrough is NOT (exit codes unchanged)', () => {
  const stale = mkrepo({ staleCommit: true });
  const fresh = mkrepo();
  try {
    assert.equal(gate(stale).status, 2, 'the deny exit code is untouched by telemetry');
    assert.equal(gate(stale, { stop_hook_active: true }).status, 0);
    assert.equal(gate(fresh).status, 0, 'the allow exit code is untouched by telemetry');
    const staleEvents = readLog(stale);
    assert.deepEqual(staleEvents.map((line) => [line.gate, line.decision]), [['ship-staleness', 'deny']],
      'one deny recorded; the stop_hook_active passthrough is not a decision');
    assert.deepEqual(readLog(fresh).map((line) => [line.gate, line.decision]), [['ship-staleness', 'allow']]);
  } finally {
    rmSync(stale, { recursive: true, force: true });
    rmSync(fresh, { recursive: true, force: true });
  }
});
