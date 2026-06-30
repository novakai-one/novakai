#!/usr/bin/env node
/**
 * F3 — Stop-hook nudge: handoff-fresh.mjs
 *
 * Purpose: At the end of a Claude Code session, check whether
 * docs/flowmap/SESSION_HANDOFF.md is stale relative to code changes
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
 *   node tools/flowmap/handoff-fresh.mjs            # nudge: always exit 0
 *   node tools/flowmap/handoff-fresh.mjs --check    # F4 gate: exit 1 if stale
 *
 * --check is the VERIFIABLE half of the meta-loop (F4): it compares only the
 * COMMITTED state (the latest commit touching src/|tools/ vs the latest commit
 * touching SESSION_HANDOFF.md), which is what CI and the roadmap predicate see,
 * and exits non-zero when the handoff lags the code. The bare nudge keeps the
 * working-tree heuristics and never blocks.
 */

import { execSync } from 'node:child_process';

const CHECK = process.argv.includes('--check');

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

// F4 strict gate: committed code newer than committed handoff → stale → exit 1.
if (CHECK) {
  try {
    // An actively-updated handoff (dirty in the working tree) is fresh by
    // definition — the agent is re-syncing it right now, before commit.
    const dirtyHandoff = run('git status --porcelain -- docs/flowmap/SESSION_HANDOFF.md');
    if (dirtyHandoff) {
      process.stdout.write('✓ handoff is being updated (modified in the working tree)\n');
      process.exit(0);
    }
    const codeTs = parseInt(run('git log -1 --format=%ct -- src/ tools/') || '0', 10);
    const handoffTs = parseInt(run('git log -1 --format=%ct -- docs/flowmap/SESSION_HANDOFF.md') || '0', 10);
    if (codeTs > handoffTs) {
      process.stdout.write(
        '✗ SESSION_HANDOFF.md is stale — the last commit touching src/|tools/ is newer than the\n' +
        '  last commit touching the handoff. Re-sync (flowmap:ship) and update the handoff before merge.\n'
      );
      process.exit(1);
    }
    process.stdout.write('✓ handoff is at least as fresh as the last code commit\n');
    process.exit(0);
  } catch {
    // No git / not a repo — cannot prove staleness; do not block (vacuously pass).
    process.exit(0);
  }
}

try {
  // Latest commit timestamp (unix epoch) that touched src/ or tools/
  const codeTs = run('git log -1 --format=%ct -- src/ tools/');
  // Latest commit timestamp that touched SESSION_HANDOFF.md
  const handoffTs = run('git log -1 --format=%ct -- docs/flowmap/SESSION_HANDOFF.md');

  // Uncommitted changes in src/ or tools/
  const dirtyCode = run('git status --porcelain -- src/ tools/');
  // Uncommitted changes to SESSION_HANDOFF.md
  const dirtyHandoff = run('git status --porcelain -- docs/flowmap/SESSION_HANDOFF.md');

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
      '  Re-sync: npm run flowmap:ship && update docs/flowmap/SESSION_HANDOFF.md before ending.\n'
    );
  } else {
    process.stdout.write('✓ handoff fresh\n');
  }
} catch {
  // Not a git repo, git not installed, or any other failure — stay silent and non-blocking.
}

process.exit(0);
