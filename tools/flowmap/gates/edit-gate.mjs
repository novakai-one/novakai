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
     • src/ edit + pass from ANOTHER     -> DENY (onboard-cost item 4: the
       session (or an anonymous pass)       payload's session_id is forwarded
                                            as `quiz verify --session`, so a
                                            subagent's or previous session's
                                            pass cannot attest THIS agent's
                                            read; a sessionless payload keeps
                                            the flagless hash-only path —
                                            the harness always sends one)
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
   stdout: on DENY, a JSON line { decision:"block", reason } — "block" is
           the harness's accepted vocabulary; "deny" fails schema
           validation and silently un-blocks the gate (live-fire, 2026-07-04).
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..', '..');
const QUIZ = join(HERE, '..', 'onboard', 'quiz.mjs');

// M2b telemetry context (fail-silent; may never change a decision or exit code).
let evSession = null;
let evTarget = null;
const record = (decision, reason) => recordEvent({
  event: 'gate', source: 'edit-gate.mjs', session: evSession,
  gate: 'edit', decision,
  ...(reason ? { reason } : {}), ...(evTarget ? { target: evTarget } : {}),
});

function allow() { record('allow'); process.exit(0); }
function deny(reason) {
  record('deny', reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
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
evSession = payload?.session_id ?? null;
const tool = payload?.tool_name || '';
if (!/^(Edit|Write)$/.test(tool)) allow();

const fp = payload?.tool_input?.file_path;
evTarget = typeof fp === 'string' ? fp : null;
if (!fp) deny('Edit/Write payload carries no file_path — an edit the gate cannot scope cannot be verified');

// Outside src/ -> outside the map's claim -> ungated by design (see header).
const target = resolve(ROOT, String(fp));
if (!target.startsWith(join(ROOT, 'src') + sep)) allow();

let r;
try {
  const vArgs = [QUIZ, 'verify'];
  if (typeof evSession === 'string' && evSession) vArgs.push('--session', evSession);
  // Onboard-cost item 2: scope the verify to the edited file's module + its
  // direct edge-neighbours (per-fragment staleness instead of whole-bundle).
  vArgs.push('--file', relative(ROOT, target));
  r = spawnSync('node', vArgs, { cwd: ROOT, encoding: 'utf8' });
} catch {
  allow(); // the gate's own fault must not wedge the session
}

if (r.status !== 0) {
  deny('src/ edit before understanding is verified — ' + (r.stdout || '').trim() +
       ' (onboard STEP 4: npm run flowmap:quiz)');
}

// quiz pass verified against the current map bytes -> the editor provably read the map
allow();
