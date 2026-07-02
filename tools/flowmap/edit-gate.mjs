#!/usr/bin/env node
/* =====================================================================
   edit-gate.mjs — M2: PreToolUse quiz-gate for Edit|Write.
   ---------------------------------------------------------------------
   Session-protocol rule 2 ("make understanding testable") as a machine
   gate: an agent may not EDIT the app before its read of the map is
   verified. The proof is the quiz-pass artifact (.flowmap-quiz-pass.json,
   AUD5 F-03) — bound to the sha256 of the exact map bytes it was scored
   against, so a pass goes stale the moment the map changes.

   SCOPE (a deliberate boundary, mirroring contract-gate's honesty rule):
   only paths under src/ are gated — the quiz proves understanding of the
   src map (_bundle.mmd), so that is the claim this gate can enforce.
   Edits to tools/, docs/, configs are ungated by design (they carry their
   own gates: tooling-coverage, roadmap:audit, handoff-fresh).

     • tool is not Edit/Write            -> ALLOW (defense in depth; the
                                            matcher should not send these)
     • target path outside src/          -> ALLOW (out of the map's claim)
     • src/ edit + quiz verify exits 0   -> ALLOW (understanding proven
                                            for the CURRENT map bytes)
     • src/ edit + no/stale/partial pass -> DENY (exit 2; reason names the
                                            re-take command)
     • stdin does not parse              -> DENY — the matcher guarantees
                                            this payload IS an edit; input
                                            the gate cannot read cannot be
                                            verified (fail closed, F-01)
     • payload carries no file_path      -> DENY — an edit the gate cannot
                                            scope cannot be verified
     • quiz.mjs itself unspawnable       -> ALLOW — the gate must not block
                                            legitimate work on its own bug

   FLOWMAP_ROOT env var is a test seam: it points the gate at a fixture
   checkout so the suite can prove all branches without touching the real
   session's quiz state.

   stdin : { tool_name, tool_input: { file_path } }   (PreToolUse payload)
   stdout: on DENY, a JSON line { decision:"deny", reason }
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..');
const QUIZ = join(HERE, 'quiz.mjs');

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }) + '\n');
  process.stderr.write('flowmap edit-gate DENIED edit: ' + reason + '\n');
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  deny('PreToolUse payload did not parse — the gate cannot verify this edit');
}

// Only gate the editing tools; anything else passes.
const tool = payload?.tool_name || '';
if (!/^(Edit|Write)$/.test(tool)) allow();

const fp = payload?.tool_input?.file_path;
if (!fp) deny('Edit/Write payload carries no file_path — an edit the gate cannot scope cannot be verified');

// Outside src/ -> outside the map's claim -> ungated by design (see header).
const target = resolve(ROOT, String(fp));
if (!target.startsWith(join(ROOT, 'src') + sep)) allow();

let r;
try {
  r = spawnSync('node', [QUIZ, 'verify'], { cwd: ROOT, encoding: 'utf8' });
} catch {
  allow(); // the gate's own fault must not wedge the session
}

if (r.status !== 0) {
  deny('src/ edit before understanding is verified — ' + (r.stdout || '').trim() +
       ' (onboard STEP 4: npm run flowmap:quiz)');
}

// quiz pass verified against the current map bytes -> the editor provably read the map
allow();
