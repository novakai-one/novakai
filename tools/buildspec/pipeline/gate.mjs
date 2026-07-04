#!/usr/bin/env node
/* =====================================================================
   gate.mjs — PIPELINE STEP #3 (the lock)
   ---------------------------------------------------------------------
   Compare the committed spec (.mmd) against the graph extracted from the
   code (.mmd, produced by extract.mjs / #2) and FAIL on drift. This is
   the deterministic enforcement point: run it in CI; a red gate means
   code and spec disagree.

   Usage:
     node gate.mjs --spec <spec.mmd> --code <extracted.mmd> [--warn-as-error] [--show-edges]

   Exit: 0 = in sync, 1 = drift (errors), 2 = bad invocation.
   Edges are reported as warnings only (spec edges are semantic call-order,
   extracted edges are imports — not a 1:1 relation), and are hidden unless
   --show-edges is passed. Pass --warn-as-error to also fail on warnings.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { parseMmd } from '../core/mmd-parse.mjs';
import { specSkeletons } from '../core/skeleton.mjs';
import { diffSkeletons } from '../core/diff-core.mjs';

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function main() {
  const specPath = arg('--spec');
  const codePath = arg('--code');
  const warnAsError = process.argv.includes('--warn-as-error');
  if (!specPath || !codePath) {
    console.error('usage: gate.mjs --spec <spec.mmd> --code <extracted.mmd> [--warn-as-error] [--show-edges] [--unplanned-as-warning]');
    process.exit(2);
  }

  const spec = parseMmd(readFileSync(specPath, 'utf8'));
  const code = parseMmd(readFileSync(codePath, 'utf8'));
  const showEdges = process.argv.includes('--show-edges');
  const opts = { unplannedAsWarning: process.argv.includes('--unplanned-as-warning') };
  if (showEdges) { opts.specEdges = spec.edges; opts.codeEdges = code.edges; }
  const { errors, warns } = diffSkeletons(specSkeletons(spec), specSkeletons(code), opts);

  if (warns.length) {
    console.log(`warnings (${warns.length}):`);
    for (const w of warns) console.log('  ! ' + w);
  }
  if (errors.length) {
    console.log(`\nDRIFT — ${errors.length} error(s):`);
    for (const e of errors) console.log('  ✗ ' + e);
    process.exit(1);
  }
  if (warnAsError && warns.length) { console.log('\nFAIL: warnings treated as errors.'); process.exit(1); }
  console.log('✓ spec and code are in sync');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
