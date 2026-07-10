#!/usr/bin/env node
/* =====================================================================
   plan-check.mjs — C3: authoring-time coherence for plan.json
   ---------------------------------------------------------------------
   Validates a plan.json's internal coherence BEFORE it reaches the
   visual review UI. Four structural checks + one semantic check:

     REAL-IDS        — modify/remove refs exist in base map; add refs don't
     DANGLING-DEP    — every dependsOn entry is an id of another change
     ACYCLIC         — the dependsOn graph has no cycle
     PARENT-EXISTS   — add.newNode.parent is a real base node or another add
     COHERENT-ACCEPTED — no accepted change's transitive deps are rejected

   Usage:
     node plan-check.mjs --plan <plan.json> [--map docs/novakai/_bundle.mmd] [--json]
   Exit: 0 = coherent, 1 = problems found, 2 = bad args.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** REAL-IDS for a modify/remove change: ref must already exist in the base map. */
function checkRealIdsModifyOrRemove(change, ref, mapNodeIds) {
  if (mapNodeIds.has(ref)) return null;
  return `REAL-IDS: change "${change.id}" ${change.status}s node "${ref}" which does not exist in the base map`;
}

/** REAL-IDS for an add change: ref must NOT already exist, unless declared preLanded. */
function checkRealIdsAdd(change, ref, mapNodeIds) {
  if (!mapNodeIds.has(ref)) return {};
  if (change.preLanded) {
    // Explicit escape hatch (mirrors audited-exclusion style): the arc
    // deliberately pre-lands this add's map node ahead of the code so a
    // later change can emit its packet before the code exists.
    return { note: `REAL-IDS: "${change.id}" add pre-landed (declared preLanded)` };
  }
  return { problem: `REAL-IDS: change "${change.id}" adds node "${ref}" which already exists in the base map` };
}

/** REAL-IDS verdict for one change: { problem? } | { note? } | null when not applicable. */
function checkRealIdsForChange(change, mapNodeIds) {
  if (!change || change.target?.kind !== 'node' || !change.target.ref) return null;
  const ref = change.target.ref;
  if (change.status === 'modify' || change.status === 'remove') {
    const problem = checkRealIdsModifyOrRemove(change, ref, mapNodeIds);
    return problem ? { problem } : null;
  }
  if (change.status === 'add') return checkRealIdsAdd(change, ref, mapNodeIds);
  return null;
}

/** REAL-IDS: modify/remove refs must exist in base map; add refs must not (unless preLanded). */
function checkRealIds(changes, mapNodeIds) {
  const problems = [];
  const notes = [];
  for (const change of changes) {
    const result = checkRealIdsForChange(change, mapNodeIds);
    if (result?.problem) problems.push(result.problem);
    if (result?.note) notes.push(result.note);
  }
  return { problems, notes };
}

/** DANGLING-DEP: every dependsOn entry must be the id of another change in the same plan. */
function checkDanglingDep(changes, changeById) {
  const problems = [];
  for (const change of changes) {
    if (!change || !change.dependsOn?.length) continue;
    for (const depId of change.dependsOn) {
      if (!changeById.has(depId)) {
        problems.push(
          `DANGLING-DEP: change "${change.id}" dependsOn "${depId}" which is not a change id in this plan`,
        );
      }
    }
  }
  return problems;
}

/** DFS visit for ACYCLIC: WHITE=unseen, GRAY=in-stack, BLACK=done. Mutates ctx.problems/ctx.color. */
function acyclicVisit(id, path, ctx) {
  ctx.color.set(id, ctx.GRAY);
  const change = ctx.changeById.get(id);
  for (const depId of (change?.dependsOn || [])) {
    if (!ctx.changeById.has(depId)) continue; // already caught by DANGLING-DEP
    if (ctx.color.get(depId) === ctx.GRAY) {
      // Back-edge → cycle found; extract and report it
      const cycleStart = path.indexOf(depId);
      const cycle = path.slice(cycleStart).concat(depId);
      ctx.problems.push(`ACYCLIC: cycle detected in dependsOn: ${cycle.join(' → ')}`);
      continue;
    }
    if ((ctx.color.get(depId) ?? ctx.WHITE) !== ctx.BLACK) {
      acyclicVisit(depId, [...path, depId], ctx);
    }
  }
  ctx.color.set(id, ctx.BLACK);
}

/** ACYCLIC: the dependsOn graph has no cycle (DFS with WHITE/GRAY/BLACK coloring). */
function checkAcyclic(changes, changeById) {
  const problems = [];
  const ctx = { changeById, color: new Map(), problems, WHITE: 0, GRAY: 1, BLACK: 2 };
  for (const change of changes) {
    if (!change || !change.id) continue;
    if ((ctx.color.get(change.id) ?? ctx.WHITE) === ctx.WHITE) acyclicVisit(change.id, [change.id], ctx);
  }
  return problems;
}

/** Whether an add's parent is a real base node, another add's ref, or unset (top-level). */
function parentIsValid(parent, mapNodeIds, addNodeRefs) {
  return parent == null || parent === '' || mapNodeIds.has(parent) || addNodeRefs.has(parent);
}

/** PARENT-EXISTS: an add's newNode.parent must be a real base node or another add's ref. */
function checkParentExists(changes, mapNodeIds, addNodeRefs) {
  const problems = [];
  for (const change of changes) {
    if (!change || change.target?.kind !== 'node' || change.status !== 'add') continue;
    const parent = change.newNode?.parent;
    if (parentIsValid(parent, mapNodeIds, addNodeRefs)) continue;
    problems.push(
      `PARENT-EXISTS: change "${change.id}" adds node with parent "${parent}" which is neither ` +
        'in the base map nor the ref of another add change in this plan',
    );
  }
  return problems;
}

/** Collect the full transitive set of dep ids reachable from startId. */
function transitiveDepIds(changeById, startId, visited = new Set()) {
  if (visited.has(startId)) return visited;
  visited.add(startId);
  const change = changeById.get(startId);
  for (const depId of (change?.dependsOn || [])) {
    if (changeById.has(depId)) transitiveDepIds(changeById, depId, visited);
  }
  return visited;
}

/**
 * COHERENT-ACCEPTED: mirror of coherenceWarnings in src/core/plan/plan.ts,
 * extended to be TRANSITIVE — an accepted change must not have any rejected
 * change anywhere in its full dependsOn closure. Only runs when the plan
 * carries verdicts.
 */
function checkCoherentAccepted(changes, changeById, verdicts) {
  const problems = [];
  if (Object.keys(verdicts).length === 0) return problems;
  for (const change of changes) {
    if (!change || !change.id || verdicts[change.id] !== 'accept') continue;
    if (!change.dependsOn?.length) continue;
    const allDeps = transitiveDepIds(changeById, change.id);
    allDeps.delete(change.id); // exclude self
    for (const depId of allDeps) {
      if (verdicts[depId] === 'reject') {
        problems.push(
          `COHERENT-ACCEPTED: change "${change.id}" is accepted but transitively depends on ` +
            `"${depId}" which is rejected`,
        );
      }
    }
  }
  return problems;
}

/** Index changes by id, and collect the refs introduced by add-node changes. */
function indexChanges(changes) {
  const changeById = new Map();
  const addNodeRefs = new Set();
  for (const change of changes) {
    if (change && change.id) changeById.set(change.id, change);
    if (change && change.target?.kind === 'node' && change.status === 'add' && change.target.ref) {
      addNodeRefs.add(change.target.ref);
    }
  }
  return { changeById, addNodeRefs };
}

/** Summary stats reported alongside the coherence problems. */
function planStats(changes, verdicts) {
  return {
    changes: changes.length,
    depsChecked: changes.reduce((total, change) => total + (change?.dependsOn?.length || 0), 0),
    nodeChanges: changes.filter((change) => change?.target?.kind === 'node').length,
    edgeChanges: changes.filter((change) => change?.target?.kind === 'edge').length,
    verdictsPresent: Object.keys(verdicts).length > 0,
  };
}

/**
 * Pure coherence checker. Does not read files.
 *
 * @param {{ mapNodeIds: Set<string>, plan: object }} opts
 * @returns {{ problems: string[], stats: object }}
 */
export function checkPlan({ mapNodeIds, plan }) {
  const changes = plan.changes || [];
  const verdicts = plan.verdicts || {};
  const { changeById, addNodeRefs } = indexChanges(changes);

  const realIds = checkRealIds(changes, mapNodeIds);
  const problems = [
    ...realIds.problems,
    ...checkDanglingDep(changes, changeById),
    ...checkAcyclic(changes, changeById),
    ...checkParentExists(changes, mapNodeIds, addNodeRefs),
    ...checkCoherentAccepted(changes, changeById, verdicts),
  ];

  return { problems, stats: planStats(changes, verdicts), notes: realIds.notes };
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

function readMapOrExit(mapPath) {
  try {
    return parseMmd(readFileSync(mapPath, 'utf8'));
  } catch (err) {
    console.error('cannot read map: ' + err.message);
    process.exit(2);
  }
}

/** Print the human-readable report; returns true iff the plan is coherent. */
function printCheckReport(problems, stats, notes) {
  if (problems.length === 0) {
    console.log(`✓ plan is coherent (${stats.changes} changes, ${stats.depsChecked} deps checked)`);
    for (const note of notes) console.log('  ✓ ' + note);
    return true;
  }
  console.log(`✗ plan has ${problems.length} coherence problem(s):`);
  for (const problem of problems) console.log('  ✗ ' + problem);
  return false;
}

/** Read the plan + map and run the coherence checker. */
function runCheck(planPath, mapPath) {
  const plan = readPlanOrExit(planPath);
  const mapModel = readMapOrExit(mapPath);
  const mapNodeIds = new Set(Object.keys(mapModel.nodes || {}));
  return checkPlan({ mapNodeIds, plan });
}

function main() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  const jsonOut = process.argv.includes('--json');

  if (!planPath) {
    console.error('usage: plan-check.mjs --plan <plan.json> [--map <bundle.mmd>] [--json]');
    process.exit(2);
  }

  const { problems, stats, notes } = runCheck(planPath, mapPath);

  if (jsonOut) {
    console.log(JSON.stringify({ problems, stats, notes }, null, 2));
    process.exit(problems.length > 0 ? 1 : 0);
  }

  const coherent = printCheckReport(problems, stats, notes);
  process.exit(coherent ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
