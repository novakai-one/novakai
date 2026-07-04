#!/usr/bin/env node
/* =====================================================================
   ship-staleness.mjs — M2: Stop-hook ship gate.
   ---------------------------------------------------------------------
   Session-protocol rule 5 ("every session ends with a re-sync") as a
   machine gate: a session may not END while the shipped map lags the
   code. The F3 handoff nudge stays advisory; THIS hook blocks the stop
   once (exit 2) with the exact re-sync command, so the protocol is
   followed, not remembered.

   Design decision (recorded, per the M2 intent "ship-staleness in Stop
   hook"): the hook detects staleness and DEMANDS `npm run flowmap:ship`
   — it does not run the ship pipeline itself. A Stop hook that silently
   regenerated bundle+bodies would mutate the working tree at every
   session end and hide the re-sync from the commit history; the gate
   makes the agent do it visibly instead.

   Staleness is a CONTENT comparison, not a commit-timestamp one (redesigned
   2026-07-04, KNOWN_EDGES.md): `flowmap:ship` writes docs/flowmap/
   ship-stamp.json recording a hash of src/'s working-tree content
   (ship-stamp.mjs, via lib/src-tree-hash.mjs). This hook recomputes that
   same hash right now and compares it to the stamp. A prior design compared
   `git log -1 -- src/` to `git log -1 -- _bundle.mmd`: on a branch where
   the regenerated map is byte-identical to HEAD (a map-neutral src change),
   there is never a map commit to make, so that predicate could never be
   satisfied again — the hook re-blocked every stop. A content hash has no
   such dead end: ANY src change — map-neutral or not — changes the hash,
   so the stamp always has something new to write and commit.
     • stamp hash === current src/ hash  -> fresh (covers both "committed
       together" and "ship just ran, stamp not yet committed" — the hash
       is read off the working tree, not git history).
     • stamp hash !== current src/ hash  -> stale (src changed, uncommitted
       or committed, since the last flowmap:ship).
     • no stamp file yet (bootstrap)     -> stale.

   Never wedges: stop_hook_active in the payload -> exit 0 (the harness
   already continued this stop once — anti-loop); git unavailable / not
   a repo -> exit 0; malformed stdin is tolerated (the git checks, not
   the payload, decide). FLOWMAP_ROOT env var is the test seam.

   stdin : Stop-hook payload (only stop_hook_active is read)
   exit  : 0 = allow the stop, 2 = block: re-sync first (reason on stderr).
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../lib/metrics-log.mjs';
import { srcTreeHash } from '../lib/src-tree-hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..', '..');
const STAMP = join(ROOT, 'docs', 'flowmap', 'ship-stamp.json');

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { /* the git checks decide */ }
if (payload?.stop_hook_active) process.exit(0); // this stop was already blocked once — never loop

try {
  let stampedTree = null;
  try { stampedTree = JSON.parse(readFileSync(STAMP, 'utf8')).srcTree ?? null; } catch { /* no stamp yet = stale */ }
  const currentTree = srcTreeHash(ROOT);
  const stale = stampedTree !== currentTree;

  // M2b telemetry at the block/fresh decision paths (fail-silent by contract;
  // the anti-loop and git-unavailable passthroughs above are not decisions).
  const record = (decision, reason) => recordEvent({
    event: 'gate', source: 'ship-staleness.mjs', session: payload?.session_id ?? null,
    gate: 'ship-staleness', decision, ...(reason ? { reason } : {}),
  });

  if (stale) {
    record('deny', 'src/ content has changed since the last flowmap:ship — re-sync (npm run flowmap:ship)');
    process.stderr.write(
      'flowmap ship-staleness BLOCKED the stop: src/ content has changed since the last flowmap:ship\n' +
      '(docs/flowmap/ship-stamp.json is out of date).\n' +
      'Re-sync before ending the session (protocol rule 5): npm run flowmap:ship — then commit the\n' +
      'regenerated map (and ship-stamp.json) with the code it documents.\n'
    );
    process.exit(2);
  }
  record('allow');
  process.stdout.write('✓ ship-stamp matches src/ — the shipped map is content-current\n');
  process.exit(0);
} catch {
  process.exit(0); // git unavailable / not a repo — the gate must not wedge the stop
}
