#!/usr/bin/env node
/* =====================================================================
   replay.mjs — the DETERMINISM HARNESS (the subagent-contract spine, node
   #3) and the BINDING acceptance test for the whole idea.
   ---------------------------------------------------------------------
   Schema-lock fixes a result's SHAPE; it does not make it DETERMINISTIC —
   a model-judged field ("severity":"high" vs "medium") still varies across
   runs. The only thing that delivers "100 runs -> 1 result" is: the data
   must be produced by a deterministic command and returned verbatim (route,
   not compute). replay is what PROVES that happened — it runs a task N times
   and asserts every run's stdout (and exit status) is byte-identical. A
   divergence means the task secretly computes/interprets instead of routing;
   replay is the leak detector, run FIRST, not last.

   Usage:
     node replay.mjs --task "<shell command>" --n <N> [--json]
   Exit: 0 = deterministic (all N identical), 1 = divergence found,
         2 = bad invocation.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256hex } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const TASK = arg('--task');
const N = parseInt(arg('--n', '20'), 10);
const JSON_OUT = process.argv.includes('--json');

if (!TASK || !Number.isInteger(N) || N < 2) {
  console.error('usage: replay.mjs --task "<command>" --n <N>=2 [--json]');
  process.exit(2);
}

// Run the task N times from a fixed cwd. Hash stdout (the result channel);
// stderr is excluded (ts-morph etc. may print machine-specific paths there).
const runs = [];
for (let i = 0; i < N; i++) {
  const r = spawnSync(TASK, {
    cwd: ROOT, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  runs.push({ i, stdoutHash: sha256hex(r.stdout ?? ''), status: r.status ?? null });
}

// Group by stdout hash, and by exit status: BOTH must be uniform for determinism.
const byHash = new Map();
for (const run of runs) {
  if (!byHash.has(run.stdoutHash)) byHash.set(run.stdoutHash, []);
  byHash.get(run.stdoutHash).push(run.i);
}
const statuses = [...new Set(runs.map((r) => r.status))];
const distinct = [...byHash.entries()]
  .map(([hash, idxs]) => ({ hash, count: idxs.length, runs: idxs }))
  .sort((a, b) => b.count - a.count || a.hash.localeCompare(b.hash));

const deterministic = distinct.length === 1 && statuses.length === 1;
const report = {
  task: TASK,
  n: N,
  deterministic,
  hash: deterministic ? distinct[0].hash : null,
  distinctOutputs: distinct.length,
  distinct,
  statuses,
};

if (JSON_OUT) {
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exit(deterministic ? 0 : 1);
}

console.log(`=== replay — "${TASK}" ×${N} ===`);
if (deterministic) {
  console.log(`  ✓ DETERMINISTIC — all ${N} runs identical (exit ${statuses[0]})`);
  console.log(`  hash: ${report.hash}`);
  console.log(`  This is the 100->100 proof: the task ROUTES to a deterministic command, it does not compute/judge.`);
} else {
  console.log(`  ✗ NON-DETERMINISTIC — ${distinct.length} distinct output(s) across ${N} runs; exit statuses: [${statuses.join(', ')}]`);
  for (const d of distinct) console.log(`      ${d.count}× ${d.hash.slice(0, 16)}…  runs [${d.runs.join(', ')}]`);
  console.log(`  A judgement leak: the task computes/interprets instead of routing. Fix until one hash.`);
}
process.exit(deterministic ? 0 : 1);
