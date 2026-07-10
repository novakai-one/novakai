#!/usr/bin/env node
/* =====================================================================
   approve-export.test.mjs — unit + smoke tests for E1 approve-export
   --------------------------------------------------------------------- */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';
import { approveExport } from './approve-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const ADD_WIDGET_ID = 'add-widget';
const CHECKLIST_FILENAME = 'CHECKLIST.md';
const APPROVE_EXPORT_SCRIPT = 'approve-export.mjs';
const ACCEPTED_ONLY_FLAG = '--accepted-only';
const F12_TMP_PREFIX = 'novakai-f12-';

/** Spawn the approve-export CLI with the given argv (HERE/script prefix is implicit). */
function spawnApproveExport(args, opts = {}) {
  return spawnSync(process.execPath, [join(HERE, APPROVE_EXPORT_SCRIPT), ...args], { encoding: 'utf8', ...opts });
}

/* ---------- small in-memory base model ---------- */

// Minimal .mmd text with two nodes: existingModule (module) and existingType (type).
const BASE_MMD = `flowchart TD
  existingModule["existingModule"]
  existingType["existingType"]

%% fm:meta existingModule name=ExistingModule
%% fm:meta existingModule desc=An existing module
%% fm:meta existingType name=ExistingType
%% fm:meta existingType desc=An existing type
`;

const baseModel = parseMmd(BASE_MMD);

// Plan: ADD newWidget (function) + MODIFY existingModule's description intent.
const testPlan = {
  base: 'test-base',
  changes: [
    {
      id: ADD_WIDGET_ID,
      status: 'add',
      target: { kind: 'node', ref: 'newWidget' },
      newNode: { label: 'newWidget', kind: 'function', parent: null },
      intent: { problem: 'there is no widget yet' },
    },
    {
      id: 'modify-module',
      status: 'modify',
      target: { kind: 'node', ref: 'existingModule' },
      intent: { problem: 'the module description is outdated' },
      'fm': {
        name: 'ExistingModule',
        description: 'Updated description for the module',
        state: [],
        interfaces: [
          { name: 'doThing', accepts: ['x: string'], returns: ['void'] },
        ],
      },
    },
  ],
};

/* ---------- unit test ---------- */

/** Assert the approved.mmd at mmdPath contains the newWidget node. */
function assertNewWidgetNode(mmdPath, msg) {
  const parsed = parseMmd(readFileSync(mmdPath, 'utf8'));
  assert.ok(Object.prototype.hasOwnProperty.call(parsed.nodes, 'newWidget'), msg);
}

function assertApprovedMmdHasNewWidget(result) {
  assert.ok(result.mmdPath, 'mmdPath returned');
  assert.ok(existsSync(result.mmdPath), 'approved.mmd was written');
  assertNewWidgetNode(result.mmdPath, 'approved.mmd contains the added node "newWidget"');
}

function assertStubsGenerated(outDir, result) {
  assert.ok(result.stubCount > 0, `stubCount should be > 0, got ${result.stubCount}`);
  const contractsDir = join(outDir, 'contracts');
  assert.ok(existsSync(contractsDir), 'contracts/ directory exists');
  const tsFiles = readdirSync(contractsDir).filter((file) => file.endsWith('.ts'));
  assert.ok(tsFiles.length > 0, `Expected .ts files in contracts/, found: ${tsFiles.join(', ') || 'none'}`);
}

function assertChecklistWritten(outDir) {
  const checklistPath = join(outDir, CHECKLIST_FILENAME);
  assert.ok(existsSync(checklistPath), 'CHECKLIST.md was written');
  const checklistText = readFileSync(checklistPath, 'utf8');
  assert.ok(checklistText.includes('newWidget'), 'CHECKLIST.md mentions newWidget');
  assert.ok(checklistText.includes('existingModule'), 'CHECKLIST.md mentions existingModule');
  assert.ok(
    checklistText.includes('there is no widget yet'),
    'CHECKLIST.md includes intent.problem for add-widget',
  );
  assert.ok(
    checklistText.includes('the module description is outdated'),
    'CHECKLIST.md includes intent.problem for modify-module',
  );
}

function assertPlanCopyWritten(outDir) {
  const planCopyPath = join(outDir, 'plan.json');
  assert.ok(existsSync(planCopyPath), 'plan.json copy was written');
  const planCopy = JSON.parse(readFileSync(planCopyPath, 'utf8'));
  assert.equal(planCopy.changes.length, 2, 'plan.json copy has 2 changes');
  const changeIds = planCopy.changes.map((change) => change.id);
  assert.ok(changeIds.includes(ADD_WIDGET_ID), 'plan.json copy includes add-widget');
  assert.ok(changeIds.includes('modify-module'), 'plan.json copy includes modify-module');
}

test('approveExport — adds node, generates stubs, writes checklist + plan copy', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'novakai-e1-test-'));
  try {
    const result = approveExport({ baseModel, plan: testPlan, outDir, acceptedOnly: false });
    assertApprovedMmdHasNewWidget(result);
    assertStubsGenerated(outDir, result);
    assertChecklistWritten(outDir);
    assertPlanCopyWritten(outDir);
    assert.equal(result.checklist.length, 2, 'checklist array has 2 entries');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('approveExport --accepted-only filters by verdicts', () => {
  const planWithVerdicts = {
    base: 'test-verdicts',
    verdicts: { [ADD_WIDGET_ID]: 'accept', 'modify-module': 'reject' },
    changes: testPlan.changes,
  };

  const outDir = mkdtempSync(join(tmpdir(), 'novakai-e1-verdicts-'));
  try {
    const result = approveExport({ baseModel, plan: planWithVerdicts, outDir, acceptedOnly: true });
    // only add-widget accepted, so newWidget should be in the approved model
    assertNewWidgetNode(result.mmdPath, 'accepted add-widget node appears in approved.mmd');

    // checklist should only have 1 entry (add-widget)
    assert.equal(result.checklist.length, 1, 'only 1 accepted change in checklist');
    assert.equal(result.checklist[0].id, ADD_WIDGET_ID);

    // plan.json copy should have only 1 change
    const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
    assert.equal(planCopy.changes.length, 1, 'plan.json copy has 1 accepted change');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/* ---------- H2: the editor's decision artifact drives the CLI bundle ---------- */

function assertH2ChecklistAndPlanCopy(outDir) {
  const checklist = readFileSync(join(outDir, CHECKLIST_FILENAME), 'utf8');
  assert.ok(checklist.includes('newWidget'), 'accepted add-widget appears in CHECKLIST');
  assert.ok(!checklist.includes('existingModule'), 'rejected modify-module excluded from CHECKLIST');
  const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
  assert.equal(planCopy.changes.length, 1, 'only the accepted change survives the artifact round-trip');
  assert.equal(planCopy.changes[0].id, ADD_WIDGET_ID);
}

test('H2 — editor decision artifact (plan + verdicts) drives approve-export --accepted-only via the CLI', () => {
  // Exactly what planner.ts doExport now downloads: { ...plan, verdicts }.
  const decision = {
    base: 'editor-decision', changes: testPlan.changes,
    verdicts: { [ADD_WIDGET_ID]: 'accept', 'modify-module': 'reject' },
  };
  const dir = mkdtempSync(join(tmpdir(), 'novakai-h2-decision-'));
  const planFile = join(dir, 'approved-plan.json'), mapFile = join(dir, 'base.mmd'), outDir = join(dir, 'out');
  writeFileSync(planFile, JSON.stringify(decision, null, 2));
  writeFileSync(mapFile, BASE_MMD);
  try {
    const args = ['--plan', planFile, '--out', outDir, '--map', mapFile, ACCEPTED_ONLY_FLAG];
    const res = spawnApproveExport(args, { timeout: 55_000 });
    assert.equal(res.status, 0, `approve-export should exit 0; stderr: ${res.stderr}`);
    assertH2ChecklistAndPlanCopy(outDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- AUD5/F-12: rejection paths (the emitter was ALLOW-only, T7) ---------- */

test('F-12 CLI: missing args → exit 2; unreadable plan → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), F12_TMP_PREFIX));
  try {
    const noArgs = spawnApproveExport([]);
    assert.equal(noArgs.status, 2, 'no args is a usage error (2)');
    const ghost = spawnApproveExport(['--plan', join(dir, 'ghost.json'), '--out', join(dir, 'out')]);
    assert.equal(ghost.status, 2, 'unreadable plan is exit 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-12 CLI: --accepted-only on a plan with NO verdicts refuses (exit 2), exports nothing', () => {
  // Before this fix, a verdict-less plan under --accepted-only silently
  // exported EVERY change — the opposite of what the flag promises.
  const dir = mkdtempSync(join(tmpdir(), F12_TMP_PREFIX));
  try {
    const planFile = join(dir, 'plan.json');
    const mapFile = join(dir, 'base.mmd');
    const outDir = join(dir, 'out');
    writeFileSync(planFile, JSON.stringify(testPlan));         // no verdicts map
    writeFileSync(mapFile, BASE_MMD);
    const res = spawnApproveExport(['--plan', planFile, '--out', outDir, '--map', mapFile, ACCEPTED_ONLY_FLAG]);
    assert.equal(res.status, 2, `verdict-less --accepted-only must refuse:\n${res.stdout}${res.stderr}`);
    assert.ok(!existsSync(join(outDir, 'plan.json')), 'no approval artifact may be emitted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function assertChecklistExcludesRejected(outDir) {
  const checklist = readFileSync(join(outDir, CHECKLIST_FILENAME), 'utf8');
  assert.ok(!checklist.includes('newWidget') && !checklist.includes('existingModule'),
    'no rejected change leaks into the checklist');
}

test('F-12 CLI: all changes rejected → exit 0 with an EXPLICIT empty artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), F12_TMP_PREFIX));
  try {
    const decision = {
      base: 'all-rejected',
      verdicts: { [ADD_WIDGET_ID]: 'reject', 'modify-module': 'reject' },
      changes: testPlan.changes,
    };
    const planFile = join(dir, 'plan.json'), mapFile = join(dir, 'base.mmd'), outDir = join(dir, 'out');
    writeFileSync(planFile, JSON.stringify(decision));
    writeFileSync(mapFile, BASE_MMD);
    const res = spawnApproveExport(['--plan', planFile, '--out', outDir, '--map', mapFile, ACCEPTED_ONLY_FLAG]);
    assert.equal(res.status, 0, `all-rejected is a valid human decision:\n${res.stdout}${res.stderr}`);
    const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
    assert.equal(planCopy.changes.length, 0, 'artifact is explicitly empty — nothing to build');
    assertChecklistExcludesRejected(outDir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- smoke run against real public/plan.json ---------- */

function logSmokeRun(res, smokeOut) {
  console.log('\n--- smoke run stdout ---');
  if (res.stdout) console.log(res.stdout);
  if (res.stderr) console.log('--- stderr ---\n' + res.stderr);
  const lsRes = spawnSync('ls', ['-R', smokeOut], { encoding: 'utf8' });
  console.log('--- ls -R', smokeOut, '---');
  if (lsRes.stdout) console.log(lsRes.stdout);
}

function assertSmokeArtifacts(smokeOut) {
  assert.ok(existsSync(join(smokeOut, 'approved.mmd')), 'approved.mmd created in smoke run');
  assert.ok(existsSync(join(smokeOut, 'contracts')), 'contracts/ dir created in smoke run');
  assert.ok(existsSync(join(smokeOut, CHECKLIST_FILENAME)), 'CHECKLIST.md created in smoke run');
  assert.ok(existsSync(join(smokeOut, 'plan.json')), 'plan.json created in smoke run');
  const tsFiles = readdirSync(join(smokeOut, 'contracts')).filter((file) => file.endsWith('.ts'));
  assert.ok(tsFiles.length > 0, `Expected .ts stubs in smoke contracts/, found: ${tsFiles.join(', ') || 'none'}`);
}

test('smoke run — real public/plan.json against _bundle.mmd', { timeout: 60_000 }, () => {
  const smokeOut = '/tmp/novakai-e1-smoke';

  // Remove previous run so we get a clean slate.
  try {
    rmSync(smokeOut, { recursive: true, force: true });
  } catch {
    // first run: nothing to remove
  }

  const res = spawnApproveExport(
    ['--plan', join(HERE, '..', '..', '..', 'public', 'plan.json'), '--out', smokeOut],
    { timeout: 55_000 },
  );
  logSmokeRun(res, smokeOut);
  assert.equal(res.status, 0, `approve-export exited with status ${res.status}; stderr: ${res.stderr}`);
  assertSmokeArtifacts(smokeOut);
});
