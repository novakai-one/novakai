#!/usr/bin/env node
/* =====================================================================
   turn-gate.mjs — M10: PreToolUse FORCE gate on Read|Grep|Glob.
   ---------------------------------------------------------------------
   turns.mjs (MEASURE) showed the pattern: agents run ~1.26 tool calls
   per API turn, and ~99% of session tokens are cache-reads re-sent every
   turn — a lone Read/Grep/Glob re-pays the full cached-context bill for
   one file's worth of new information. This hook turns that measurement
   into a gate: a streak of consecutive unbatched single-read turns is
   denied, with an actionable reason (batch the reads into one response).

   Reads the transcript with the SAME dedupe-by-message.id parser as
   turns.mjs (lib/transcript.mjs) — one parser, so the gate and the
   measuring tool can never disagree about what a "turn" is.

   Decision:
     LAST = the most recent assistant call in the transcript.
       >= 2 tool_use blocks -> ALLOW (this call is part of a batched turn).
     STREAK = the number of consecutive most-recent assistant calls,
       ending at LAST, that each have EXACTLY 1 tool_use block named
       Read, Grep or Glob.
       STREAK < THRESHOLD -> ALLOW.
       STREAK >= THRESHOLD -> check the marker file (see below):
         a match -> ALLOW once, and DELETE the marker (a fresh streak
           re-arms the gate from scratch); otherwise write the marker
           and DENY (exit 2, reason on stderr AND as JSON { decision:
           "block", reason } on stdout, edit-gate convention).

   HARNESS SCHEMA (live-fire, 2026-07-04): the stdout JSON's `decision`
   field must be "block", not "deny" — "deny" is not in the harness's
   accepted vocabulary ({ decision: "approve"|"block", reason, ... }), so
   a "deny" value fails schema validation and the tool call silently
   proceeds (a non-blocking error), i.e. the gate un-blocks itself.
   Also live-fire (same session): at PreToolUse time the in-flight
   assistant call's own message is NOT YET in the transcript on the
   current harness — a deny was observed firing on the 5th consecutive
   lone read, naming a streak of only 4 (THRESHOLD). So the effective
   behavior is "deny at THRESHOLD+1 lone reads"; the reason string stays
   accurate because it names the on-record streak (THRESHOLD), not the
   in-flight call the gate cannot see yet.

   Live-fire edge (observed 2026-07-04): after a deny -> allow-after-deny
   cycle, if the transcript tail is still a lone-read streak, the FIRST
   read of a following BATCHED response can be denied once more — the
   in-flight batched assistant message is not yet in the transcript at
   PreToolUse time (same gap noted above), so the batch exemption cannot
   see it; that read's retry then passes via the marker written 6ms
   earlier. Bounded to one bounce: once the batched message lands in the
   transcript, the streak is broken for every later call in that batch.
   Accepted, not fixed: the hook payload cannot reveal whether the current
   call is part of a batch.

   The one-free-retry marker (<ROOT>/.flowmap-turn-gate.json) exists
   because a denied read may genuinely have been alone (nothing else was
   worth batching) — the agent re-issues the identical call once, and
   that specific retry is let through rather than looping forever.

   FAIL-OPEN, on purpose, unlike edit-gate/contract-gate (which fail
   CLOSED on malformed input): malformed stdin, or a missing/unreadable
   transcript_path, exits 0. A blocked EDIT halts one change the agent
   can retry deliberately; a blocked READ halts ALL forward progress in
   the session — there is no "read something else instead" fallback a
   fail-closed gate could safely offer here, so an input this gate
   cannot parse must never be the thing that wedges the session shut.

   Telemetry: this hook runs on every Read/Grep/Glob — the vast majority
   of calls are plain allows. Logging every one would flood
   session-log.jsonl for no signal (metrics.mjs's gate table only cares
   about allow/deny COUNTS, and 'turns' already gets a column via the
   'turns' entry in GATES). So only 'deny' and 'allow-after-deny' events
   are recorded — never a plain allow.

   stdin : PreToolUse payload { tool_name, tool_input, transcript_path, session_id }
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from './lib/transcript.mjs';
import { recordEvent } from './lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..');
const MARKER = join(ROOT, '.flowmap-turn-gate.json');

// ponytail: how many consecutive single-read turns trip the gate. Raise it
// if legitimate one-read-at-a-time work gets false-positived; lower it if
// agents are still routinely burning full re-reads one file at a time.
const THRESHOLD = 4;

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); } // see header: fails OPEN

const sessionId = payload?.session_id ?? null;
const transcriptPath = payload?.transcript_path;

let text;
try { text = readFileSync(transcriptPath, 'utf8'); } catch { process.exit(0); } // see header: fails OPEN

const { calls } = parseTranscript(text);
if (!calls.length) process.exit(0);

const last = calls[calls.length - 1];
if (last.tools.length >= 2) process.exit(0); // part of a batched turn

const isSingleRead = (call) =>
  call.tools.length === 1 && /^(Read|Grep|Glob)$/.test(call.tools[0].name);

let streak = 0;
for (let i = calls.length - 1; i >= 0 && isSingleRead(calls[i]); i--) streak++;

if (streak < THRESHOLD) process.exit(0);

let marker = null;
try { marker = JSON.parse(readFileSync(MARKER, 'utf8')); } catch { /* none yet */ }

// <= not >=: the denied call's own message may or may not be persisted in
// the transcript depending on harness version (see header, live-fire), so
// the retry's recomputed streak can land EQUAL to the marker's (message not
// yet persisted) or ONE GREATER (message now persisted). <= passes both.
// Deliberate consequence: a streak that keeps growing turns into an
// alternating deny/allow throttle rather than a hard wall.
if (marker && marker.session === sessionId && marker.streak <= streak) {
  try { unlinkSync(MARKER); } catch { /* already gone */ }
  recordEvent({ event: 'gate', source: 'turn-gate.mjs', session: sessionId, gate: 'turns', decision: 'allow-after-deny' });
  process.exit(0);
}

writeFileSync(MARKER, JSON.stringify({ session: sessionId, streak }));
const reason = `flowmap turn-gate: ${streak} consecutive single-read turns — batch independent reads ` +
  'into ONE response (multiple tool calls, or one grep over many files). If this read is genuinely ' +
  'alone, re-issue the same call once to pass.';
recordEvent({ event: 'gate', source: 'turn-gate.mjs', session: sessionId, gate: 'turns', decision: 'deny' });
process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
process.stderr.write(reason + '\n');
process.exit(2);
