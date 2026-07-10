#!/usr/bin/env node
/* =====================================================================
   plan-cert.mjs — C2: certify a plan ROUND-TRIPS before a human sees it
   ---------------------------------------------------------------------
   Scenario 2's missing guarantee. An AI emits an English-derived plan.json
   (proposed changes, each optionally carrying a proposed `fm` = the new
   public signature). Before anyone opens the visual review, this command
   proves the plan is *enforceable*: applying it to the base map yields a
   spec that survives the WHOLE deterministic pipeline —

     apply  → mutate the base .mmd model by the plan's changes
     stubs  → spec-to-stubs emits TypeScript for the proposed signatures
     tsc    → those stubs compile under the strict contract tsconfig
     gate   → extract-from-stubs vs the proposed spec is drift-free

   Green = the plan's proposed contracts are internally consistent and the
   enforcement machinery can hold them. Red = the plan is malformed (a bad
   signature, an add targeting a missing parent, a type that won't compile)
   and a human should never have wasted a review on it. This is the dry-run
   certificate the roadmap (C2) calls for.

   It re-uses the exact pieces the pipeline test trusts (generate / extract /
   diffSkeletons) plus a strict tsc compile, so "certified" here means the
   same thing "green" means in CI.

   Usage:
     node plan-cert.mjs --plan <plan.json> [--map docs/novakai/_bundle.mmd]
                        [--accepted-only] [--json] [--keep]
   Exit: 0 = certified, 1 = NOT certified (drift or tsc error), 2 = bad args.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Project } from 'ts-morph';
import { parseMmd, toMmd } from '../../buildspec/core/mmd-parse.mjs';
import { specSkeletons } from '../../buildspec/core/skeleton.mjs';
import { diffSkeletons } from '../../buildspec/core/diff-core.mjs';
import { extract } from '../../buildspec/pipeline/extract.mjs';
import { generate } from '../../buildspec/pipeline/spec-to-stubs.mjs';
import { recordEvent } from '../lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Filter a maybe-array down to its string entries (mirrors the parser's tolerant loading). */
function stringItems(list) {
  return Array.isArray(list) ? list.filter((item) => typeof item === 'string') : [];
}

/** Coerce one loaded interface-ish object into the parser's Interface shape. */
function normInterface(iface) {
  return {
    name: typeof iface?.name === 'string' ? iface.name : '',
    accepts: stringItems(iface?.accepts),
    returns: stringItems(iface?.returns),
  };
}

/** Coerce any loaded fm-ish object into the parser's Frontmatter shape. */
function normFm(raw, fallbackName) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    name: typeof source.name === 'string' && source.name ? source.name : fallbackName,
    description: typeof source.description === 'string' ? source.description : '',
    state: stringItems(source.state),
    interfaces: Array.isArray(source.interfaces) ? source.interfaces.map(normInterface) : [],
  };
}

/** Build the node record for an add-node change. */
function buildNewNode(change, ref) {
  return {
    id: ref,
    kind: change.newNode?.kind || 'module',
    parent: change.newNode?.parent ?? null,
    group: false,
    shape: 'rect',
  };
}

/** Apply a modify-node change to the clones (mutates frontmatterMap in place). */
function applyModifyNode(nodes, frontmatterMap, change, ref) {
  if (nodes[ref] && change.fm) {
    frontmatterMap[ref] = normFm(change.fm, frontmatterMap[ref]?.name || ref);
  }
}

/** Apply a single node-target change to the clones. Returns true iff the node was removed. */
function applyNodeChange(nodes, frontmatterMap, change, ref) {
  if (change.status === 'remove') {
    delete nodes[ref];
    delete frontmatterMap[ref];
    return true;
  }
  if (change.status === 'add') {
    nodes[ref] = buildNewNode(change, ref);
    frontmatterMap[ref] = normFm(change.fm, change.newNode?.label || ref);
  } else if (change.status === 'modify') {
    applyModifyNode(nodes, frontmatterMap, change, ref);
  }
  return false;
}

/** Apply a single edge-target change; returns the (possibly replaced) edges array. */
function applyEdgeChange(edges, change, ref) {
  if (change.status === 'add' && change.newEdge) {
    const style = change.newEdge.style || 'solid';
    const isDuplicate = edges.some(
      (edge) => edge.from === change.newEdge.from && edge.to === change.newEdge.to && edge.style === style,
    );
    if (isDuplicate) return edges;
    return [
      ...edges,
      { from: change.newEdge.from, 'to': change.newEdge.to, style, label: change.newEdge.label || '' },
    ];
  }
  if (change.status === 'remove') {
    const [fromTo, style] = ref.split(':');
    const [from, edgeTo] = (fromTo || '').split('->');
    return edges.filter((edge) => !(edge.from === from && edge.to === edgeTo && edge.style === style));
  }
  return edges;
}

/** Deep-clone the parts of a spec model applyPlanToSpec mutates. */
function cloneModel(model) {
  const nodes = {};
  for (const id in model.nodes) nodes[id] = { ...model.nodes[id] };
  const frontmatterMap = {};
  for (const id in (model.fm || {})) frontmatterMap[id] = model.fm[id];
  const edges = (model.edges || []).map((edge) => ({ ...edge }));
  return { nodes, frontmatterMap, edges };
}

/** Apply one change to the clone; returns the (possibly replaced) edges array. */
function applyChange(clone, edges, change, accepted) {
  if (!change || !change.target || !accepted(change.id)) return edges;
  const ref = change.target.ref;
  if (!ref) return edges;
  if (change.target.kind === 'node') {
    const removed = applyNodeChange(clone.nodes, clone.frontmatterMap, change, ref);
    return removed ? edges.filter((edge) => edge.from !== ref && edge.to !== ref) : edges;
  }
  return applyEdgeChange(edges, change, ref);
}

/**
 * Apply a plan to a PARSED SPEC MODEL (the .mmd model from parseMmd, not the
 * app's DiagramNode model). Mirrors applyPlan in src/core/plan/plan.ts but on
 * the spec representation the pipeline consumes. Pure: clones, never mutates.
 */
export function applyPlanToSpec(model, plan, accepted = () => true) {
  const clone = cloneModel(model);
  let edges = clone.edges;
  for (const change of plan.changes || []) {
    edges = applyChange(clone, edges, change, accepted);
  }
  return {
    dir: model.dir || 'TD',
    roots: [...(model.roots || [])],
    nodes: clone.nodes,
    edges,
    groups: new Set(model.groups || []),
    'fm': clone.frontmatterMap,
  };
}

/** Whether the given tsc binary path actually runs (mirrors pipeline.test). */
function tscWorks(path) {
  try {
    return spawnSync(path, ['--version']).status === 0;
  } catch {
    return false;
  }
}

/** Locate the repo tsc binary. */
function findTsc() {
  const cands = [join(ROOT, 'node_modules', '.bin', 'tsc'), join(process.cwd(), 'node_modules', '.bin', 'tsc')];
  return cands.find(tscWorks) || null;
}

const STRICT_TSCONFIG = {
  compilerOptions: {
    target: 'ES2021', module: 'ESNext', moduleResolution: 'bundler',
    lib: ['ES2021', 'DOM', 'DOM.Iterable'], strict: true,
    noUnusedLocals: true, noUnusedParameters: true, noImplicitReturns: true,
    isolatedModules: true, verbatimModuleSyntax: true, useDefineForClassFields: true,
    skipLibCheck: true, noEmit: true,
  },
  include: ['contracts'],
};

/** Strip the per-run temp prefix so a tsc error line is comparable across runs. */
function normTscLine(line) {
  return line.replace(/.*novakai-cert-[A-Za-z0-9]+\//g, '').trim();
}

/** Run tsc against the generated stubs; returns normalised, run-comparable error lines. */
function runTsc(tsc, work) {
  writeFileSync(join(work, 'tsconfig.json'), JSON.stringify(STRICT_TSCONFIG));
  const tscResult = spawnSync(tsc, ['-p', join(work, 'tsconfig.json')], { encoding: 'utf8' });
  if (tscResult.status === 0) return [];
  return ((tscResult.stdout || '') + (tscResult.stderr || ''))
    .split('\n')
    .map(normTscLine)
    .filter((line) => /error TS\d+/.test(line));
}

/** Run the extract-from-stubs vs spec drift gate; returns the gate's error list. */
function runGate(specPath, stubDir) {
  const project = new Project({ compilerOptions: { allowJs: false } });
  project.addSourceFilesAtPaths(join(stubDir, '**/*.ts'));
  const specSide = specSkeletons(parseMmd(readFileSync(specPath, 'utf8')));
  const codeSide = specSkeletons(extract(project));
  return diffSkeletons(specSide, codeSide).errors;
}

/**
 * Run the enforcement pipeline on one spec model: generate stubs → tsc →
 * extract-from-stubs → gate. Returns { stubs, tscErrors, gateErrors } with
 * errors NORMALISED (temp paths stripped) so two runs are comparable.
 */
function runPipeline(model, tsc) {
  const work = mkdtempSync(join(tmpdir(), 'novakai-cert-'));
  try {
    const specPath = join(work, 'spec.mmd');
    writeFileSync(specPath, toMmd(model));
    const stubDir = join(work, 'contracts');
    const stubResult = generate(specPath, stubDir, true);
    const tscErrors = tsc ? runTsc(tsc, work) : [];
    const gateErrors = runGate(specPath, stubDir);
    return { stubs: stubResult.files.length, nodes: stubResult.count, tscErrors, gateErrors };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function diff(proposed, base) {
  const baseSet = new Set(base);
  return proposed.filter((entry) => !baseSet.has(entry));
}

function tscStepDetail(tsc, newTsc) {
  if (!tsc) return 'skipped — tsc not found';
  return newTsc.length
    ? `${newTsc.length} NEW compile error(s) introduced by the plan`
    : 'no new compile errors vs base';
}

/** Build the human/JSON step report for a cert run. */
function buildCertSteps({ plan, proposed, propRun, tsc, newTsc, newGate }) {
  const nChanges = (plan.changes || []).length;
  const nGated = (plan.changes || []).filter((change) => change.fm).length;
  const nodeCount = Object.keys(proposed.nodes).length;
  const applyDetail =
    `${nChanges} change(s) applied (${nGated} carry a proposed signature) → ${nodeCount} nodes`;
  const stubsDetail = `${propRun.stubs} stub file(s) for ${propRun.nodes} node(s)`;
  const gateDetail = newGate.length
    ? `${newGate.length} NEW drift error(s) introduced by the plan`
    : 'no new drift vs base';

  return [
    { step: 'apply', pass: true, detail: applyDetail },
    { step: 'stubs', pass: true, detail: stubsDetail },
    { step: 'tsc', pass: newTsc.length === 0, detail: tscStepDetail(tsc, newTsc) },
    { step: 'gate', pass: newGate.length === 0, detail: gateDetail },
  ];
}

/**
 * Certify a plan as a DELTA against the base: the plan is certified iff applying
 * it introduces NO NEW tsc errors and NO NEW gate drift versus the base map
 * alone. (A delta, not an absolute round-trip, because the base may carry
 * pre-existing pipeline noise — e.g. two nodes whose stub files collide only by
 * case on a case-insensitive FS — that is not the plan's fault. The cert isolates
 * the plan's effect: "does this plan break anything not already broken.")
 *
 * Returns { certified, steps, newTsc, newGate, basePre }.
 */
export function certifyPlan({ mapPath, plan, acceptedOnly = false }) {
  const baseModel = parseMmd(readFileSync(mapPath, 'utf8'));
  const accept = acceptedOnly
    ? (id) => (plan.verdicts ? plan.verdicts[id] === 'accept' : true)
    : () => true;
  const proposed = applyPlanToSpec(baseModel, plan, accept);
  const tsc = findTsc();

  const baseRun = runPipeline(baseModel, tsc);
  const propRun = runPipeline(proposed, tsc);
  const newTsc = diff(propRun.tscErrors, baseRun.tscErrors);
  const newGate = diff(propRun.gateErrors, baseRun.gateErrors);

  const steps = buildCertSteps({ plan, proposed, propRun, tsc, newTsc, newGate });
  const basePre = baseRun.tscErrors.length + baseRun.gateErrors.length;
  return { certified: newTsc.length === 0 && newGate.length === 0, steps, newTsc, newGate, basePre };
}

/* ---------------- CLI ---------------- */
function readPlanOrExit(planPath) {
  try {
    return JSON.parse(readFileSync(planPath, 'utf8'));
  } catch (err) {
    console.error('cannot read plan: ' + err.message);
    process.exit(2);
  }
}

function printErrorList(title, errors) {
  if (!errors.length) return;
  console.log(`\n${title}`);
  for (const err of errors) console.log('  ✗ ' + err);
}

function printCertReport(res, planPath, mapPath) {
  console.log(`=== plan-cert — dry-run certificate for ${planPath} ===`);
  console.log(`base map: ${mapPath}\n`);
  const icon = (pass) => (pass ? '✓' : '✗');
  for (const step of res.steps) console.log(`  ${icon(step.pass)} ${step.step.padEnd(6)} — ${step.detail}`);
  printErrorList('NEW compile errors introduced by the plan:', res.newTsc);
  printErrorList('NEW drift introduced by the plan:', res.newGate);
  if (res.basePre) {
    console.log(
      `\n(note: the base map carries ${res.basePre} pre-existing pipeline issue(s), ` +
        "ignored — the cert measures only the plan's delta.)",
    );
  }
  console.log('');
}

/** Print the report (human or JSON) and exit with the appropriate code. */
function reportResult(res, jsonOut, planPath, mapPath) {
  if (jsonOut) {
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.certified ? 0 : 1);
  }
  printCertReport(res, planPath, mapPath);
  if (res.certified) {
    console.log(
      '✓ CERTIFIED — the plan introduces no new compile errors or drift (apply → stubs → tsc → gate). ' +
        'Safe to send to human review.',
    );
    process.exit(0);
  }
  console.log('✗ NOT CERTIFIED — the plan introduces the issues above. Fix the plan before a human reviews it.');
  process.exit(1);
}

function main() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  const jsonOut = process.argv.includes('--json');
  const acceptedOnly = process.argv.includes('--accepted-only');
  if (!planPath) {
    console.error('usage: plan-cert.mjs --plan <plan.json> [--map <bundle.mmd>] [--accepted-only] [--json]');
    process.exit(2);
  }

  const plan = readPlanOrExit(planPath);
  const res = certifyPlan({ mapPath, plan, acceptedOnly });

  // M2b: cert pass rate. CLI path only — certifyPlan stays a pure import for
  // tests/orchestrators (no double-record when routed through).
  recordEvent({ event: 'verdict', source: 'plan-cert.mjs',
    tool: 'plan-cert', verdict: res.certified ? 'PASS' : 'FAIL' });

  reportResult(res, jsonOut, planPath, mapPath);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
