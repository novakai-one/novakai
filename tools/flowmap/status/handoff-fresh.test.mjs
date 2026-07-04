/**
 * H5 — handoff content-falsifiability tests
 * Tests for checkContentClaims() using fixture strings (no real file dependency
 * except the git-history lookups for committed-file assertions).
 *
 * Plus (AUD5 fix F-02): CLI deny-path tests for `--check` — the F4 gate.
 * AUD3 T1/M1 proved the staleness deny had zero coverage (disabling it left
 * the suite green), and the CI run of `handoff:check` was structurally
 * vacuous on the runner's depth-1 checkout (every `git log -1 -- <path>`
 * resolves to the boundary commit -> permanent same-commit tie). These tests
 * spawn the REAL CLI inside deterministic fixture repos.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContentClaims } from './handoff-fresh.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'handoff-fresh.mjs');

/** Run the real CLI in a given cwd; strip CI vars unless provided. */
function check(cwd, env = {}) {
  const base = { ...process.env, ...env };
  if (!('CI' in env)) { delete base.CI; delete base.GITHUB_ACTIONS; }
  const r = spawnSync('node', [CLI, '--check'], { cwd, encoding: 'utf8', env: base });
  return { status: r.status, stdout: r.stdout ?? '' };
}

/** Fixture repo: handoff committed at T0; optional src commit at T0+100. */
function mkrepo({ staleCode = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-t-'));
  const g = (cmd, at) => execSync(cmd, {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  const T0 = '2026-01-01T00:00:00Z', T1 = '2026-01-01T01:00:00Z';
  execSync('git init -q && git config user.email t@t && git config user.name t', { cwd: dir });
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'docs', 'flowmap'), { recursive: true });
  writeFileSync(join(dir, 'src', 'main.ts'), 'export {};\n');
  writeFileSync(join(dir, 'docs', 'flowmap', 'SESSION_HANDOFF.md'), '# handoff\n\nintent only.\n');
  g('git add -A && git commit -qm base', T0);
  if (staleCode) {
    appendFileSync(join(dir, 'src', 'main.ts'), '// change\n');
    g('git add -A && git commit -qm code-only', T1);
  }
  return dir;
}

test('CLI --check PASSES when committed code is newer than the handoff (the PR49 case — no timestamp race)', () => {
  // A code-only commit newer than the handoff is NOT a merge blocker: the gate
  // is content-truth, not a per-path timestamp comparison. This is exactly the
  // shape that blocked reorg/panel (PR49) and dead-locked parallel PRs.
  const dir = mkrepo({ staleCode: true });
  try {
    const r = check(dir);
    assert.equal(r.status, 0, `code newer than handoff must NOT block (content-truth gate), got ${r.status}: ${r.stdout}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --check passes a fresh handoff (exit 0)', () => {
  const dir = mkrepo();
  try {
    assert.equal(check(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --check FAILS CLOSED on a shallow clone (exit 1) — the vacuous-CI hole (F-02)', () => {
  const dir = mkrepo({ staleCode: true });
  const clone = mkdtempSync(join(tmpdir(), 'handoff-shallow-'));
  try {
    execSync(`git clone -q --depth 1 "file://${dir}" "${join(clone, 'wt')}"`, { encoding: 'utf8' });
    const r = check(join(clone, 'wt'));
    assert.equal(r.status, 1, `a shallow clone cannot prove freshness and must not pass, got ${r.status}: ${r.stdout}`);
    assert.match(r.stdout, /shallow/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(clone, { recursive: true, force: true });
  }
});

test('CLI --check FAILS CLOSED outside a git repo (exit 1) — cannot-prove must not pass (F-02)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-norepo-'));
  try {
    const r = check(dir);
    assert.equal(r.status, 1, `outside a repo the gate cannot verify and must not pass, got ${r.status}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI --check: the dirty-handoff bypass is LOCAL-only; under CI=1 the content check still fires (F-02)', () => {
  // Commit a handoff with a provably-false claim (says a committed file is not
  // committed). Dirty in the working tree => local bypass exits 0; under CI the
  // bypass is skipped and H5 catches the false claim => exit 1.
  const dir = mkrepo();
  const g = (cmd, at) => execSync(cmd, {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
  });
  try {
    writeFileSync(
      join(dir, 'docs', 'flowmap', 'SESSION_HANDOFF.md'),
      '# handoff\n\n**Not yet committed:** `src/main.ts` is working-tree-only.\n',
    );
    g('git add -A && git commit -qm false-claim', '2026-01-01T02:00:00Z');
    appendFileSync(join(dir, 'docs', 'flowmap', 'SESSION_HANDOFF.md'), '\n<!-- editing -->\n');
    assert.equal(check(dir).status, 0, 'locally, a handoff being edited bypasses the check');
    const r = check(dir, { CI: '1' });
    assert.equal(r.status, 1, `in CI the dirty bypass must not apply and H5 must fire, got ${r.status}: ${r.stdout}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('flags a bold "Not yet committed" claim about a file that IS in git history', async () => {
  const text = [
    '**Not yet committed:** these files — `tools/flowmap/status/handoff-fresh.mjs`',
  ].join('\n');
  const violations = checkContentClaims(text);
  assert.ok(violations.length >= 1, `expected >= 1 violation, got ${violations.length}: ${JSON.stringify(violations)}`);
  assert.ok(
    violations[0].includes('tools/flowmap/status/handoff-fresh.mjs'),
    `violation should mention the path: ${violations[0]}`
  );
});

test('does NOT flag a claim about a path that has no git history', async () => {
  const text = [
    '**Not yet committed:** `tools/flowmap/does-not-exist-xyz.mjs` is working-tree-only.',
  ].join('\n');
  const violations = checkContentClaims(text);
  assert.strictEqual(violations.length, 0, `expected 0 violations, got: ${JSON.stringify(violations)}`);
});

test('does NOT flag benign mid-sentence prose containing "not yet committed"', async () => {
  const text = 'this code was not yet committed at the time of writing.';
  const violations = checkContentClaims(text);
  assert.strictEqual(violations.length, 0, `expected 0 violations (no false positive), got: ${JSON.stringify(violations)}`);
});

// The REAL handoff pattern that the first (same-block) implementation missed:
// a vague back-reference claim ("these files") whose file names live in a
// SEPARATE "**New files" bullet using project-relative names (`lib/...`).
test('catches the real two-bullet pattern: "these files" claim + a **New files list of COMMITTED files', async () => {
  const text = [
    '**New files (all in `tools/flowmap/`):** `lib/canonical.mjs`, `waves.mjs`, and tests `waves.test.mjs`.',
    '',
    '- **Not yet committed:** these files are working-tree-only until committed. (`git status` shows them untracked.)',
  ].join('\n');
  const violations = checkContentClaims(text);
  assert.ok(violations.length >= 1, `the real two-bullet pattern must be caught, got: ${JSON.stringify(violations)}`);
});

// And it must stay quiet when those same listed files are genuinely uncommitted.
test('does NOT flag a "these files" claim when the listed files have no git history', async () => {
  const text = [
    '**New files:** `tools/flowmap/ghost-aaa.mjs`, `tools/flowmap/ghost-bbb.mjs`.',
    '',
    '- **Not yet committed:** these files are working-tree-only.',
  ].join('\n');
  const violations = checkContentClaims(text);
  assert.strictEqual(violations.length, 0, `expected 0 violations, got: ${JSON.stringify(violations)}`);
});
