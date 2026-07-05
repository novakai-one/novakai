/* =====================================================================
   status.test.mjs — AUD5/F-17: the C1 verified-work-state computer gets
   its verdict classes locked on controlled fixture plans.

   AUD3 T10: status.mjs had only the thin happy-path probe in loop-e2e
   (exit ∈ {0,3} + /pending|built/). Nothing asserted WHICH verdict a
   change gets — built vs pending vs drifted are the whole point of
   "continuity is derived state, never prose".

   Fixtures run against the REAL map + code (ts-morph), so each class is
   proven on the machinery a resuming session actually uses:
     add of a never-implemented node            → pending
     structure-only modify of an existing node  → built
     modify with a wrong proposed signature     → drifted
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function status(args) {
  return spawnSync('node', [join('tools', 'novakai', 'status', 'status.mjs'), ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
}

// camera__toWorld is a stable, gate-verified map node: (sx: number, sy: number) => Point
const REAL_NODE = 'camera__toWorld';

test('F-17: verdict classes — pending / built / drifted on one fixture plan (exit 3)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'status-t-'));
  try {
    const plan = join(dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({
      base: 'f17-fixture',
      changes: [
        { id: 'never-built', status: 'add',
          target: { kind: 'node', ref: 'zzF17Ghost' },
          newNode: { label: 'zzF17Ghost', kind: 'function', parent: null } },
        { id: 'already-there', status: 'modify',
          target: { kind: 'node', ref: REAL_NODE } },                    // structure-only
        { id: 'wrong-signature', status: 'modify',
          target: { kind: 'node', ref: REAL_NODE },
          fm: { name: 'toWorld', description: '', state: [],
            interfaces: [{ name: 'toWorld', accepts: ['a: string', 'b: string', 'c: string'], returns: ['void'] }] } },
      ],
    }));
    const r = status(['--plan', plan, '--json']);
    assert.equal(r.status, 3, `work remains => exit 3:\n${r.stdout}${r.stderr}`);
    const by = Object.fromEntries(JSON.parse(r.stdout).changes.map((c) => [c.id, c.status]));
    assert.equal(by['never-built'], 'pending', 'an unimplemented add is pending');
    assert.equal(by['already-there'], 'built', 'a structure-only modify of a real node is built');
    assert.equal(by['wrong-signature'], 'drifted', 'a real node with a non-matching proposed fm is drifted');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F-17: all changes built → exit 0; no --plan → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'status-t-'));
  try {
    const plan = join(dir, 'plan.json');
    writeFileSync(plan, JSON.stringify({
      base: 'f17-all-built',
      changes: [
        { id: 'already-there', status: 'modify', target: { kind: 'node', ref: REAL_NODE } },
      ],
    }));
    assert.equal(status(['--plan', plan]).status, 0, 'a fully-built plan exits 0');
    assert.equal(status([]).status, 2, 'no --plan is a usage error (2)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
