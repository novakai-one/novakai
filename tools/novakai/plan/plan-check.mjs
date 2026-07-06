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

/**
 * Pure coherence checker. Does not read files.
 *
 * @param {{ mapNodeIds: Set<string>, plan: object }} opts
 * @returns {{ problems: string[], stats: object }}
 */
export function checkPlan({ mapNodeIds, plan }) {
  const problems = [];
  const notes = [];
  const changes = plan.changes || [];
  const verdicts = plan.verdicts || {};

  // Index changes by id for fast lookup
  const changeById = new Map();
  for (const c of changes) {
    if (c && c.id) changeById.set(c.id, c);
  }

  // Set of refs introduced by add-node changes (for PARENT-EXISTS)
  const addNodeRefs = new Set();
  for (const c of changes) {
    if (c && c.target?.kind === 'node' && c.status === 'add' && c.target.ref) {
      addNodeRefs.add(c.target.ref);
    }
  }

  // ── 1. REAL-IDS ────────────────────────────────────────────────────────────
  // modify/remove node: ref must exist in base map
  // add node: ref must NOT exist in base map
  for (const c of changes) {
    if (!c || c.target?.kind !== 'node') continue;
    const ref = c.target.ref;
    if (!ref) continue;
    if (c.status === 'modify' || c.status === 'remove') {
      if (!mapNodeIds.has(ref)) {
        problems.push(
          `REAL-IDS: change "${c.id}" ${c.status}s node "${ref}" which does not exist in the base map`,
        );
      }
    } else if (c.status === 'add') {
      if (mapNodeIds.has(ref)) {
        if (c.preLanded) {
          // Explicit escape hatch (mirrors audited-exclusion style): the arc
          // deliberately pre-lands this add's map node ahead of the code so a
          // later change can emit its packet before the code exists.
          notes.push(`REAL-IDS: "${c.id}" add pre-landed (declared preLanded)`);
          continue;
        }
        problems.push(
          `REAL-IDS: change "${c.id}" adds node "${ref}" which already exists in the base map`,
        );
      }
    }
  }

  // ── 2. DANGLING-DEP ────────────────────────────────────────────────────────
  // every dependsOn entry must be the id of another change in the same plan
  for (const c of changes) {
    if (!c || !c.dependsOn?.length) continue;
    for (const depId of c.dependsOn) {
      if (!changeById.has(depId)) {
        problems.push(
          `DANGLING-DEP: change "${c.id}" dependsOn "${depId}" which is not a change id in this plan`,
        );
      }
    }
  }

  // ── 3. ACYCLIC ─────────────────────────────────────────────────────────────
  // DFS cycle detection with coloring: WHITE=unseen, GRAY=in-stack, BLACK=done
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();

  function dfs(id, path) {
    color.set(id, GRAY);
    const c = changeById.get(id);
    for (const depId of (c?.dependsOn || [])) {
      if (!changeById.has(depId)) continue; // already caught by DANGLING-DEP
      if (color.get(depId) === GRAY) {
        // Back-edge → cycle found; extract and report it
        const cycleStart = path.indexOf(depId);
        const cycle = path.slice(cycleStart).concat(depId);
        problems.push(`ACYCLIC: cycle detected in dependsOn: ${cycle.join(' → ')}`);
        continue;
      }
      if ((color.get(depId) ?? WHITE) !== BLACK) {
        dfs(depId, [...path, depId]);
      }
    }
    color.set(id, BLACK);
  }

  for (const c of changes) {
    if (!c || !c.id) continue;
    if ((color.get(c.id) ?? WHITE) === WHITE) dfs(c.id, [c.id]);
  }

  // ── 4. PARENT-EXISTS ───────────────────────────────────────────────────────
  // an add change's newNode.parent (when non-null/empty) must be a real base
  // node id OR the ref of another add change in this plan
  for (const c of changes) {
    if (!c || c.target?.kind !== 'node' || c.status !== 'add') continue;
    const parent = c.newNode?.parent;
    if (parent == null || parent === '') continue; // top-level placement, fine
    if (!mapNodeIds.has(parent) && !addNodeRefs.has(parent)) {
      problems.push(
        `PARENT-EXISTS: change "${c.id}" adds node with parent "${parent}" which is neither in the base map nor the ref of another add change in this plan`,
      );
    }
  }

  // ── 5. COHERENT-ACCEPTED ───────────────────────────────────────────────────
  // Mirror of coherenceWarnings in src/core/plan/plan.ts, extended to be
  // TRANSITIVE: an accepted change must not have any rejected change anywhere
  // in its full dependsOn closure (not just direct deps).
  // Only runs when the plan carries verdicts.
  if (Object.keys(verdicts).length > 0) {
    /** Collect the full transitive set of dep ids reachable from startId. */
    function transitiveDepIds(startId, visited = new Set()) {
      if (visited.has(startId)) return visited;
      visited.add(startId);
      const c = changeById.get(startId);
      for (const depId of (c?.dependsOn || [])) {
        if (changeById.has(depId)) transitiveDepIds(depId, visited);
      }
      return visited;
    }

    for (const c of changes) {
      if (!c || !c.id || verdicts[c.id] !== 'accept') continue;
      if (!c.dependsOn?.length) continue;
      const allDeps = transitiveDepIds(c.id);
      allDeps.delete(c.id); // exclude self
      for (const depId of allDeps) {
        if (verdicts[depId] === 'reject') {
          problems.push(
            `COHERENT-ACCEPTED: change "${c.id}" is accepted but transitively depends on "${depId}" which is rejected`,
          );
        }
      }
    }
  }

  const stats = {
    changes: changes.length,
    depsChecked: changes.reduce((n, c) => n + (c?.dependsOn?.length || 0), 0),
    nodeChanges: changes.filter((c) => c?.target?.kind === 'node').length,
    edgeChanges: changes.filter((c) => c?.target?.kind === 'edge').length,
    verdictsPresent: Object.keys(verdicts).length > 0,
  };

  return { problems, stats, notes };
}

/* ---------------- CLI ---------------- */
function main() {
  const planPath = arg('--plan');
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  const jsonOut = process.argv.includes('--json');

  if (!planPath) {
    console.error('usage: plan-check.mjs --plan <plan.json> [--map <bundle.mmd>] [--json]');
    process.exit(2);
  }

  let plan;
  try { plan = JSON.parse(readFileSync(planPath, 'utf8')); }
  catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }

  let mapModel;
  try { mapModel = parseMmd(readFileSync(mapPath, 'utf8')); }
  catch (e) { console.error('cannot read map: ' + e.message); process.exit(2); }

  const mapNodeIds = new Set(Object.keys(mapModel.nodes || {}));
  const { problems, stats, notes } = checkPlan({ mapNodeIds, plan });

  if (jsonOut) {
    console.log(JSON.stringify({ problems, stats, notes }, null, 2));
    process.exit(problems.length > 0 ? 1 : 0);
  }

  if (problems.length === 0) {
    console.log(`✓ plan is coherent (${stats.changes} changes, ${stats.depsChecked} deps checked)`);
    for (const n of notes) console.log('  ✓ ' + n);
    process.exit(0);
  }

  console.log(`✗ plan has ${problems.length} coherence problem(s):`);
  for (const p of problems) console.log('  ✗ ' + p);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
