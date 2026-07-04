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
     node status.mjs --plan <plan.json> [--map docs/flowmap/_bundle.mmd]
                     [--tsconfig tsconfig.json] [--json]
   Exit: 0 = all changes built, 3 = work remains (pending/drifted/missing),
         2 = bad invocation.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Project } from 'ts-morph';
import { parseMmd } from '../buildspec/core/mmd-parse.mjs';
import { specSkeleton, specSkeletons, ARITY_GATED_KINDS } from '../buildspec/core/skeleton.mjs';
import { extractFromMap } from '../buildspec/pipeline/extract.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const PLAN = arg('--plan');
const MAP = arg('--map', 'docs/flowmap/_bundle.mmd');
const TSCONFIG = arg('--tsconfig', 'tsconfig.json');
const JSON_OUT = process.argv.includes('--json');
if (!PLAN) { console.error('usage: status.mjs --plan <plan.json> [--map <bundle.mmd>] [--tsconfig <tsconfig>] [--json]'); process.exit(2); }

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
    fm: { [id]: change.fm || { name: id, description: '', state: [], interfaces: [] } },
    groups: new Set(),
  };
  return specSkeleton(model, id);
}

function memberKey(m) {
  // the gate-relevant facets of a member, for an arity-gated kind
  return JSON.stringify({
    arity: m.arity,
    returnsValue: m.returnsValue,
    returnType: m.returnType,        // null = prose hole (ignored by gate); compared loosely below
    paramTypes: m.paramTypes,
  });
}

function sigEqual(target, current) {
  // Non-arity-gated kinds: the gate only enforces member NAMES.
  const gated = ARITY_GATED_KINDS.has(target.kind) && ARITY_GATED_KINDS.has(current.kind);
  if (!gated) {
    const tn = new Set(target.members.map((m) => m.name));
    const cn = new Set(current.members.map((m) => m.name));
    return tn.size === cn.size && [...tn].every((n) => cn.has(n));
  }
  // Single primary member on each side (the common function/hook case):
  // compare the call signature regardless of the member's name.
  if (target.members.length === 1 && current.members.length === 1) {
    return memberKey(target.members[0]) === memberKey(current.members[0]);
  }
  // Otherwise compare member-by-member by name.
  const cm = new Map(current.members.map((m) => [m.name, m]));
  if (target.members.length !== current.members.length) return false;
  return target.members.every((m) => cm.has(m.name) && memberKey(m) === memberKey(cm.get(m.name)));
}

/* ---------- per-change status ---------- */
function statusOf(c) {
  const ref = c.target?.ref;
  if (!ref) return { status: 'invalid', detail: 'change has no target.ref' };

  if (c.target.kind === 'edge') {
    const [fromTo, style] = ref.split(':');
    const [from, to] = (fromTo || '').split('->');
    const present = mapModel.edges.some((e) =>
      e.from === from && e.to === to && (!style || e.style === style));
    const built = c.status === 'remove' ? !present : present;
    return { status: built ? 'built' : 'pending', detail: 'edge (map-derived; edges not code-gated)' };
  }

  const inCode = codeNodeIds.has(ref);
  if (c.status === 'remove') {
    return inCode ? { status: 'pending', detail: 'node still present in code' }
                  : { status: 'built', detail: 'node removed' };
  }
  // add or modify
  if (!inCode) {
    return c.status === 'add'
      ? { status: 'pending', detail: 'not implemented + shipped into the map yet' }
      : { status: 'missing', detail: `modify target "${ref}" not found in code` };
  }
  if (!c.fm) return { status: 'built', detail: 'present (structure-only change, no signature commitment)' };
  const ok = sigEqual(targetSkeleton(c), codeSkels[ref]);
  return ok ? { status: 'built', detail: 'signature matches proposed fm' }
            : { status: 'drifted', detail: 'present, but signature differs from proposed fm' };
}

const rows = changes.map((c) => {
  const s = statusOf(c);
  return { id: c.id, status: s.status, kind: c.status, ref: c.target?.ref, phase: c.phase ?? null, detail: s.detail };
});

/* ---------- dependency coherence (a pending dep blocks a built-looking change) ---------- */
const byId = new Map(rows.map((r) => [r.id, r]));
for (const c of changes) {
  if (!c.dependsOn?.length) continue;
  const blockers = c.dependsOn.filter((d) => byId.get(d) && byId.get(d).status !== 'built');
  if (blockers.length) {
    const r = byId.get(c.id);
    if (r) r.blockedBy = blockers;
  }
}

/* ---------- report ---------- */
const counts = rows.reduce((a, r) => ((a[r.status] = (a[r.status] || 0) + 1), a), {});
const remaining = rows.filter((r) => r.status !== 'built');

if (JSON_OUT) {
  console.log(JSON.stringify({ base: plan.base ?? null, counts, changes: rows }, null, 2));
} else {
  console.log(`Plan: ${plan.base ?? '(no base label)'} — ${rows.length} change(s)`);
  console.log('Status is recomputed from current code (node signatures via ts-morph); edges are map-derived.\n');
  const icon = { built: '✓', pending: '·', drifted: '✗', missing: '✗', invalid: '?' };
  for (const r of rows.sort((a, b) => (a.phase ?? 99) - (b.phase ?? 99))) {
    const blk = r.blockedBy ? `  ⟂ blocked by ${r.blockedBy.join(', ')}` : '';
    console.log(`  ${icon[r.status] || '?'} [${r.status.toUpperCase()}] ${r.id}  (${r.kind} ${r.ref})  — ${r.detail}${blk}`);
  }
  console.log('\n' + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(' · '));
  if (remaining.length) {
    console.log('\nNext (the verified build checklist):');
    for (const r of remaining) console.log(`  - ${r.id}: ${r.kind} ${r.ref} [${r.status}]`);
  } else {
    console.log('\nAll changes built. Plan fully landed.');
  }
}

process.exit(remaining.length ? 3 : 0);
