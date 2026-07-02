/* roadmap.test.mjs — deny-path acceptance for the roadmap/status computer
   (AUD5 fix for finding F-04, docs/flowmap/audit/04-findings.md).

   roadmap.mjs is the script the whole "status is COMPUTED, never prose" rule
   rests on — CLAUDE.md's roadmap, the audit's phase status, and the
   flowmap:roadmap:audit CI gate. AUD3 proved it had NO test: hard-wiring the
   `file` predicate to true left the suite green (mutation M3 SURVIVED), and
   AUD2 proved a 0-byte file reads BUILT (attack A5).

   Every test here spawns the REAL CLI (the AUD3 T4 lesson: fn-only tests are
   blind to argv/exit wiring). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'roadmap.mjs');

function runRoadmap(args, env = {}) {
  const r = spawnSync('node', [CLI, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, ...env } });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* non-JSON modes */ }
  return { status: r.status, json, stdout: r.stdout };
}

/** Write a one-item roadmap with the given checks; return its path. */
function fixture(dir, checks) {
  const p = join(dir, 'roadmap.json');
  writeFileSync(p, JSON.stringify({ items: [{ id: 'X1', phase: 'X', title: 'fixture', checks }] }));
  return p;
}

function statusOfX1(dir, checks) {
  const r = runRoadmap(['--roadmap', fixture(dir, checks), '--json']);
  assert.equal(r.status, 0, 'status computation itself must exit 0');
  return r.json.items[0].status;
}

test('file predicate: a MISSING file is not built (M3 regression lock)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    assert.equal(statusOfX1(dir, [{ kind: 'file', path: join(dir, 'ghost.md') }]), 'missing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file predicate: a 0-byte file is NOT built (attack A5 — hollow file)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const hollow = join(dir, 'hollow.md');
    writeFileSync(hollow, '');
    assert.equal(statusOfX1(dir, [{ kind: 'file', path: hollow }]), 'missing',
      'an empty file must never satisfy a file predicate');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('file predicate: a real file is built; minBytes raises the bar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const doc = join(dir, 'doc.md');
    writeFileSync(doc, '# ten bytes plus\n');
    assert.equal(statusOfX1(dir, [{ kind: 'file', path: doc }]), 'built');
    assert.equal(statusOfX1(dir, [{ kind: 'file', path: doc, minBytes: 4096 }]), 'missing',
      'a file below minBytes must not satisfy the check');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('grep predicate: present passes, absent fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const doc = join(dir, 'doc.md');
    writeFileSync(doc, 'alpha\n| claim |\nomega\n');
    assert.equal(statusOfX1(dir, [{ kind: 'grep', path: doc, pattern: '\\| *claim *\\|' }]), 'built');
    assert.equal(statusOfX1(dir, [{ kind: 'grep', path: doc, pattern: 'ZR-NEVER' }]), 'missing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('grep predicate: count requires N matches (attack A5 — a lone token is not a table)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const doc = join(dir, 'doc.md');
    writeFileSync(doc, 'CLM-001 here\nCLM-002 there\n');
    assert.equal(statusOfX1(dir, [{ kind: 'grep', path: doc, pattern: 'CLM-', count: 2 }]), 'built');
    assert.equal(statusOfX1(dir, [{ kind: 'grep', path: doc, pattern: 'CLM-', count: 50 }]), 'missing',
      'fewer matches than count must not satisfy the check');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('cmd predicate: exit 0 passes, non-zero fails', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    assert.equal(statusOfX1(dir, [{ kind: 'cmd', run: 'true' }]), 'built');
    assert.equal(statusOfX1(dir, [{ kind: 'cmd', run: 'false' }]), 'missing');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('manual-only item reads unverified; manual + green auto reads partial', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    assert.equal(statusOfX1(dir, [{ kind: 'manual', note: 'human confirms' }]), 'unverified');
    assert.equal(statusOfX1(dir, [{ kind: 'cmd', run: 'true' }, { kind: 'manual', note: 'human confirms' }]), 'partial');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('status mode is informational: exit 0 even when everything is missing (documented)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const r = runRoadmap(['--roadmap', fixture(dir, [{ kind: 'file', path: join(dir, 'ghost.md') }])]);
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--audit-doc DENIES a hand-written status marker (exit 1) and passes a clean doc (exit 0)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const bad = join(dir, 'bad.md');
    writeFileSync(bad, '# doc\n\n**State:** ❌ Missing\n');
    const clean = join(dir, 'clean.md');
    writeFileSync(clean, '# doc\n\nIntent only; run the command for status.\n');
    assert.equal(runRoadmap(['--audit-doc', bad]).status, 1);
    assert.equal(runRoadmap(['--audit-doc', clean]).status, 0);
    assert.equal(runRoadmap(['--audit-doc', join(dir, 'ghost.md')]).status, 2, 'missing doc is a usage error');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- AUD5/F-05: the status-marker ban must catch evasive phrasing and
   must NOT flag quoted/code-fenced mentions (attack A6). ---- */

test('F-05 deny: evasive status phrasings are BANNED (attack A6 false-negatives)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const cases = [
      '| feature | done ✅ |',                    // status table cell
      'Status — A2 is shipped',                   // status sentence
      '<div>state: built</div>',                       // state: not at line start
    ];
    for (const line of cases) {
      const bad = join(dir, 'bad.md');
      writeFileSync(bad, `# doc\n\n${line}\n`);
      assert.equal(runRoadmap(['--audit-doc', bad]).status, 1,
        `must deny evasive marker: ${JSON.stringify(line)}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-05 allow: QUOTED banned patterns are exempt (attack A6 false-positive)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    const doc = join(dir, 'quoting.md');
    writeFileSync(doc, [
      '# a doc that DESCRIBES the ban without violating it',
      '',
      'The linter rejects `**State:** ❌ Missing` markers.',       // inline code span
      '> **State:** ✅ done — this is a quoted example, not a claim.', // blockquote
      '```',
      '**State:** ❌ Missing',                                       // fenced block
      '| done ✅ |',
      'state: built',
      '```',
      '',
    ].join('\n'));
    assert.equal(runRoadmap(['--audit-doc', doc]).status, 0,
      'quoted/code-fenced mentions of banned patterns must not be flagged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-05 --audit-tree: scans every .md under a dir; allowlist exempts with a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-t-'));
  try {
    writeFileSync(join(dir, 'clean.md'), '# intent only\n');
    const sub = join(dir, 'sub');
    (void 0, spawnSync('mkdir', ['-p', sub]));
    writeFileSync(join(sub, 'bad.md'), '**State:** ✅ done\n');
    // tree scan finds the nested violation
    assert.equal(runRoadmap(['--audit-tree', dir]).status, 1);
    // an allowlisted doc is exempt (audited exception, not a silent pass)
    const allow = join(dir, 'allow.txt');
    writeFileSync(allow, `sub/bad.md   # historical doc, superseded\n`);
    assert.equal(runRoadmap(['--audit-tree', dir, '--allow', allow]).status, 0);
    // missing dir is a usage error
    assert.equal(runRoadmap(['--audit-tree', join(dir, 'ghost')]).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-05: the real repo docs pass the broadened ban (CI parity)', () => {
  assert.equal(runRoadmap(['--audit-doc', 'CLAUDE.md']).status, 0, 'CLAUDE.md must stay clean');
  const r = runRoadmap(['--audit-tree', 'docs', '--allow', 'docs/flowmap/status-ban-allowlist.txt']);
  assert.equal(r.status, 0, `docs/** must pass the broadened ban:\n${r.stdout}`);
});

test('the repo\'s real roadmaps still compute clean under the tightened predicates', () => {
  // cmd checks are skipped-as-manual here (FLOWMAP_ROADMAP_SKIP_CMD): a
  // roadmap cmd may run this very suite, so executing them would recurse.
  // Skipping only DOWNGRADES (built -> partial) — every file/grep predicate
  // is still computed for real, which is what this lock is about.
  for (const rm of ['docs/flowmap/roadmap.json', 'docs/flowmap/audit/audit-roadmap.json']) {
    const r = runRoadmap(['--roadmap', rm, '--json'], { FLOWMAP_ROADMAP_SKIP_CMD: '1' });
    assert.equal(r.status, 0, `${rm} must compute`);
    const notBuilt = r.json.items.filter((i) => i.status === 'missing');
    assert.equal(notBuilt.length, 0, `${rm}: no item may regress to missing: ${notBuilt.map((i) => i.id)}`);
  }
});
