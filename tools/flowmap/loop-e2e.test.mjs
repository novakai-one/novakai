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
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PLAN = 'public/plan.json';

const node = (args) => spawnSync('node', args, { cwd: ROOT, encoding: 'utf8' });

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
