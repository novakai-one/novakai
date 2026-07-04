#!/usr/bin/env node
/* =====================================================================
   verify-change.mjs — the CLOSED-FORM VERDICT for ONE plan change
   (the subagent-contract spine, node #2).
   ---------------------------------------------------------------------
   "The agent proposes, a tool disposes." A subagent may write any code;
   what escapes is not its prose but THIS verdict — computed, not narrated.
   The verdict is data-only (enums + counts + booleans + a content hash);
   it contains no free text, no paths, no timestamps, so 100 subagents that
   solved the change correctly return 100 byte-identical verdicts.

   It ROUTES to the existing gate tooling and reads only their machine output:
     • structural : node status.mjs --json  -> built/pending/drifted/missing
     • behavioural: runAcceptance()          -> per-case pass/fail (Keystone 2)
   then folds them into PASS/FAIL. No signature logic is reimplemented here.

   PASS iff  structural == "built"  AND  (no behavioural cases OR all green).
   A structure-only PASS is flagged hasBehaviouralContract:false — honest:
   shaped-correct is weaker than behaves-correct.

   Usage:
     node verify-change.mjs --change <id> [--plan public/plan.json]
                 [--map docs/flowmap/_bundle.mmd] [--tsconfig tsconfig.json] [--json]
                 [--strict]
   Exit: 0 = PASS, 1 = FAIL or PASS_UNPROVEN, 2 = bad invocation, 3 = change id not in plan.
   With --json: stdout is the canonical verdict (byte-stable; safe to hash).
   Under --strict, PASS_UNPROVEN (and any non-PASS) exits non-zero; the JSON body is
   byte-identical in both modes.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runAcceptance } from '../buildspec/acceptance/acceptance.mjs';
import { canonicalJSON, hashOf } from './lib/canonical.mjs';
import { recordEvent } from './lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const CHANGE = arg('--change');
const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
const TSCONFIG = arg('--tsconfig', join(ROOT, 'tsconfig.json'));
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');

if (!CHANGE) {
  console.error('usage: verify-change.mjs --change <id> [--plan <p>] [--map <m>] [--tsconfig <t>] [--json] [--strict]\n  under --strict, PASS_UNPROVEN (and any non-PASS) exits non-zero; the JSON body is byte-identical in both modes.');
  process.exit(2);
}

let plan;
try { plan = JSON.parse(readFileSync(resolve(PLAN), 'utf8')); }
catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }

const change = (plan.changes || []).find((c) => c && c.id === CHANGE);
if (!change) { console.error(`change "${CHANGE}" not found in plan`); process.exit(3); }
const ref = change.target?.ref ?? null;

/* ---------- structural verdict: ROUTE to status.mjs --json ---------- */
const sr = spawnSync('node', [
  join('tools', 'flowmap', 'status.mjs'),
  '--plan', resolve(PLAN), '--map', resolve(MAP), '--tsconfig', resolve(TSCONFIG), '--json',
], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
// status.mjs exits 0 (all built) or 3 (work remains) on success; 2 = bad args.
if (sr.status === 2 || !sr.stdout) {
  console.error('status.mjs failed: ' + String(sr.stderr || '').slice(0, 400));
  process.exit(2);
}
let statusReport;
try { statusReport = JSON.parse(sr.stdout); }
catch { console.error('status.mjs produced unparseable output'); process.exit(2); }
const row = (statusReport.changes || []).find((r) => r.id === CHANGE);
if (!row) { console.error(`status.mjs returned no row for "${CHANGE}"`); process.exit(2); }

/* ---------- behavioural verdict: ROUTE to runAcceptance, scope to this change ---------- */
const acc = runAcceptance({ planPath: resolve(PLAN), mapPath: resolve(MAP) });
const myResults = (acc.results || []).filter((r) => r.id === ref);
const cases = myResults
  .map((r) => ({ name: r.name, pass: !!r.pass }))
  .sort((a, b) => a.name.localeCompare(b.name));
const ran = cases.length > 0;
const passed = cases.filter((c) => c.pass).length;

/* ---------- fold into a data-only verdict ---------- */
const committed = !!change.fm;
const structuralOk = row.status === 'built';
const behaviouralOk = ran ? passed === cases.length : null; // null = no contract
const behaviourallyProven = behaviouralOk === true;
// Three-valued, so "built but unproven" can never masquerade as fully-proven PASS:
//   PASS          — built AND behavioural contract green (100% confidence)
//   PASS_UNPROVEN — built + shaped, but NO behavioural contract (structural only)
//   FAIL          — not built, or a behavioural case is red
let verdict;
if (!structuralOk || behaviouralOk === false) verdict = 'FAIL';
else if (behaviourallyProven) verdict = 'PASS';
else verdict = 'PASS_UNPROVEN';
const pass = STRICT ? verdict === 'PASS' : verdict !== 'FAIL';

// M2b: the PASS_UNPROVEN ratio is computed from these lines. Side log only —
// the canonical stdout verdict stays byte-identical (determinism rule).
recordEvent({ event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change', verdict, change: CHANGE, strict: STRICT });

const body = {
  verdictVersion: 1,
  change: CHANGE,
  target: change.target ?? null,
  structural: { status: row.status, committedSignature: committed },
  behavioural: { hasContract: ran, total: cases.length, passed, cases, proven: behaviourallyProven },
  verdict,
};
const verdictOut = { ...body, verdictHash: hashOf(body) };

if (JSON_OUT) {
  process.stdout.write(canonicalJSON(verdictOut) + '\n');
  process.exit(pass ? 0 : 1);
}

/* ---------- human summary (non --json) ---------- */
console.log(`=== verdict — change "${CHANGE}" (${change.target?.kind} ${ref}) ===`);
console.log(`  structural : [${row.status.toUpperCase()}]${committed ? ' (signature committed)' : ' (structure-only)'}`);
if (ran) {
  console.log(`  behavioural: ${passed}/${cases.length} acceptance case(s) green`);
  for (const c of cases) console.log(`      ${c.pass ? '✓' : '✗'} ${c.name}`);
} else {
  console.log('  behavioural: NO contract (Keystone-2 absent — shaped, not proven-correct)');
}
const verdictLabel = verdict === 'PASS' ? '✓ PASS'
  : verdict === 'PASS_UNPROVEN' ? '✓ PASS_UNPROVEN (built + shaped, but no behavioural contract — not 100%-proven)'
  : '✗ FAIL';
console.log(`  verdict    : ${verdictLabel}`);
console.log(`  verdictHash: ${verdictOut.verdictHash}`);
process.exit(pass ? 0 : 1);
