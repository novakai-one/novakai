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

   Staleness (mirrors handoff-fresh's definition, scoped to the map):
     • the latest commit touching src/ is NEWER than the latest commit
       touching docs/flowmap/_bundle.mmd, OR
     • src/ has uncommitted changes while _bundle.mmd is untouched.
   A dirty _bundle.mmd counts as a re-sync in progress -> fresh.

   Never wedges: stop_hook_active in the payload -> exit 0 (the harness
   already continued this stop once — anti-loop); git unavailable / not
   a repo -> exit 0; malformed stdin is tolerated (the git checks, not
   the payload, decide). FLOWMAP_ROOT env var is the test seam.

   stdin : Stop-hook payload (only stop_hook_active is read)
   exit  : 0 = allow the stop, 2 = block: re-sync first (reason on stderr).
   ===================================================================== */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..');
const MAP = 'docs/flowmap/_bundle.mmd';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { /* the git checks decide */ }
if (payload?.stop_hook_active) process.exit(0); // this stop was already blocked once — never loop

function run(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

try {
  const codeTs = parseInt(run('git log -1 --format=%ct -- src/') || '0', 10);
  const mapTs = parseInt(run(`git log -1 --format=%ct -- ${MAP}`) || '0', 10);
  const dirtySrc = run('git status --porcelain -- src/');
  const dirtyMap = run(`git status --porcelain -- ${MAP}`);

  // A map being regenerated right now is a re-sync in progress, not staleness.
  const stale = !dirtyMap && (codeTs > mapTs || Boolean(dirtySrc));

  if (stale) {
    process.stderr.write(
      'flowmap ship-staleness BLOCKED the stop: src/ changed more recently than the shipped map.\n' +
      'Re-sync before ending the session (protocol rule 5): npm run flowmap:ship — then commit the\n' +
      'regenerated map with the code it documents.\n'
    );
    process.exit(2);
  }
  process.stdout.write('✓ shipped map is at least as fresh as src/\n');
  process.exit(0);
} catch {
  process.exit(0); // git unavailable / not a repo — the gate must not wedge the stop
}
