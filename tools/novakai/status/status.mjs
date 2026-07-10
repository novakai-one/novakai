#!/usr/bin/env node
/* =====================================================================
   status.mjs — VERIFIED work-state of a build plan (Scenario-1 continuity)
   ---------------------------------------------------------------------
   "Where did the last session leave off?" must be a derived fact, never a
   prose note a new agent has to trust. This command loads a plan.json and,
   for every change, computes its real status by comparing the change's
   PROPOSED signature against the CURRENT CODE — extracted live with the
   same machinery the gate uses (extractFromMap -> specSkeletons). The
   verdict is recomputed from source every run, so it cannot go stale.

   Status per change:
     built    — code is in the proposed end-state (signature matches, or the
                node is present for a structure-only/add change, or removed
                for a remove change).
     pending  — not yet built (add not implemented+shipped; remove still
                present). This IS the build checklist.
     drifted  — the node exists but its signature differs from the proposed
                fm (someone built something else, or the plan moved on).
     missing  — a modify/remove targets a node that no longer exists in code.

   Node status is CODE-derived (real signatures via ts-morph). Edge status is
   map-derived and flagged as such (edges are not code-gated — see gate.mjs).

   Usage:
     node status.mjs --plan <plan.json> [--map docs/novakai/_bundle.mmd]
                     [--tsconfig tsconfig.json] [--json]
   Exit: 0 = all changes built, 3 = work remains (pending/drifted/missing),
         2 = bad invocation.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project } from 'ts-morph';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';
import { specSkeleton, specSkeletons, ARITY_GATED_KINDS } from '../../buildspec/core/skeleton.mjs';
import { extractFromMap } from '../../buildspec/pipeline/extract.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const PLAN = arg('--plan');
const MAP = arg('--map', 'docs/novakai/_bundle.mmd');
const TSCONFIG = arg('--tsconfig', 'tsconfig.json');
const JSON_OUT = process.argv.includes('--json');
if (!PLAN) {
  console.error(
    'usage: status.mjs --plan <plan.json> [--map <bundle.mmd>] [--tsconfig <tsconfig>] [--json]',
  );
  process.exit(2);
}

/* ---------- load plan + current code signatures ---------- */
const plan = JSON.parse(readFileSync(PLAN, 'utf8'));
const changes = Array.isArray(plan.changes) ? plan.changes : [];

const project = new Project({ tsConfigFilePath: resolve(TSCONFIG) });
const codeModel = extractFromMap(resolve(MAP), project); // fm.interfaces = REAL code signatures
const codeSkels = specSkeletons(codeModel);              // keyed by map node id
const codeNodeIds = new Set(Object.keys(codeSkels));
const mapModel = parseMmd(readFileSync(resolve(MAP), 'utf8'));

/* ---------- signature comparison (gate-consistent) ---------- */
function targetSkeleton(change) {
  const id = change.target.ref;
  const kind = change.newNode?.kind || codeModel.nodes?.[id]?.kind || 'function';
  const model = {
    nodes: { [id]: { id, kind, parent: null, group: false } },
    'fm': { [id]: change.fm || { name: id, description: '', state: [], interfaces: [] } },
    groups: new Set(),
  };
  return specSkeleton(model, id);
}

function memberKey(member) {
  // the gate-relevant facets of a member, for an arity-gated kind
  return JSON.stringify({
    arity: member.arity,
    returnsValue: member.returnsValue,
    returnType: member.returnType,   // null = prose hole (ignored by gate); compared loosely below
    paramTypes: member.paramTypes,
  });
}

function sameMemberNames(target, current) {
  const targetNames = new Set(target.members.map((member) => member.name));
  const currentNames = new Set(current.members.map((member) => member.name));
  return targetNames.size === currentNames.size && [...targetNames].every((name) => currentNames.has(name));
}

function sameMembersByName(target, current) {
  const currentByName = new Map(current.members.map((member) => [member.name, member]));
  if (target.members.length !== current.members.length) return false;
  return target.members.every((member) =>
    currentByName.has(member.name) && memberKey(member) === memberKey(currentByName.get(member.name)));
}

function sigEqual(target, current) {
  // Non-arity-gated kinds: the gate only enforces member NAMES.
  const gated = ARITY_GATED_KINDS.has(target.kind) && ARITY_GATED_KINDS.has(current.kind);
  if (!gated) return sameMemberNames(target, current);
  // Single primary member on each side (the common function/hook case):
  // compare the call signature regardless of the member's name.
  if (target.members.length === 1 && current.members.length === 1) {
    return memberKey(target.members[0]) === memberKey(current.members[0]);
  }
  // Otherwise compare member-by-member by name.
  return sameMembersByName(target, current);
}

/* ---------- per-change status ---------- */
function edgeStatus(change, ref) {
  const [fromTo, style] = ref.split(':');
  const [from, dest] = (fromTo || '').split('->');
  const present = mapModel.edges.some((e) =>
    e.from === from && e.to === dest && (!style || e.style === style));
  const built = change.status === 'remove' ? !present : present;
  return { status: built ? 'built' : 'pending', detail: 'edge (map-derived; edges not code-gated)' };
}

function nodeStatus(change, ref) {
  const inCode = codeNodeIds.has(ref);
  if (change.status === 'remove') {
    return inCode ? { status: 'pending', detail: 'node still present in code' }
                  : { status: 'built', detail: 'node removed' };
  }
  // add or modify
  if (!inCode) {
    return change.status === 'add'
      ? { status: 'pending', detail: 'not implemented + shipped into the map yet' }
      : { status: 'missing', detail: `modify target "${ref}" not found in code` };
  }
  if (!change.fm) return { status: 'built', detail: 'present (structure-only change, no signature commitment)' };
  const matches = sigEqual(targetSkeleton(change), codeSkels[ref]);
  return matches ? { status: 'built', detail: 'signature matches proposed fm' }
                 : { status: 'drifted', detail: 'present, but signature differs from proposed fm' };
}

function statusOf(change) {
  const ref = change.target?.ref;
  if (!ref) return { status: 'invalid', detail: 'change has no target.ref' };
  return change.target.kind === 'edge' ? edgeStatus(change, ref) : nodeStatus(change, ref);
}

const rows = changes.map((change) => {
  const result = statusOf(change);
  return {
    id: change.id,
    status: result.status,
    kind: change.status,
    ref: change.target?.ref,
    phase: change.phase ?? null,
    detail: result.detail,
  };
});

/* ---------- dependency coherence (a pending dep blocks a built-looking change) ---------- */
const byId = new Map(rows.map((row) => [row.id, row]));
for (const change of changes) {
  if (!change.dependsOn?.length) continue;
  const blockers = change.dependsOn.filter((dep) => byId.get(dep) && byId.get(dep).status !== 'built');
  if (blockers.length) {
    const row = byId.get(change.id);
    if (row) row.blockedBy = blockers;
  }
}

/* ---------- report ---------- */
const counts = rows.reduce((acc, row) => ((acc[row.status] = (acc[row.status] || 0) + 1), acc), {});
const remaining = rows.filter((row) => row.status !== 'built');

if (JSON_OUT) {
  console.log(JSON.stringify({ base: plan.base ?? null, counts, changes: rows }, null, 2));
} else {
  console.log(`Plan: ${plan.base ?? '(no base label)'} — ${rows.length} change(s)`);
  console.log('Status is recomputed from current code (node signatures via ts-morph); edges are map-derived.\n');
  const icon = { built: '✓', pending: '·', drifted: '✗', missing: '✗', invalid: '?' };
  for (const row of rows.sort((x, y) => (x.phase ?? 99) - (y.phase ?? 99))) {
    const blk = row.blockedBy ? `  ⟂ blocked by ${row.blockedBy.join(', ')}` : '';
    console.log(
      `  ${icon[row.status] || '?'} [${row.status.toUpperCase()}] ${row.id}  (${row.kind} ${row.ref})` +
      `  — ${row.detail}${blk}`,
    );
  }
  console.log('\n' + Object.entries(counts).map(([k, val]) => `${val} ${k}`).join(' · '));
  if (remaining.length) {
    console.log('\nNext (the verified build checklist):');
    for (const row of remaining) console.log(`  - ${row.id}: ${row.kind} ${row.ref} [${row.status}]`);
  } else {
    console.log('\nAll changes built. Plan fully landed.');
  }
}

process.exit(remaining.length ? 3 : 0);
