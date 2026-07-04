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

import { parseMmd } from '../buildspec/core/mmd-parse.mjs';
import { approveExport } from './approve-export.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

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
      id: 'add-widget',
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
      fm: {
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

test('approveExport — adds node, generates stubs, writes checklist + plan copy', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'flowmap-e1-test-'));
  try {
    const result = approveExport({ baseModel, plan: testPlan, outDir, acceptedOnly: false });

    // 1. approved.mmd exists and contains the new node id
    assert.ok(result.mmdPath, 'mmdPath returned');
    assert.ok(existsSync(result.mmdPath), 'approved.mmd was written');

    const parsedApproved = parseMmd(readFileSync(result.mmdPath, 'utf8'));
    assert.ok(
      Object.prototype.hasOwnProperty.call(parsedApproved.nodes, 'newWidget'),
      'approved.mmd contains the added node "newWidget"',
    );

    // 2. At least one stub .ts file generated under contracts/
    assert.ok(result.stubCount > 0, `stubCount should be > 0, got ${result.stubCount}`);
    const contractsDir = join(outDir, 'contracts');
    assert.ok(existsSync(contractsDir), 'contracts/ directory exists');
    const tsFiles = readdirSync(contractsDir).filter((f) => f.endsWith('.ts'));
    assert.ok(tsFiles.length > 0, `Expected .ts files in contracts/, found: ${tsFiles.join(', ') || 'none'}`);

    // 3. CHECKLIST.md lists both changes
    const checklistPath = join(outDir, 'CHECKLIST.md');
    assert.ok(existsSync(checklistPath), 'CHECKLIST.md was written');
    const checklistText = readFileSync(checklistPath, 'utf8');
    assert.ok(checklistText.includes('newWidget'), 'CHECKLIST.md mentions newWidget');
    assert.ok(checklistText.includes('existingModule'), 'CHECKLIST.md mentions existingModule');
    assert.ok(checklistText.includes('there is no widget yet'), 'CHECKLIST.md includes intent.problem for add-widget');
    assert.ok(checklistText.includes('the module description is outdated'), 'CHECKLIST.md includes intent.problem for modify-module');

    // 4. plan.json copy exists and contains both changes
    const planCopyPath = join(outDir, 'plan.json');
    assert.ok(existsSync(planCopyPath), 'plan.json copy was written');
    const planCopy = JSON.parse(readFileSync(planCopyPath, 'utf8'));
    assert.equal(planCopy.changes.length, 2, 'plan.json copy has 2 changes');
    const changeIds = planCopy.changes.map((c) => c.id);
    assert.ok(changeIds.includes('add-widget'), 'plan.json copy includes add-widget');
    assert.ok(changeIds.includes('modify-module'), 'plan.json copy includes modify-module');

    // 5. checklist array has one entry per change
    assert.equal(result.checklist.length, 2, 'checklist array has 2 entries');

  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('approveExport --accepted-only filters by verdicts', () => {
  const planWithVerdicts = {
    base: 'test-verdicts',
    verdicts: { 'add-widget': 'accept', 'modify-module': 'reject' },
    changes: testPlan.changes,
  };

  const outDir = mkdtempSync(join(tmpdir(), 'flowmap-e1-verdicts-'));
  try {
    const result = approveExport({ baseModel, plan: planWithVerdicts, outDir, acceptedOnly: true });

    // only add-widget accepted, so newWidget should be in the approved model
    const parsedApproved = parseMmd(readFileSync(result.mmdPath, 'utf8'));
    assert.ok(
      Object.prototype.hasOwnProperty.call(parsedApproved.nodes, 'newWidget'),
      'accepted add-widget node appears in approved.mmd',
    );

    // checklist should only have 1 entry (add-widget)
    assert.equal(result.checklist.length, 1, 'only 1 accepted change in checklist');
    assert.equal(result.checklist[0].id, 'add-widget');

    // plan.json copy should have only 1 change
    const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
    assert.equal(planCopy.changes.length, 1, 'plan.json copy has 1 accepted change');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

/* ---------- H2: the editor's decision artifact drives the CLI bundle ---------- */

test('H2 — editor decision artifact (plan + verdicts) drives approve-export --accepted-only via the CLI', () => {
  // Exactly what planner.ts doExport now downloads: { ...plan, verdicts }.
  const decision = {
    base: 'editor-decision',
    verdicts: { 'add-widget': 'accept', 'modify-module': 'reject' },
    changes: testPlan.changes,
  };
  const dir = mkdtempSync(join(tmpdir(), 'flowmap-h2-decision-'));
  const planFile = join(dir, 'approved-plan.json');
  const mapFile = join(dir, 'base.mmd');
  const outDir = join(dir, 'out');
  writeFileSync(planFile, JSON.stringify(decision, null, 2));
  writeFileSync(mapFile, BASE_MMD);
  try {
    const r = spawnSync(process.execPath, [
      join(HERE, 'approve-export.mjs'),
      '--plan', planFile, '--out', outDir, '--map', mapFile, '--accepted-only',
    ], { encoding: 'utf8', timeout: 55_000 });
    assert.equal(r.status, 0, `approve-export should exit 0; stderr: ${r.stderr}`);

    // accepted change present, rejected change excluded from the bundle
    const checklist = readFileSync(join(outDir, 'CHECKLIST.md'), 'utf8');
    assert.ok(checklist.includes('newWidget'), 'accepted add-widget appears in CHECKLIST');
    assert.ok(!checklist.includes('existingModule'), 'rejected modify-module excluded from CHECKLIST');

    const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
    assert.equal(planCopy.changes.length, 1, 'only the accepted change survives the artifact round-trip');
    assert.equal(planCopy.changes[0].id, 'add-widget');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- AUD5/F-12: rejection paths (the emitter was ALLOW-only, T7) ---------- */

test('F-12 CLI: missing args → exit 2; unreadable plan → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowmap-f12-'));
  try {
    const noArgs = spawnSync(process.execPath, [join(HERE, 'approve-export.mjs')], { encoding: 'utf8' });
    assert.equal(noArgs.status, 2, 'no args is a usage error (2)');
    const ghost = spawnSync(process.execPath, [
      join(HERE, 'approve-export.mjs'),
      '--plan', join(dir, 'ghost.json'), '--out', join(dir, 'out'),
    ], { encoding: 'utf8' });
    assert.equal(ghost.status, 2, 'unreadable plan is exit 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-12 CLI: --accepted-only on a plan with NO verdicts refuses (exit 2), exports nothing', () => {
  // Before this fix, a verdict-less plan under --accepted-only silently
  // exported EVERY change — the opposite of what the flag promises.
  const dir = mkdtempSync(join(tmpdir(), 'flowmap-f12-'));
  try {
    const planFile = join(dir, 'plan.json');
    const mapFile = join(dir, 'base.mmd');
    const outDir = join(dir, 'out');
    writeFileSync(planFile, JSON.stringify(testPlan));         // no verdicts map
    writeFileSync(mapFile, BASE_MMD);
    const r = spawnSync(process.execPath, [
      join(HERE, 'approve-export.mjs'),
      '--plan', planFile, '--out', outDir, '--map', mapFile, '--accepted-only',
    ], { encoding: 'utf8' });
    assert.equal(r.status, 2, `verdict-less --accepted-only must refuse:\n${r.stdout}${r.stderr}`);
    assert.ok(!existsSync(join(outDir, 'plan.json')), 'no approval artifact may be emitted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-12 CLI: all changes rejected → exit 0 with an EXPLICIT empty artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'flowmap-f12-'));
  try {
    const decision = {
      base: 'all-rejected',
      verdicts: { 'add-widget': 'reject', 'modify-module': 'reject' },
      changes: testPlan.changes,
    };
    const planFile = join(dir, 'plan.json');
    const mapFile = join(dir, 'base.mmd');
    const outDir = join(dir, 'out');
    writeFileSync(planFile, JSON.stringify(decision));
    writeFileSync(mapFile, BASE_MMD);
    const r = spawnSync(process.execPath, [
      join(HERE, 'approve-export.mjs'),
      '--plan', planFile, '--out', outDir, '--map', mapFile, '--accepted-only',
    ], { encoding: 'utf8' });
    assert.equal(r.status, 0, `all-rejected is a valid human decision:\n${r.stdout}${r.stderr}`);
    const planCopy = JSON.parse(readFileSync(join(outDir, 'plan.json'), 'utf8'));
    assert.equal(planCopy.changes.length, 0, 'artifact is explicitly empty — nothing to build');
    const checklist = readFileSync(join(outDir, 'CHECKLIST.md'), 'utf8');
    assert.ok(!checklist.includes('newWidget') && !checklist.includes('existingModule'),
      'no rejected change leaks into the checklist');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- smoke run against real public/plan.json ---------- */

test('smoke run — real public/plan.json against _bundle.mmd', { timeout: 60_000 }, () => {
  const smokeOut = '/tmp/flowmap-e1-smoke';

  // Remove previous run so we get a clean slate.
  try { rmSync(smokeOut, { recursive: true, force: true }); } catch {}

  const r = spawnSync(
    process.execPath,
    [
      join(HERE, 'approve-export.mjs'),
      '--plan', join(HERE, '..', '..', 'public', 'plan.json'),
      '--out', smokeOut,
    ],
    { encoding: 'utf8', timeout: 55_000 },
  );

  console.log('\n--- smoke run stdout ---');
  if (r.stdout) console.log(r.stdout);
  if (r.stderr) console.log('--- stderr ---\n' + r.stderr);

  // List the generated files.
  const lsR = spawnSync('ls', ['-R', smokeOut], { encoding: 'utf8' });
  console.log('--- ls -R', smokeOut, '---');
  if (lsR.stdout) console.log(lsR.stdout);

  assert.equal(r.status, 0, `approve-export exited with status ${r.status}; stderr: ${r.stderr}`);

  // Verify key outputs exist.
  assert.ok(existsSync(join(smokeOut, 'approved.mmd')), 'approved.mmd created in smoke run');
  assert.ok(existsSync(join(smokeOut, 'contracts')), 'contracts/ dir created in smoke run');
  assert.ok(existsSync(join(smokeOut, 'CHECKLIST.md')), 'CHECKLIST.md created in smoke run');
  assert.ok(existsSync(join(smokeOut, 'plan.json')), 'plan.json created in smoke run');

  const tsFiles = readdirSync(join(smokeOut, 'contracts')).filter((f) => f.endsWith('.ts'));
  assert.ok(tsFiles.length > 0, `Expected .ts stubs in smoke contracts/, found: ${tsFiles.join(', ') || 'none'}`);
});
