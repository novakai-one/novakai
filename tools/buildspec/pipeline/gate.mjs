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

const USAGE = 'usage: gate.mjs --spec <spec.mmd> --code <extracted.mmd> '
  + '[--warn-as-error] [--show-edges] [--unplanned-as-warning]';

// nodes anchored outside src/ (tools/*.mjs) are ts-morph-invisible; tooling-coverage owns them
const SRC_DIRECTIVE = /^%%\s*src\s+(\S+)\s+(\S+?)(?:#\S+)?\s*$/;

/** Delete nodes declared with a `%% src` directive pointing outside src/ from both graphs. */
function pruneNonSrcNodes(specText, spec, code) {
  for (const line of specText.split('\n')) {
    const match = SRC_DIRECTIVE.exec(line);
    if (!match || match[2].startsWith('src/')) continue;
    delete spec.nodes[match[1]];
    delete code.nodes[match[1]];
  }
}

function printWarnings(warns) {
  console.log(`warnings (${warns.length}):`);
  for (const warn of warns) console.log('  ! ' + warn);
}

function printErrors(errors) {
  console.log(`\nDRIFT — ${errors.length} error(s):`);
  for (const error of errors) console.log('  ✗ ' + error);
}

function parseCliOptions() {
  const specPath = arg('--spec');
  const codePath = arg('--code');
  if (!specPath || !codePath) {
    console.error(USAGE);
    process.exit(2);
  }
  return {
    specPath,
    codePath,
    warnAsError: process.argv.includes('--warn-as-error'),
    showEdges: process.argv.includes('--show-edges'),
    unplannedAsWarning: process.argv.includes('--unplanned-as-warning'),
  };
}

function loadGraphs(specPath, codePath) {
  const specText = readFileSync(specPath, 'utf8');
  const spec = parseMmd(specText);
  const code = parseMmd(readFileSync(codePath, 'utf8'));
  pruneNonSrcNodes(specText, spec, code);
  return { spec, code };
}

function reportAndExit(errors, warns, warnAsError) {
  if (warns.length) printWarnings(warns);
  if (errors.length) {
    printErrors(errors);
    process.exit(1);
  }
  if (warnAsError && warns.length) {
    console.log('\nFAIL: warnings treated as errors.');
    process.exit(1);
  }
  console.log('✓ spec and code are in sync');
  process.exit(0);
}

function main() {
  const { specPath, codePath, warnAsError, showEdges, unplannedAsWarning } = parseCliOptions();
  const { spec, code } = loadGraphs(specPath, codePath);
  const opts = { unplannedAsWarning };
  if (showEdges) {
    opts.specEdges = spec.edges;
    opts.codeEdges = code.edges;
  }
  const { errors, warns } = diffSkeletons(specSkeletons(spec), specSkeletons(code), opts);
  reportAndExit(errors, warns, warnAsError);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
