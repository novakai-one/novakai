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
     • UI (C5', opt-in): a Playwright JSON-reporter file resolves the
       change's verification.journeys proof obligations (green/red/absent).
   then folds them into PASS/FAIL. No signature logic is reimplemented here.

   PASS iff  structural == "built"  AND  (no behavioural cases OR all green)
             AND (no UI obligations OR all resolved green, none pending).
   A structure-only PASS is flagged hasBehaviouralContract:false — honest:
   shaped-correct is weaker than behaves-correct. The `ui` block is ALWAYS
   present in the verdict body (zeros when the change has no journeys),
   mirroring `behavioural` — same discipline, counts only, no spec paths.

   --e2e-report (opt-in): NO browser is ever spawned here — the report is
   produced elsewhere (the leader, or CI) and simply read.

   --drift-base <ref> / --drift-out <file> (opt-in pair, C6'): a SEPARATE
   report of `git diff --name-only <ref>` classified via matchScope against
   the change's editScope (contract.mjs), written ONLY to --drift-out. It
   never touches stdout or the hashed verdict body — paths belong only where
   paths are the point. Neither flag passed => stdout is byte-identical to
   today; only --strict + --drift-base can turn drift into a non-zero exit.

   Usage:
     node verify-change.mjs --change <id> [--plan public/plan.json]
                 [--map docs/novakai/_bundle.mmd] [--tsconfig tsconfig.json] [--json]
                 [--strict] [--e2e-report <playwright-json-report>]
                 [--drift-base <ref> --drift-out <file>]
   Exit: 0 = PASS, 1 = FAIL or PASS_UNPROVEN, 2 = bad invocation, 3 = change id not in plan.
   With --json: stdout is the canonical verdict (byte-stable; safe to hash).
   Under --strict, PASS_UNPROVEN (and any non-PASS) exits non-zero; the JSON body is
   byte-identical in both modes. Under --strict + --drift-base, a frozenHit or any
   drift file also exits non-zero (still no effect on the JSON body or non-strict exit).
   ===================================================================== */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runAcceptance } from '../../buildspec/acceptance/acceptance.mjs';
import { canonicalJSON, hashOf } from '../lib/canonical.mjs';
import { recordEvent } from '../lib/metrics-log.mjs';
import { matchScope } from '../lib/scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CHANGE = arg('--change');
const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
const TSCONFIG = arg('--tsconfig', join(ROOT, 'tsconfig.json'));
const JSON_OUT = process.argv.includes('--json');
const STRICT = process.argv.includes('--strict');
const E2E_REPORT = arg('--e2e-report');
const DRIFT_BASE = arg('--drift-base');
const DRIFT_OUT = arg('--drift-out');

if (!CHANGE) {
  console.error(
    'usage: verify-change.mjs --change <id> [--plan <p>] [--map <m>] [--tsconfig <t>] [--json] '
    + '[--strict] [--e2e-report <report.json>] [--drift-base <ref> --drift-out <file>]\n'
    + '  under --strict, PASS_UNPROVEN (and any non-PASS) exits non-zero; the JSON body is '
    + 'byte-identical in both modes.',
  );
  process.exit(2);
}
if (Boolean(DRIFT_BASE) !== Boolean(DRIFT_OUT)) {
  console.error(
    'usage: --drift-base and --drift-out must be given together (opt-in pair; neither passed => stdout unchanged).',
  );
  process.exit(2);
}

let plan;
try {
  plan = JSON.parse(readFileSync(resolve(PLAN), 'utf8'));
} catch (e) {
  console.error('cannot read plan: ' + e.message);
  process.exit(2);
}

const change = (plan.changes || []).find((candidate) => candidate && candidate.id === CHANGE);
if (!change) {
  console.error(`change "${CHANGE}" not found in plan`);
  process.exit(3);
}
const ref = change.target?.ref ?? null;

/* ---------- structural verdict: ROUTE to status.mjs --json ---------- */
const statusResult = spawnSync('node', [
  join('tools', 'novakai', 'status', 'status.mjs'),
  '--plan', resolve(PLAN), '--map', resolve(MAP), '--tsconfig', resolve(TSCONFIG), '--json',
], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
// status.mjs exits 0 (all built) or 3 (work remains) on success; 2 = bad args.
if (statusResult.status === 2 || !statusResult.stdout) {
  console.error('status.mjs failed: ' + String(statusResult.stderr || '').slice(0, 400));
  process.exit(2);
}
let statusReport;
try {
  statusReport = JSON.parse(statusResult.stdout);
} catch {
  console.error('status.mjs produced unparseable output');
  process.exit(2);
}
const row = (statusReport.changes || []).find((entry) => entry.id === CHANGE);
if (!row) {
  console.error(`status.mjs returned no row for "${CHANGE}"`);
  process.exit(2);
}

/* ---------- behavioural verdict: ROUTE to runAcceptance, scope to this change ---------- */
const acc = runAcceptance({ planPath: resolve(PLAN), mapPath: resolve(MAP) });
const myResults = (acc.results || []).filter((result) => result.id === ref);
const cases = myResults
  .map((result) => ({ name: result.name, pass: !!result.pass }))
  .sort((left, right) => left.name.localeCompare(right.name));
const ran = cases.length > 0;
const passed = cases.filter((caseItem) => caseItem.pass).length;

/* ---------- UI verdict (C5', opt-in): resolve verification.journeys against
   a Playwright JSON-reporter file. NO browser is ever spawned here — the
   report is a file, produced elsewhere, read once. ---------- */
const journeys = (change.verification && Array.isArray(change.verification.journeys))
  ? change.verification.journeys : [];

/** Playwright JSON reporter -> flat [{file, title, passed}], any suite depth. */
function loadReportSpecs(reportPath) {
  const report = JSON.parse(readFileSync(resolve(reportPath), 'utf8'));
  const specs = [];
  const walk = (node) => {
    for (const spec of node.specs || []) {
      specs.push({ file: spec.file, title: spec.title, passed: !!spec.ok });
    }
    for (const sub of node.suites || []) walk(sub);
  };
  for (const suite of report.suites || []) walk(suite);
  return specs;
}

// journey.spec is repo-relative (e.g. "tests/e2e/design.spec.ts"); the report's
// spec.file is testDir-relative (e.g. "design.spec.ts") — match by suffix.
// journey.grep (optional) narrows to matching titles, playwright --grep style.
function specMatchesJourney(spec, journey) {
  const sameFile = journey.spec === spec.file
    || journey.spec.endsWith('/' + spec.file)
    || journey.spec.endsWith(spec.file);
  if (!sameFile) return false;
  if (!journey.grep) return true;
  try {
    return new RegExp(journey.grep).test(spec.title);
  } catch {
    return spec.title.includes(journey.grep);
  }
}

// Classify one journey against the loaded report specs: 'passed' | 'pending' | 'failed'.
function classifyJourney(journey, specs) {
  const matches = specs.filter((spec) => specMatchesJourney(spec, journey));
  if (matches.length === 0) return 'pending';
  if (matches.some((spec) => !spec.passed)) return 'failed';
  return 'passed';
}

function tryLoadReportSpecs(reportPath) {
  try {
    return loadReportSpecs(reportPath);
  } catch {
    return null;
  }
}

// pending = no matching report entry at all; a matching FAILED entry counts
// as neither passed nor pending — it forces the verdict to FAIL outright.
function resolveUi(list, reportPath) {
  const total = list.length;
  if (!total) return { total: 0, passed: 0, pending: 0, anyFailed: false };
  if (!reportPath) return { total, passed: 0, pending: total, anyFailed: false };
  const specs = tryLoadReportSpecs(reportPath);
  if (!specs) return { total, passed: 0, pending: total, anyFailed: false };
  const outcomes = list.map((journey) => classifyJourney(journey, specs));
  const passedCount = outcomes.filter((outcome) => outcome === 'passed').length;
  const pendingCount = outcomes.filter((outcome) => outcome === 'pending').length;
  const anyFailed = outcomes.some((outcome) => outcome === 'failed');
  return { total, passed: passedCount, pending: pendingCount, anyFailed };
}

const uiVerdict = resolveUi(journeys, E2E_REPORT);

/* ---------- fold into a data-only verdict ---------- */
const committed = !!change.fm;
const structuralOk = row.status === 'built';
const behaviouralOk = ran ? passed === cases.length : null; // null = no contract
const behaviourallyProven = behaviouralOk === true;
// Three-valued, so "built but unproven" can never masquerade as fully-proven PASS:
//   PASS          — built AND behavioural contract green AND UI obligations
//                    (if any) all resolved green, none pending (100% confidence)
//   PASS_UNPROVEN — built + shaped, but a behavioural or UI contract is
//                    absent/unresolved (structural only, or pending)
//   FAIL          — not built, a behavioural case is red, or a UI obligation
//                    matched a red report result
let verdict;
if (!structuralOk || behaviouralOk === false || uiVerdict.anyFailed) verdict = 'FAIL';
else if (behaviourallyProven && uiVerdict.pending === 0) verdict = 'PASS';
else verdict = 'PASS_UNPROVEN';
const pass = STRICT ? verdict === 'PASS' : verdict !== 'FAIL';

// M2b: the PASS_UNPROVEN ratio is computed from these lines. Side log only —
// the canonical stdout verdict stays byte-identical (determinism rule).
recordEvent({
  event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change', verdict, change: CHANGE, strict: STRICT,
});

const body = {
  verdictVersion: 1,
  change: CHANGE,
  target: change.target ?? null,
  structural: { status: row.status, committedSignature: committed },
  behavioural: { hasContract: ran, total: cases.length, passed, cases, proven: behaviourallyProven },
  'ui': { total: uiVerdict.total, passed: uiVerdict.passed, pending: uiVerdict.pending },
  verdict,
};
const verdictOut = { ...body, verdictHash: hashOf(body) };

/* ---------- scopeDrift (C6', opt-in pair): a SEPARATE report, written only
   to --drift-out. Never touches stdout or the hashed verdict body above —
   paths belong only where paths are the point. ---------- */
// Classify each changed file against editScope; 'allow' files are omitted (in the
// change's own scope). Returns { files, frozenHit }.
function classifyDriftFiles(changedFiles, editScope) {
  const files = [];
  let frozenHit = false;
  for (const filePath of changedFiles) {
    const classification = matchScope(filePath, editScope);
    if (classification === 'deny') {
      frozenHit = true;
      files.push({ path: filePath, class: 'frozen' });
    } else if (classification === 'warn') {
      files.push({ path: filePath, class: 'warn' });
    }
    // 'allow' -> in the change's own scope, omitted from the report.
  }
  return { files, frozenHit };
}

let driftExitBad = false;
if (DRIFT_BASE) {
  const contractResult = spawnSync('node', [
    join('tools', 'novakai', 'contract', 'contract.mjs'),
    '--change', CHANGE, '--plan', resolve(PLAN), '--map', resolve(MAP), '--json',
  ], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  let editScope;
  try {
    editScope = JSON.parse(contractResult.stdout).editScope;
  } catch {
    console.error(
      'drift: contract.mjs failed to produce editScope: ' + String(contractResult.stderr || '').slice(0, 400),
    );
    process.exit(2);
  }

  const diff = spawnSync('git', ['diff', '--name-only', DRIFT_BASE], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  if (diff.status !== 0) {
    console.error('drift: git diff failed: ' + String(diff.stderr || '').slice(0, 400));
    process.exit(2);
  }
  const changedFiles = diff.stdout.split('\n').map((line) => line.trim()).filter(Boolean);

  const { files, frozenHit } = classifyDriftFiles(changedFiles, editScope);
  const driftBody = { driftVersion: 1, change: CHANGE, base: DRIFT_BASE, files, frozenHit };
  const driftOut = { ...driftBody, driftHash: hashOf(driftBody) };
  writeFileSync(resolve(DRIFT_OUT), canonicalJSON(driftOut) + '\n');
  driftExitBad = STRICT && (frozenHit || files.length > 0);
}

const exitOk = pass && !driftExitBad;

if (JSON_OUT) {
  process.stdout.write(canonicalJSON(verdictOut) + '\n');
  process.exit(exitOk ? 0 : 1);
}

/* ---------- human summary (non --json) ---------- */
console.log(`=== verdict — change "${CHANGE}" (${change.target?.kind} ${ref}) ===`);
console.log(
  `  structural : [${row.status.toUpperCase()}]${committed ? ' (signature committed)' : ' (structure-only)'}`,
);
if (ran) {
  console.log(`  behavioural: ${passed}/${cases.length} acceptance case(s) green`);
  for (const caseItem of cases) {
    console.log(`      ${caseItem.pass ? '✓' : '✗'} ${caseItem.name}`);
  }
} else {
  console.log('  behavioural: NO contract (Keystone-2 absent — shaped, not proven-correct)');
}
if (uiVerdict.total) {
  const noReportNote = E2E_REPORT ? '' : ' — no --e2e-report given';
  console.log(
    `  ui         : ${uiVerdict.passed}/${uiVerdict.total} journey obligation(s) green `
    + `(${uiVerdict.pending} pending${noReportNote})`,
  );
}
const verdictLabel = verdict === 'PASS' ? '✓ PASS'
  : verdict === 'PASS_UNPROVEN' ? '✓ PASS_UNPROVEN (built + shaped, but no behavioural contract — not 100%-proven)'
  : '✗ FAIL';
console.log(`  verdict    : ${verdictLabel}`);
console.log(`  verdictHash: ${verdictOut.verdictHash}`);
if (DRIFT_BASE) {
  const driftNote = driftExitBad ? ' (STRICT: drift found -> non-zero exit)' : '';
  console.log(`  drift      : written to ${DRIFT_OUT}${driftNote}`);
}
process.exit(exitOk ? 0 : 1);
