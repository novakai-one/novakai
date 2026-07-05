#!/usr/bin/env node
/**
 * F3 — Stop-hook nudge: handoff-fresh.mjs
 *
 * Purpose: At the end of a Claude Code session, check whether
 * docs/novakai/SESSION_HANDOFF.md is stale relative to code changes
 * under src/ or tools/. If stale, print a clear reminder so the human
 * (or orchestrator) knows to re-sync before the session ends.
 *
 * This is the nudge half of the meta-loop. The verifiable half is the
 * F4 roadmap predicate (a machine-checkable gate in roadmap.json).
 *
 * Rules:
 *   - Always exits 0 — non-blocking. It is a nudge, not a trap.
 *   - If stale: prints a concise reminder to stdout.
 *   - If fresh: prints "✓ handoff fresh".
 *   - If git is unavailable or anything fails: exits 0 silently.
 *
 * Staleness definition:
 *   - The latest git commit timestamp that touched src/ or tools/ is
 *     NEWER than the last git commit that touched SESSION_HANDOFF.md, OR
 *   - There are uncommitted changes under src/ or tools/ while
 *     SESSION_HANDOFF.md is unmodified in the working tree.
 *
 * Usage:
 *   node tools/novakai/status/handoff-fresh.mjs            # nudge: always exit 0
 *   node tools/novakai/status/handoff-fresh.mjs --check    # F4 gate: exit 1 if stale
 *
 * --check is the VERIFIABLE half of the meta-loop (F4): it gates on TRUTH, not
 * timestamps — the handoff must make no claim the committed tree falsifies
 * (H5 content-falsifiability). It does NOT compare per-path commit timestamps:
 * that coupled every code PR to a bump of this one shared file and dead-locked
 * on parallel PRs (the same anti-pattern already retired from ship-staleness.mjs,
 * which moved to a content hash for exactly this reason). Committed-code-newer-
 * than-handoff is a NUDGE only (the bare mode below), never a merge blocker; the
 * Stop hook still reminds the human to re-sync each session.
 *
 * --check FAILS CLOSED (AUD5 fix F-02): shallow clone -> exit 1 (depth-1 history
 * cannot prove anything — use fetch-depth: 0); git unavailable / not a repo ->
 * exit 1; the dirty-handoff bypass is LOCAL-only (ignored under CI).
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const IS_MAIN = process.argv[1] === fileURLToPath(import.meta.url);
const CHECK = process.argv.includes('--check');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

/**
 * H5 — content-falsifiability. Scan docText for a commit-status assertion
 * ("not yet committed" / "untracked" / "uncommitted" / "working-tree-only")
 * that is demonstrably FALSE: git shows the referenced file(s) committed.
 *
 * Robust to the handoff's real convention, where the claim is a vague
 * back-reference ("…these files…") and the file names live in a separate
 * "**New files:**" / "**Edited:**" bullet using project-relative names
 * (e.g. `lib/canonical.mjs`). Tokens are resolved across known roots, so a
 * `tools/novakai/`-relative name still resolves. A claim is only considered
 * when it is a bold label or a list-item opener — never incidental prose —
 * and a file is only flagged when it EXISTS on disk AND has a commit; an
 * unresolved or genuinely-uncommitted file yields no violation (no false +ve).
 *
 * @param {string} docText - full text of SESSION_HANDOFF.md
 * @returns {string[]} - violation strings; empty means no falsified claims
 */
export function checkContentClaims(docText) {
  const ASSERT_RE = /(not yet committed|working-tree-only|untracked|uncommitted)/i;
  const BACKREF_RE = /\b(these|those|them|the (?:above|following|listed))\b/i;
  const LIST_LABEL_RE = /\*\*\s*(new files|edited|new|added)\b/i;
  // backtick-quoted file tokens with a code-ish extension.
  const PATH_RE = /`([^`\s]+?\.(?:mjs|cjs|js|ts|tsx|json|yml|yaml|md|txt))`/g;
  const ROOTS = ['', 'tools/novakai/', 'tools/buildspec/', 'tools/', 'src/', 'docs/novakai/', 'docs/', '.github/workflows/', '.claude/'];

  const lines = docText.split('\n');
  const isLabelledClaim = (ln) => ASSERT_RE.test(ln) && (/^\s*[-*]\s+/.test(ln) || /\*\*/.test(ln));

  // Resolve a token across known roots; return {path, sha} only if it EXISTS
  // and is committed. exists-but-uncommitted => claim is true => null.
  function committedPath(token) {
    for (const root of ROOTS) {
      const rel = root + token;
      if (existsSync(join(ROOT, rel))) {
        try { const out = run(`git log -1 --oneline -- "${rel}"`); if (out) return { path: rel, sha: out.split('\n')[0] }; }
        catch { /* git unavailable — cannot prove */ }
        return null;
      }
    }
    return null;
  }

  // Tokens named in every "**New files"/"**Edited" labelled bullet — the files
  // a back-referencing claim ("these files…") points at.
  function listedTokens() {
    const toks = [];
    for (let k = 0; k < lines.length; k++) {
      if (!LIST_LABEL_RE.test(lines[k])) continue;
      let block = lines[k], m = k + 1;
      while (m < lines.length && lines[m].trim() !== '') { block += '\n' + lines[m]; m++; }
      for (const x of block.matchAll(PATH_RE)) toks.push(x[1]);
    }
    return toks;
  }

  const violations = [];
  const seen = new Set();
  let i = 0;
  while (i < lines.length) {
    if (!isLabelledClaim(lines[i])) { i++; continue; }
    let block = lines[i], j = i + 1;
    while (j < lines.length && lines[j].trim() !== '') { block += '\n' + lines[j]; j++; }

    let tokens = [...block.matchAll(PATH_RE)].map((m) => m[1]);
    // vague/back-referencing claim ("these files") => resolve against the doc's
    // New files/Edited lists, so the claim is still machine-falsifiable.
    if (BACKREF_RE.test(block) || tokens.length === 0) tokens = tokens.concat(listedTokens());

    for (const tok of tokens) {
      if (seen.has(tok)) continue;
      seen.add(tok);
      const hit = committedPath(tok);
      if (hit) violations.push(
        `SESSION_HANDOFF.md asserts files are not committed, but git shows "${hit.path}" committed (${hit.sha})`,
      );
    }
    i = j;
  }
  return violations;
}

// Only execute when run directly (not when imported as a module).
if (IS_MAIN) {

// F4 strict gate: committed code newer than committed handoff → stale → exit 1.
if (CHECK) {
  try {
    // F-02 fail-closed: a shallow clone cannot prove anything — with depth 1
    // every `git log -1 -- <path>` resolves to the boundary commit, so the H5
    // committed-file lookups below are unreliable (the vacuous-CI hole found on
    // PR #1). Checkout with fetch-depth: 0 to run this gate.
    if (run('git rev-parse --is-shallow-repository') === 'true') {
      process.stdout.write(
        '✗ shallow clone — freshness cannot be proven (every path resolves to the boundary\n' +
        '  commit). Check out with full history (actions/checkout fetch-depth: 0).\n'
      );
      process.exit(1);
    }
    // An actively-updated handoff (dirty in the working tree) — the agent is
    // re-syncing it right now, before commit. LOCAL-only (F-02): in CI nothing
    // legitimately edits the handoff.
    const dirtyHandoff = run('git status --porcelain -- docs/novakai/SESSION_HANDOFF.md');
    if (dirtyHandoff && !process.env.CI) {
      process.stdout.write('✓ handoff is being updated (modified in the working tree)\n');
      process.exit(0);
    }
    // H5 — content-falsifiability is the gate: the handoff must make no claim
    // the committed tree proves false (e.g. "not yet committed" about a file
    // git shows committed). Freshness is NOT a per-path timestamp race — that
    // coupled every code PR to a bump of this one shared file (and dead-locked
    // on parallel PRs), the same anti-pattern already retired from
    // ship-staleness.mjs. Committed-code-newer-than-handoff is only a
    // non-blocking Stop-hook NUDGE (below), never a merge blocker.
    const handoffText = readFileSync('docs/novakai/SESSION_HANDOFF.md', 'utf8');
    const violations = checkContentClaims(handoffText);
    if (violations.length) {
      for (const v of violations) process.stdout.write('✗ ' + v + '\n');
      process.exit(1);
    }
    process.stdout.write('✓ handoff makes no claim falsified by the committed tree\n');
    process.exit(0);
  } catch {
    // F-02 fail-closed (was a vacuous pass, AUD2 attack A3): --check is the
    // gate — what it cannot prove it must not pass. The bare nudge below
    // keeps its never-blocking behavior for the Stop hook.
    process.stdout.write('✗ cannot verify handoff freshness (git unavailable or not a repository)\n');
    process.exit(1);
  }
}

try {
  // Latest commit timestamp (unix epoch) that touched src/ or tools/
  const codeTs = run('git log -1 --format=%ct -- src/ tools/');
  // Latest commit timestamp that touched SESSION_HANDOFF.md
  const handoffTs = run('git log -1 --format=%ct -- docs/novakai/SESSION_HANDOFF.md');

  // Uncommitted changes in src/ or tools/
  const dirtyCode = run('git status --porcelain -- src/ tools/');
  // Uncommitted changes to SESSION_HANDOFF.md
  const dirtyHandoff = run('git status --porcelain -- docs/novakai/SESSION_HANDOFF.md');

  let stale = false;

  // Case 1: committed code changes are newer than the handoff
  if (codeTs && handoffTs && parseInt(codeTs, 10) > parseInt(handoffTs, 10)) {
    stale = true;
  }

  // Case 2: uncommitted src/tools changes but handoff is unmodified
  if (dirtyCode && !dirtyHandoff) {
    stale = true;
  }

  if (stale) {
    process.stdout.write(
      '⚠ SESSION_HANDOFF.md may be stale — src/tools changed more recently.\n' +
      '  Re-sync: npm run novakai:ship && update docs/novakai/SESSION_HANDOFF.md before ending.\n'
    );
  } else {
    process.stdout.write('✓ handoff fresh\n');
  }
} catch {
  // Not a git repo, git not installed, or any other failure — stay silent and non-blocking.
}

process.exit(0);

} // end IS_MAIN
