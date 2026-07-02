#!/usr/bin/env node
/* =====================================================================
   waves.mjs — deterministic topological EXECUTION WAVES of a plan.
   ---------------------------------------------------------------------
   An orchestrator can dispatch every change in a wave to parallel
   subagents at once, then advance when they land.  Routes to status.mjs
   for each change's live build status, then computes the minimal wave
   partition of the unbuilt work using topological sort with cycle
   detection.

   Usage:
     node waves.mjs --plan <plan.json> [--map docs/flowmap/_bundle.mmd]
                    [--tsconfig tsconfig.json] [--json] [--strict]
   Defaults: plan = public/plan.json, map = docs/flowmap/_bundle.mmd,
             tsconfig = tsconfig.json (all relative to ROOT).
   Exit: 0 = success (even if all done / waves empty). By DESIGN, a
         dependency cycle is reported as data (`cyclic` in the output)
         and does NOT change the exit code — a caller reading only the
         exit code would otherwise proceed on a cyclic plan, so callers
         that gate on cycles MUST pass --strict (AUD5/F-18, matching the
         verify-change precedent):
         --strict: 1 = the plan has >= 1 dependency cycle.
         2 = bad invocation / unreadable plan / status.mjs failure.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalJSON, hashOf } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const PLAN     = arg('--plan',     join(ROOT, 'public', 'plan.json'));
const MAP      = arg('--map',      join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
const TSCONFIG = arg('--tsconfig', join(ROOT, 'tsconfig.json'));
const JSON_OUT = process.argv.includes('--json');
const STRICT   = process.argv.includes('--strict');

/* ---------- load plan ---------- */
let plan;
try { plan = JSON.parse(readFileSync(resolve(PLAN), 'utf8')); }
catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }

const changes = plan.changes || [];
const byId    = new Map(changes.map((c) => [c.id, c]));

/* ---------- get live build status via status.mjs ---------- */
const sr = spawnSync('node', [
  join('tools', 'flowmap', 'status.mjs'),
  '--plan', resolve(PLAN), '--map', resolve(MAP), '--tsconfig', resolve(TSCONFIG), '--json',
], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// status.mjs exits 0 (all built) or 3 (work remains) on success; 2 = bad args.
if (sr.status === 2 || !sr.stdout) {
  console.error('status.mjs failed: ' + String(sr.stderr || '').slice(0, 400));
  process.exit(2);
}

let statusReport;
try { statusReport = JSON.parse(sr.stdout); }
catch { console.error('status.mjs produced unparseable output'); process.exit(2); }

const statusById = new Map((statusReport.changes || []).map((r) => [r.id, r.status]));

/* ---------- partition: done vs notDone ---------- */
const done    = [];
const notDone = [];
for (const c of changes) {
  (statusById.get(c.id) === 'built' ? done : notDone).push(c.id);
}

const notDoneIds = new Set(notDone);

/* ---------- topological wave computation with cycle detection ----------
   waveOf(id): 0 if no blocking deps; else 1 + max(waveOf(dep)).
   Cycles are detected via a visiting-set; any id reachable through a
   cycle propagates Infinity and is excluded from the wave groups.
   ----------------------------------------------------------------------- */
const cyclicSet  = new Set();
const waveCache  = new Map();

function waveOf(id, visiting) {
  if (cyclicSet.has(id))    return Infinity;  // already known cyclic
  if (waveCache.has(id))    return waveCache.get(id);
  if (visiting.has(id)) {
    // back-edge: this id is on the current DFS path — it's part of a cycle
    cyclicSet.add(id);
    return Infinity;
  }

  visiting.add(id);
  const change       = byId.get(id);
  // blockingDeps: declared deps that are ALSO not yet built and are in the plan
  const blockingDeps = (change.dependsOn || [])
    .filter((d) => byId.has(d) && notDoneIds.has(d));

  let wave = 0;
  for (const d of blockingDeps) {
    const dw = waveOf(d, visiting);
    if (dw === Infinity) {
      // dep is cyclic (or depends on one) — propagate
      cyclicSet.add(id);
      visiting.delete(id);
      waveCache.set(id, Infinity);
      return Infinity;
    }
    wave = Math.max(wave, dw + 1);
  }

  visiting.delete(id);
  waveCache.set(id, wave);
  return wave;
}

// Trigger DFS for every unbuilt change (memoized, so safe to call N times)
for (const id of notDone) waveOf(id, new Set());

/* ---------- group by wave index (exclude cyclic) ---------- */
const waveMap = new Map();
for (const id of notDone) {
  if (cyclicSet.has(id)) continue;
  const w = waveCache.get(id) ?? 0;
  if (!waveMap.has(w)) waveMap.set(w, []);
  waveMap.get(w).push(id);
}

// waves[] indexed by wave number; each wave sorted lexicographically
const maxWave = waveMap.size ? Math.max(...waveMap.keys()) : -1;
const waves   = [];
for (let i = 0; i <= maxWave; i++) {
  waves.push((waveMap.get(i) || []).sort());
}

// 'cyclic' = unschedulable due to a cycle: a node IN a cycle, or one that
// transitively depends on a cycle (both are genuinely un-dispatchable).
const cyclic     = [...cyclicSet].sort();
const doneSorted = done.slice().sort();

/* ---------- assemble output ---------- */
const body   = {
  planBase:     plan.base ?? null,
  totalChanges: changes.length,
  done:         doneSorted,
  waves,
  cyclic,
  readyCount:   waves[0]?.length || 0,
};
const report = { ...body, wavesHash: hashOf(body) };

// F-18: under --strict a cycle is a blocking failure, not just data.
const exitCode = STRICT && cyclic.length ? 1 : 0;

if (JSON_OUT) {
  process.stdout.write(canonicalJSON(report) + '\n');
  process.exit(exitCode);
}

/* ---------- human summary ---------- */
console.log(`done: ${doneSorted.length}`);
for (let i = 0; i < waves.length; i++) {
  const w     = waves[i];
  const label = i === 0 ? 'wave 0 (ready now)' : `wave ${i}`;
  console.log(`${label}: ${w.join(', ')}`);
  if (i === 0) {
    for (const id of w) {
      console.log(`  dispatch: npm run flowmap:contract -- --change ${id}`);
    }
  }
}
if (waves.length === 0 && cyclic.length === 0) {
  console.log('all changes built — nothing to dispatch');
}
if (cyclic.length) {
  console.log(`CYCLE ${STRICT ? 'ERROR' : 'WARNING'}: the following change ids form a dependency cycle and are excluded from waves: ${cyclic.join(', ')}${STRICT ? '' : ' (exit stays 0 by design — pass --strict to make this blocking)'}`);
}
process.exit(exitCode);
