#!/usr/bin/env node
/* =====================================================================
   contract.mjs — emit a self-contained, byte-deterministic EXECUTION
   PACKET for ONE plan change (the subagent-contract spine, node #1).
   ---------------------------------------------------------------------
   A 0-context subagent that is told to "implement change X" must receive
   everything it needs and NOTHING it has to interpret from prose: the
   target, the file+symbol to touch, the proposed signature, the
   behavioural acceptance cases that define done, the blast radius it may
   ripple into, and its dependencies. That packet is this command's output.

   It ROUTES to existing computation — it does not recompute:
     • parseMmd            (../../buildspec/core/mmd-parse.mjs)  — nodes + edges
     • srcDirectives       (../../buildspec/acceptance/acceptance.mjs) — id -> path#symbol
     • downstreamCone      (src/core/plan/plan.ts, REAL fn via strip-types) — blast radius
     • checkPlan           (../plan/plan-check.mjs)            — coherence (as DATA)
     • canonicalJSON/hashOf (../lib/canonical.mjs)        — byte-determinism

   Usage:
     node contract.mjs --change <id> [--plan public/plan.json]
                       [--map docs/novakai/_bundle.mmd] [--json]
   Exit: 0 = packet emitted, 2 = bad invocation, 3 = change id not in plan.
   With --json: stdout is the canonical packet (byte-stable; safe to hash).
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';
import { srcDirectives } from '../../buildspec/acceptance/acceptance.mjs';
import { checkPlan } from '../plan/plan-check.mjs';
import { canonicalJSON, hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const CHANGE = arg('--change');
const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
const JSON_OUT = process.argv.includes('--json');

if (!CHANGE) {
  console.error('usage: contract.mjs --change <id> [--plan <plan.json>] [--map <bundle.mmd>] [--json]');
  process.exit(2);
}

/* ---------- subprocess: route to the REAL downstreamCone in plan.ts ----------
   plan.ts is TypeScript; the established repo pattern (acceptance.mjs:95) is a
   strip-types subprocess with a resolve hook for extensionless .ts imports. We
   reuse the single source of truth for the BFS rather than reimplement it. */
const CONE_SUB = `
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('.') && ctx.parentURL && !/\\.[^./]+$/.test(spec)) {
      const dir = fileURLToPath(new URL('.', ctx.parentURL));
      const ts = join(dir, spec + '.ts');
      if (existsSync(ts)) return { shortCircuit: true, url: pathToFileURL(ts).href };
    }
    return next(spec, ctx);
  },
});
const { planPath, edges, ref, roots } = JSON.parse(readFileSync(0, 'utf8'));
const mod = await import(pathToFileURL(planPath).href);
const cone = mod.downstreamCone(edges, ref, { roots });
console.log(JSON.stringify(cone));
`;

function computeCone(edges, ref, roots) {
  const planTs = join(ROOT, 'src', 'core', 'plan', 'plan.ts');
  const r = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', CONE_SUB], {
    input: JSON.stringify({ planPath: planTs, edges, ref, roots }),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (r.status !== 0 || !r.stdout) {
    throw new Error('downstreamCone subprocess failed: ' + String(r.stderr || '').slice(0, 300));
  }
  return JSON.parse(r.stdout);
}

/* ---------- load + route ---------- */
let plan, mapText, mapModel;
try { plan = JSON.parse(readFileSync(resolve(PLAN), 'utf8')); }
catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }
try { mapText = readFileSync(resolve(MAP), 'utf8'); mapModel = parseMmd(mapText); }
catch (e) { console.error('cannot read map: ' + e.message); process.exit(2); }

const change = (plan.changes || []).find((c) => c && c.id === CHANGE);
if (!change) {
  console.error(`change "${CHANGE}" not found in ${relative(ROOT, resolve(PLAN))}`);
  process.exit(3);
}

const ref = change.target?.ref ?? null;
const isNode = change.target?.kind === 'node';

// source: id -> path#symbol (repo-relative path already). null when not yet mapped.
const srcMap = srcDirectives(mapText);
const source = ref && srcMap[ref] ? { path: srcMap[ref].path, symbol: srcMap[ref].symbol } : null;

// blast radius: the REAL downstreamCone (nodes only). Edge changes have none.
let blastRadius = null;
if (isNode && ref) {
  const cone = computeCone(mapModel.edges, ref, mapModel.roots || []);
  blastRadius = { affected: cone.affected, entryPoints: cone.entryPoints, maxDepth: cone.maxDepth };
}

// coherence as DATA (pure checkPlan, deterministic). Scoped problems + plan-wide flag.
const mapNodeIds = new Set(Object.keys(mapModel.nodes || {}));
const { problems } = checkPlan({ mapNodeIds, plan });
const myProblems = problems.filter((p) => p.includes(`"${CHANGE}"`));

const body = {
  contractVersion: 1,
  change: {
    id: change.id,
    status: change.status,
    target: change.target,
    phase: change.phase ?? null,
    risk: change.risk ?? null,
  },
  intent: change.intent ?? null,
  source,
  signature: change.fm ?? null,
  acceptance: change.acceptance ?? null,
  hasBehaviouralContract: !!(change.acceptance && Array.isArray(change.acceptance.cases) && change.acceptance.cases.length),
  blastRadius,
  deps: change.dependsOn ?? [],
  coherent: myProblems.length === 0,
  coherenceProblems: myProblems,
  planCoherent: problems.length === 0,
};
const packet = { ...body, contractHash: hashOf(body) };

if (JSON_OUT) {
  process.stdout.write(canonicalJSON(packet) + '\n');
  process.exit(0);
}

/* ---------- human summary (non --json) ---------- */
console.log(`=== contract packet — change "${CHANGE}" ===`);
console.log(`  target      : ${change.status} ${change.target?.kind} ${ref}`);
console.log(`  source      : ${source ? `${source.path}#${source.symbol}` : '(not yet mapped — unimplemented)'}`);
console.log(`  signature   : ${change.fm ? 'committed (see fm)' : 'none (structure-only)'}`);
console.log(`  behavioural : ${body.hasBehaviouralContract ? `${change.acceptance.cases.length} acceptance case(s)` : 'NONE — no Keystone-2 contract'}`);
console.log(`  blast radius: ${blastRadius ? `${blastRadius.affected.length} downstream node(s), maxDepth ${blastRadius.maxDepth}, entryPoints [${blastRadius.entryPoints.join(', ')}]` : 'n/a (edge change)'}`);
console.log(`  deps        : ${body.deps.length ? body.deps.join(', ') : '(none)'}`);
console.log(`  coherent    : ${body.coherent ? 'yes' : 'NO — ' + myProblems.join('; ')}`);
console.log(`  contractHash: ${packet.contractHash}`);
console.log(`\nRe-run with --json to get the canonical packet a subagent executes.`);
process.exit(0);
