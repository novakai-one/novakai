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

   editScope (C1): {allow, deny}. allow = the target's OWN module files
   (its units' src paths + colocated fragment + sibling *.test.* globs,
   plus optional change.touches) — NEVER the blastRadius cone (a util
   change must not open the whole app). deny = FROZEN (../lib/scope.mjs),
   always. Consumed by the subagent edit-gate via matchScope(file, editScope).

   verification (C5' packet side, optional on a change): {kind, journeys}.
   kind defaults "pure" (zero migration for existing plans). kind dom/visual
   with no journeys is incoherent (coherenceProblems, coherent:false) — a UI
   change with nothing to prove it happened is not a real contract.

   Usage:
     node contract.mjs --change <id> [--plan public/plan.json]
                       [--map docs/novakai/_bundle.mmd]
                       [--bodies public/bodies.json] [--json]
   Exit: 0 = packet emitted, 2 = bad invocation, 3 = change id not in plan,
         4 = slice-completeness gate failed (a called symbol is missing
             from the slice and not declared in the change's outOfScope).
   With --json: stdout is the canonical packet (byte-stable; safe to hash).
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname, basename, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';
import { sliceModel, filterBodies } from '../../buildspec/core/slice-core.mjs';
import { srcDirectives } from '../../buildspec/acceptance/acceptance.mjs';
import { checkPlan } from '../plan/plan-check.mjs';
import { canonicalJSON, hashOf } from '../lib/canonical.mjs';
import { FROZEN } from '../lib/scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const CHANGE = arg('--change');
const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
const BODIES = arg('--bodies', join(ROOT, 'public', 'bodies.json'));
const JSON_OUT = process.argv.includes('--json');

if (!CHANGE) {
  console.error('usage: contract.mjs --change <id> [--plan <plan.json>] [--map <bundle.mmd>] [--bodies <bodies.json>] [--json]');
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

// dependency-cone slice: what the target CALLS (down), so the packet is self-sufficient.
// (blastRadius above is consumers/up — advisory context, not the slice basis; see plan WI-4.)
let subMap = null;
let slicedBodies = null;
if (isNode && ref) {
  let bodiesJson;
  try { bodiesJson = JSON.parse(readFileSync(resolve(BODIES), 'utf8')); }
  catch (e) {
    console.error(`contract: bodies file not found at ${resolve(BODIES)} — run \`npm run novakai:bodies\` (or pass --bodies)`);
    process.exit(2);
  }
  const bodiesMap = new Map(Object.entries(bodiesJson));

  // Seed the target and close transitively over what it REALLY calls
  // (ts-morph calls[], not map edges) — every mapped callee is pulled in, so
  // the packet is SUFFICIENT by construction: a 0-context subagent never gets a
  // packet missing a dependency. An unmapped/external callee has no node to
  // package, so it stays for the completeness gate below (needs an explicit
  // outOfScope). up-consumers are advisory and live in blastRadius, never here.
  // (Was { up, refs } — the panel's lean human view; that pulls in body-less
  // ancestors like main and drops real callees, so it can't be the packet basis.)
  const outOfScope = new Set(change.outOfScope ?? []);
  const keepIds = new Set([ref].filter((id) => mapModel.nodes[id]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const id of [...keepIds]) {
      for (const calleeId of bodiesJson[id]?.calls ?? []) {
        if (keepIds.has(calleeId) || outOfScope.has(calleeId)) continue;
        if (mapModel.nodes[calleeId]) { keepIds.add(calleeId); grew = true; }
      }
    }
  }

  const sliced = sliceModel(mapModel, [...keepIds], {});
  subMap = { dir: sliced.dir, roots: sliced.roots, nodes: sliced.nodes, edges: sliced.edges, groups: [...sliced.groups], fm: sliced.fm };
  slicedBodies = Object.fromEntries(filterBodies(bodiesMap, keepIds));

  // ---- slice-completeness gate (WI-5, the keystone) ----
  // The cone above already contains every MAPPED callee; this gate now only
  // fires on a callee with no node at all (external/unmapped) — which cannot be
  // packaged, so it must be explicitly declared out-of-scope on the change.
  // Fail closed: name the gap, exit non-zero.
  const missing = new Set();
  for (const id of keepIds) {
    const b = bodiesJson[id];
    if (!b || !Array.isArray(b.calls)) continue;
    for (const calleeId of b.calls) {
      if (!keepIds.has(calleeId) && !outOfScope.has(calleeId)) missing.add(calleeId);
    }
  }
  if (missing.size) {
    console.error(
      `slice-completeness gate FAILED for change "${CHANGE}": called symbol(s) missing from the slice and not declared in outOfScope: ${[...missing].join(', ')}`,
    );
    process.exit(4);
  }
}

// editScope (C1): allow = the target module's OWN files, never the blast-radius
// cone (a util change must not open the whole app). owner = the id segment
// before '__' (node ref), or the edge's `from` node (edge ref "a->b:style").
// Narrow scope is tolerable because out-of-allow is warn (scope.mjs), not deny.
function ownerOf(ch) {
  const r = ch.target?.ref;
  if (!r) return null;
  if (ch.target.kind === 'edge') {
    const i = r.indexOf('->');
    return i >= 0 ? r.slice(0, i) : r;
  }
  const i = r.indexOf('__');
  return i >= 0 ? r.slice(0, i) : r;
}

const owner = ownerOf(change);
const allow = new Set();
let ownerDir = null;
if (owner) {
  for (const [id, s] of Object.entries(srcMap)) {
    if (id === owner || id.startsWith(owner + '__')) {
      allow.add(s.path);
      if (!ownerDir) ownerDir = dirname(s.path);
    }
  }
}
if (!ownerDir && source?.path) ownerDir = dirname(source.path);
// sibling *.test.* globs for the source files only, before the fragment path
// joins the set (a fragment has no "test" sibling of its own).
for (const path of [...allow]) {
  allow.add(join(dirname(path), `${basename(path).replace(/\.[^.]+$/, '')}.test.*`));
}
if (ownerDir && owner) allow.add(join(ownerDir, `${owner}.novakai.mmd`));
for (const t of change.touches ?? []) allow.add(t);
const editScope = { allow: [...allow].sort(), deny: FROZEN };

// verification (C5' packet side): optional per-change proof obligations.
// Default kind "pure", no journeys — absent block is fully backwards
// compatible. A dom/visual change with no journeys is an incoherent
// contract (a UI change with nothing to prove it happened).
const VERIFICATION_KINDS = new Set(['pure', 'dom', 'visual', 'tooling']);
const rawVerification = change.verification && typeof change.verification === 'object' ? change.verification : null;
const verification = {
  kind: rawVerification && VERIFICATION_KINDS.has(rawVerification.kind) ? rawVerification.kind : 'pure',
  journeys: rawVerification && Array.isArray(rawVerification.journeys) ? rawVerification.journeys : [],
};
const verificationProblems = [];
if ((verification.kind === 'dom' || verification.kind === 'visual') && verification.journeys.length === 0) {
  verificationProblems.push(
    `change "${CHANGE}" declares verification.kind="${verification.kind}" but has no journeys — a DOM/visual change needs at least one proof obligation`,
  );
}

// coherence as DATA (pure checkPlan, deterministic). Scoped problems + plan-wide flag.
const mapNodeIds = new Set(Object.keys(mapModel.nodes || {}));
const { problems } = checkPlan({ mapNodeIds, plan });
const myProblems = [...problems.filter((p) => p.includes(`"${CHANGE}"`)), ...verificationProblems];

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
  subMap,
  slicedBodies,
  editScope,
  verification,
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
console.log(`  dep cone    : ${subMap ? `${Object.keys(subMap.nodes).length} node(s) in subMap, ${Object.keys(slicedBodies).length} body/bodies sliced` : 'n/a (edge change)'}`);
console.log(`  deps        : ${body.deps.length ? body.deps.join(', ') : '(none)'}`);
console.log(`  editScope   : allow ${editScope.allow.length} path(s)${editScope.allow.length ? ' [' + editScope.allow.join(', ') + ']' : ''}; deny (FROZEN) ${editScope.deny.length} glob(s)`);
console.log(`  verification: kind=${verification.kind}${verification.journeys.length ? `, ${verification.journeys.length} journey(s)` : ''}`);
console.log(`  coherent    : ${body.coherent ? 'yes' : 'NO — ' + myProblems.join('; ')}`);
console.log(`  contractHash: ${packet.contractHash}`);
console.log(`\nRe-run with --json to get the canonical packet a subagent executes.`);

/* ---------- SPAWN PROMPT (C8'): dispatch = this command's output ----------
   The exact block a leader pastes into a subagent's prompt. sentinel line
   format is defined by contract-gate.mjs's SENTINEL regex; reproduced here
   with the real change id, never invented independently. */
console.log(`\n=== SPAWN PROMPT — paste into the subagent's prompt ===`);
console.log(`NOVAKAI-CONTRACT:${CHANGE}`);
console.log(`\nRegenerate the packet:  npm run --silent novakai:contract -- --change ${CHANGE} --json`);
console.log(`editScope: allow ${editScope.allow.length} path(s) (own module only, never the blast-radius cone); deny (FROZEN, always blocked): ${editScope.deny.join(', ')}`);
if (editScope.allow.length) console.log(`  allow: ${editScope.allow.join(', ')}`);
console.log(`Proof obligations: ${verification.journeys.length
  ? verification.journeys.map((j) => `${j.spec}${j.grep ? ` (grep: ${j.grep})` : ''}`).join('; ')
  : `(none — kind: ${verification.kind})`}`);
console.log(`Done-criteria: npm run --silent novakai:verify-change -- --change ${CHANGE} --json --strict --drift-base <merge-base with origin/main> --drift-out <path> exits 0`);
process.exit(0);
