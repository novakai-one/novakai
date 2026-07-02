/* =====================================================================
   loop-e2e.test.mjs — F5: run the WHOLE loop as one sequence on the REAL
   in-flight plan (public/plan.json), not as isolated unit tests.

     understand → plan-check (coherence) → cert (apply→stubs→tsc→gate)
       → approve-export (approved.mmd + stubs + checklist) → status
       (built/pending vs the live gate) → writeback (--dry) → edges (--strict)

   Each link is exercised by its real CLI, chained, and asserted green. This
   is the first execution of the loop end-to-end — the spine the roadmap
   names, proven to actually run through, not just pass component-wise.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PLAN = 'public/plan.json';

// M2b: FLOWMAP_ROOT is the emitter seam only — verdict events from the chain's
// plan-cert stage land in a scratch sink, never in the repo's real metrics log.
const METRICS_SINK = mkdtempSync(join(tmpdir(), 'loop-e2e-metrics-'));
process.on('exit', () => rmSync(METRICS_SINK, { recursive: true, force: true }));

const node = (args) => spawnSync('node', args, {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, FLOWMAP_ROOT: METRICS_SINK },
});

/** Find any existing fragment so the writeback --dry stage has a real target. */
function anyFragment() {
  const stack = [join(ROOT, 'src')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.flowmap.mmd')) return p;
    }
  }
  return null;
}

test('the loop runs end-to-end on the real plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'flowmap-loop-'));
  try {
    // 1 — PLAN coherence (C3): refs real, deps acyclic, accepted set coherent.
    const check = node(['tools/flowmap/plan-check.mjs', '--plan', PLAN]);
    assert.equal(check.status, 0, 'plan-check failed:\n' + check.stdout + check.stderr);
    assert.match(check.stdout, /coherent/);

    // 2 — CERT (C2): apply → stubs → tsc → gate, delta vs base.
    const cert = node(['tools/flowmap/plan-cert.mjs', '--plan', PLAN]);
    assert.equal(cert.status, 0, 'cert failed:\n' + cert.stdout + cert.stderr);
    assert.match(cert.stdout, /CERTIFIED/);

    // 3 — APPROVE-EXPORT (E1): one artifact = approved.mmd + stubs + checklist.
    const out = join(work, 'export');
    const exp = node(['tools/flowmap/approve-export.mjs', '--plan', PLAN, '--out', out]);
    assert.equal(exp.status, 0, 'approve-export failed:\n' + exp.stdout + exp.stderr);
    assert.ok(existsSync(join(out, 'approved.mmd')), 'approved.mmd missing');
    assert.ok(existsSync(join(out, 'plan.json')), 'exported plan.json (build checklist) missing');
    assert.ok(existsSync(join(out, 'CHECKLIST.md')), 'CHECKLIST.md missing');
    assert.ok(existsSync(join(out, 'contracts')), 'generated contracts/ missing');

    // 4 — STATUS (C1): build-state derived from the live gate, not prose.
    // Exit 0 = fully built; exit 3 = work remaining (the normal mid-loop state,
    // a verified pending checklist — not a failure). Any other code is broken.
    const status = node(['tools/flowmap/status.mjs', '--plan', join(out, 'plan.json')]);
    assert.ok([0, 3].includes(status.status), 'status crashed:\n' + status.stdout + status.stderr);
    assert.match(status.stdout, /pending|built/i);

    // 5 — WRITEBACK (E3): approved nodes append to a fragment (dry — no mutation).
    const frag = anyFragment();
    assert.ok(frag, 'no fragment found to exercise writeback');
    const wb = node(['tools/buildspec/scaffold.mjs', '--add-from-plan', PLAN, '--fragment', frag, '--dry']);
    assert.equal(wb.status, 0, 'writeback --dry failed:\n' + wb.stdout + wb.stderr);

    // 6 — RE-SYNC GUARD (A5): the map's edges stay code-backed-or-audited.
    const edges = node(['tools/flowmap/edge-verify.mjs', '--strict']);
    assert.equal(edges.status, 0, 'edge gate failed:\n' + edges.stdout + edges.stderr);
    assert.match(edges.stdout, /every edge is code-backed/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/* ---------- AUD5/F-13: the RED chain — the loop must STOP, not just run.
   AUD3 T8: the spine above is pure happy-path; no stage was ever fed bad
   input, so F5 proved the loop RUNS, never that it stops. This chain feeds
   an incoherent plan in and asserts the FIRST gate blocks and nothing
   downstream executes. ---------- */

test('the loop STOPS on an incoherent plan: plan-check blocks, the chain does not proceed', () => {
  const work = mkdtempSync(join(tmpdir(), 'flowmap-loop-red-'));
  try {
    // Incoherent on two axes: a dangling dependsOn + a modify targeting a
    // node that does not exist in the map (REAL-IDS).
    const badPlan = join(work, 'bad-plan.json');
    writeFileSync(badPlan, JSON.stringify({
      base: 'red-chain-fixture',
      changes: [
        { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'zzNoSuchNode' },
          fm: { name: 'x', interfaces: [] }, dependsOn: ['no-such-change'] },
      ],
    }));

    // The chain, in loop order; each stage runs ONLY if the previous passed —
    // exactly how an orchestrating agent consumes the exit codes.
    const stages = [
      ['plan-check', ['tools/flowmap/plan-check.mjs', '--plan', badPlan]],
      ['cert',       ['tools/flowmap/plan-cert.mjs', '--plan', badPlan]],
      ['approve',    ['tools/flowmap/approve-export.mjs', '--plan', badPlan, '--out', join(work, 'export')]],
    ];
    const executed = [];
    let blockedAt = null;
    for (const [name, args] of stages) {
      executed.push(name);
      const r = node(args);
      if (r.status !== 0) { blockedAt = { name, status: r.status }; break; }
    }

    assert.ok(blockedAt, 'a chain fed an incoherent plan must block at some stage');
    assert.equal(blockedAt.name, 'plan-check', 'the FIRST gate (coherence) is the one that blocks');
    assert.equal(blockedAt.status, 1, 'plan-check reports problems with exit 1');
    assert.deepEqual(executed, ['plan-check'], 'nothing downstream of the block executed');
    assert.ok(!existsSync(join(work, 'export')), 'no approval artifact came out of a red chain');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
