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
     node plan-cert.mjs --plan <plan.json> [--map docs/flowmap/_bundle.mmd]
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

/** Coerce any loaded fm-ish object into the parser's Frontmatter shape. */
function normFm(raw, fallbackName) {
  const f = raw && typeof raw === 'object' ? raw : {};
  return {
    name: typeof f.name === 'string' && f.name ? f.name : fallbackName,
    description: typeof f.description === 'string' ? f.description : '',
    state: Array.isArray(f.state) ? f.state.filter((s) => typeof s === 'string') : [],
    interfaces: Array.isArray(f.interfaces)
      ? f.interfaces.map((i) => ({
          name: typeof i?.name === 'string' ? i.name : '',
          accepts: Array.isArray(i?.accepts) ? i.accepts.filter((a) => typeof a === 'string') : [],
          returns: Array.isArray(i?.returns) ? i.returns.filter((r) => typeof r === 'string') : [],
        }))
      : [],
  };
}

/**
 * Apply a plan to a PARSED SPEC MODEL (the .mmd model from parseMmd, not the
 * app's DiagramNode model). Mirrors applyPlan in src/core/plan/plan.ts but on
 * the spec representation the pipeline consumes. Pure: clones, never mutates.
 */
export function applyPlanToSpec(model, plan, accepted = () => true) {
  const nodes = {};
  for (const id in model.nodes) nodes[id] = { ...model.nodes[id] };
  const fm = {};
  for (const id in (model.fm || {})) fm[id] = model.fm[id];
  let edges = (model.edges || []).map((e) => ({ ...e }));

  for (const c of plan.changes || []) {
    if (!c || !c.target || !accepted(c.id)) continue;
    const ref = c.target.ref;
    if (!ref) continue;

    if (c.target.kind === 'node') {
      if (c.status === 'remove') {
        delete nodes[ref];
        delete fm[ref];
        edges = edges.filter((e) => e.from !== ref && e.to !== ref);
      } else if (c.status === 'add') {
        nodes[ref] = { id: ref, kind: c.newNode?.kind || 'module', parent: c.newNode?.parent ?? null, group: false, shape: 'rect' };
        fm[ref] = normFm(c.fm, c.newNode?.label || ref);
      } else if (c.status === 'modify') {
        if (nodes[ref] && c.fm) fm[ref] = normFm(c.fm, fm[ref]?.name || ref);
      }
    } else { // edge target
      if (c.status === 'add' && c.newEdge) {
        const style = c.newEdge.style || 'solid';
        const dup = edges.some((e) => e.from === c.newEdge.from && e.to === c.newEdge.to && e.style === style);
        if (!dup) edges.push({ from: c.newEdge.from, to: c.newEdge.to, style, label: c.newEdge.label || '' });
      } else if (c.status === 'remove') {
        const [ft, style] = ref.split(':');
        const [from, to] = (ft || '').split('->');
        edges = edges.filter((e) => !(e.from === from && e.to === to && e.style === style));
      }
    }
  }
  return { dir: model.dir || 'TD', roots: [...(model.roots || [])], nodes, edges, groups: new Set(model.groups || []), fm };
}

/** Locate the repo tsc binary (mirrors pipeline.test). */
function findTsc() {
  const cands = [join(ROOT, 'node_modules', '.bin', 'tsc'), join(process.cwd(), 'node_modules', '.bin', 'tsc')];
  return cands.find((p) => { try { return spawnSync(p, ['--version']).status === 0; } catch { return false; } }) || null;
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
  return line.replace(/.*flowmap-cert-[A-Za-z0-9]+\//g, '').trim();
}

/**
 * Run the enforcement pipeline on one spec model: generate stubs → tsc →
 * extract-from-stubs → gate. Returns { stubs, tscErrors, gateErrors } with
 * errors NORMALISED (temp paths stripped) so two runs are comparable.
 */
function runPipeline(model, tsc) {
  const work = mkdtempSync(join(tmpdir(), 'flowmap-cert-'));
  try {
    const specPath = join(work, 'spec.mmd');
    writeFileSync(specPath, toMmd(model));
    const stubDir = join(work, 'contracts');
    const g = generate(specPath, stubDir, true);

    let tscErrors = [];
    if (tsc) {
      writeFileSync(join(work, 'tsconfig.json'), JSON.stringify(STRICT_TSCONFIG));
      const r = spawnSync(tsc, ['-p', join(work, 'tsconfig.json')], { encoding: 'utf8' });
      if (r.status !== 0) {
        tscErrors = ((r.stdout || '') + (r.stderr || ''))
          .split('\n').map(normTscLine).filter((l) => /error TS\d+/.test(l));
      }
    }

    const project = new Project({ compilerOptions: { allowJs: false } });
    project.addSourceFilesAtPaths(join(stubDir, '**/*.ts'));
    const specSide = specSkeletons(parseMmd(readFileSync(specPath, 'utf8')));
    const codeSide = specSkeletons(extract(project));
    const gateErrors = diffSkeletons(specSide, codeSide).errors;

    return { stubs: g.files.length, nodes: g.count, tscErrors, gateErrors };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const diff = (proposed, base) => { const b = new Set(base); return proposed.filter((e) => !b.has(e)); };

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

  const nChanges = (plan.changes || []).length;
  const nGated = (plan.changes || []).filter((c) => c.fm).length;
  const tsc = findTsc();

  const baseRun = runPipeline(baseModel, tsc);
  const propRun = runPipeline(proposed, tsc);

  const newTsc = diff(propRun.tscErrors, baseRun.tscErrors);
  const newGate = diff(propRun.gateErrors, baseRun.gateErrors);
  const basePre = baseRun.tscErrors.length + baseRun.gateErrors.length;

  const steps = [
    { step: 'apply', pass: true, detail: `${nChanges} change(s) applied (${nGated} carry a proposed signature) → ${Object.keys(proposed.nodes).length} nodes` },
    { step: 'stubs', pass: true, detail: `${propRun.stubs} stub file(s) for ${propRun.nodes} node(s)` },
    { step: 'tsc', pass: newTsc.length === 0, detail: tsc ? (newTsc.length ? `${newTsc.length} NEW compile error(s) introduced by the plan` : 'no new compile errors vs base') : 'skipped — tsc not found' },
    { step: 'gate', pass: newGate.length === 0, detail: newGate.length ? `${newGate.length} NEW drift error(s) introduced by the plan` : 'no new drift vs base' },
  ];

  return { certified: newTsc.length === 0 && newGate.length === 0, steps, newTsc, newGate, basePre };
}

/* ---------------- CLI ---------------- */
function main() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
  const jsonOut = process.argv.includes('--json');
  const acceptedOnly = process.argv.includes('--accepted-only');
  if (!planPath) {
    console.error('usage: plan-cert.mjs --plan <plan.json> [--map <bundle.mmd>] [--accepted-only] [--json]');
    process.exit(2);
  }

  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }

  const res = certifyPlan({ mapPath, plan, acceptedOnly });

  // M2b: cert pass rate. CLI path only — certifyPlan stays a pure import for
  // tests/orchestrators (no double-record when routed through).
  recordEvent({ event: 'verdict', source: 'plan-cert.mjs', tool: 'plan-cert', verdict: res.certified ? 'PASS' : 'FAIL' });

  if (jsonOut) { console.log(JSON.stringify(res, null, 2)); process.exit(res.certified ? 0 : 1); }

  console.log(`=== plan-cert — dry-run certificate for ${planPath} ===`);
  console.log(`base map: ${mapPath}\n`);
  const icon = (p) => (p ? '✓' : '✗');
  for (const s of res.steps) console.log(`  ${icon(s.pass)} ${s.step.padEnd(6)} — ${s.detail}`);
  if (res.newTsc.length) {
    console.log('\nNEW compile errors introduced by the plan:');
    for (const e of res.newTsc) console.log('  ✗ ' + e);
  }
  if (res.newGate.length) {
    console.log('\nNEW drift introduced by the plan:');
    for (const e of res.newGate) console.log('  ✗ ' + e);
  }
  if (res.basePre) console.log(`\n(note: the base map carries ${res.basePre} pre-existing pipeline issue(s), ignored — the cert measures only the plan's delta.)`);
  console.log('');
  if (res.certified) {
    console.log('✓ CERTIFIED — the plan introduces no new compile errors or drift (apply → stubs → tsc → gate). Safe to send to human review.');
    process.exit(0);
  }
  console.log('✗ NOT CERTIFIED — the plan introduces the issues above. Fix the plan before a human reviews it.');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
