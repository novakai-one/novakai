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
       Stale-state cleanup: any leftover marker for this gate instance is
       deleted here too — a streak broken by a real batch makes a
       deny/grace marker stale, and a stale marker left behind could grant
       a spurious allow to a future, unrelated streak.
     STREAK = the number of consecutive most-recent assistant calls,
       ending at LAST, that each have EXACTLY 1 tool_use block named
       Read, Grep or Glob.
       STREAK < THRESHOLD -> ALLOW (same stale-marker cleanup as above).
       STREAK >= THRESHOLD -> check the marker file (see below):
         a GRACE marker (see live-fire edge below) whose snapshot is still
           frozen -> ALLOW as 'allow-grace', marker left UNCHANGED.
         a plain retry marker with marker.streak <= streak -> ALLOW once,
           REWRITE the marker as a grace record (a fresh streak still
           re-arms the gate, but the frozen in-flight-batch window that
           follows a retry does not re-deny it); otherwise write a fresh
           marker and DENY (exit 2, reason on stderr AND as JSON
           { decision: "block", reason } on stdout, edit-gate convention).

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

   Live-fire edge (observed 2026-07-04), FIXED by frozen-window grace: after
   a deny -> allow-after-deny cycle, if the transcript tail is still a
   lone-read streak, the FIRST read of a following BATCHED response could be
   denied once more — the in-flight batched assistant message is not yet in
   the transcript at PreToolUse time (same gap noted above), so the batch
   exemption could not see it. The hook payload still cannot reveal batch
   membership, so instead of deleting the marker on allow-after-deny, it is
   REWRITTEN as a grace record { session, grace: true, calls, streak } (calls
   = calls.length at that moment). Any later threshold-deny check whose
   transcript is UNCHANGED-OR-ONE-PERSISTED relative to that snapshot
   (calls.length and streak each advance by <= 1) is let through as
   'allow-grace' with the grace snapshot left untouched — a frozen in-flight
   batch produces identical transcript state on every read of it, so the
   whole window passes instead of bouncing once. Once the batch message
   actually persists (either delta > 1 from the snapshot — another lone-read
   turn landed instead), the grace marker is discarded and normal deny logic
   re-arms from scratch.
   Ceiling: under a DEFIANT pure lone-read stream (agent never batches, ever),
   grace still grants one extra pass per deny cycle, so the throttle widens
   from deny-every-2nd-call to deny-every-3rd-call.
   ponytail: frozen-window grace; cadence 1-in-3 under defiance, tighten by
   dropping grace if abused.

   The one-free-retry marker (<ROOT>/.flowmap-turn-gate.json, or
   .flowmap-turn-gate-<agentId>.json inside a subagent sidechain — see
   sidechain binding below) exists because a denied read may genuinely have
   been alone (nothing else was worth batching) — the agent re-issues the
   identical call once, and that specific retry is let through (as
   allow-after-deny, which now also arms the grace window above) rather than
   looping forever.

   Sidechain binding: a PreToolUse hook fires inside a subagent sidechain
   too, but payload.transcript_path always points at the MAIN session
   transcript (which holds none of the sidechain's own messages). A
   subagent call carries payload.agent_id; when present, the gate looks for
   the sidechain's own transcript at
   <dir>/<sessionId>/subagents/agent-<agentId>.jsonl (sibling of the main
   transcript file) and reads THAT instead if it exists, falling back to the
   main transcript (fail-open) if not. Each agentId gets its own marker file
   so a subagent's streak/grace state never cross-talks with the main
   session's or another subagent's.

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
   'turns' entry in GATES). So only 'deny', 'allow-after-deny' and
   'allow-grace' events are recorded — never a plain allow. Each event
   carries agent: <agentId or null> so sidechain discipline is visible in
   the log.

   stdin : PreToolUse payload { tool_name, tool_input, transcript_path, session_id }
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { readFileSync, existsSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../lib/transcript.mjs';
import { recordEvent } from '../lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..', '..');

// ponytail: how many consecutive single-read turns trip the gate. Raise it
// if legitimate one-read-at-a-time work gets false-positived; lower it if
// agents are still routinely burning full re-reads one file at a time.
const THRESHOLD = 4;

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); } // see header: fails OPEN

// Debug capture, flag-file guarded: `touch <ROOT>/.flowmap-gate-debug` and every
// invocation appends its raw payload to .flowmap-gate-debug.jsonl — the only way
// to FALSIFY assumptions about what the harness actually sends (the payload
// shape has drifted before; see KNOWN_EDGES). Never affects decisions.
try {
  if (existsSync(join(ROOT, '.flowmap-gate-debug')))
    appendFileSync(join(ROOT, '.flowmap-gate-debug.jsonl'), JSON.stringify(payload) + '\n');
} catch { /* diagnostics must never change a decision */ }

const sessionId = payload?.session_id ?? null;
// subagent sidechain id, only present inside a subagent call (see header:
// sidechain binding). Validated so it is safe to use in a filename.
const agentId = (typeof payload?.agent_id === 'string' && /^[A-Za-z0-9_-]+$/.test(payload.agent_id))
  ? payload.agent_id : null;
const MARKER = join(ROOT, agentId ? `.flowmap-turn-gate-${agentId}.json` : '.flowmap-turn-gate.json');

let transcriptPath = payload?.transcript_path;
if (agentId && typeof transcriptPath === 'string' && !transcriptPath.includes('/subagents/')) {
  const candidate = join(dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents', `agent-${agentId}.jsonl`);
  if (existsSync(candidate)) transcriptPath = candidate; // else keep main transcript: fail-open
}
// gating a sidechain's own transcript (either remapped above, or handed to us
// directly) — its persistence timing differs from the main thread's, see below.
const sidechain = typeof transcriptPath === 'string' && transcriptPath.includes('/subagents/');

let text;
try { text = readFileSync(transcriptPath, 'utf8'); } catch { process.exit(0); } // see header: fails OPEN

const { calls } = parseTranscript(text);
if (!calls.length) process.exit(0);

// stale-state cleanup: any leftover marker for this gate instance (deny or
// grace) is meaningless once the streak is broken — leaving it behind could
// grant a spurious allow to a future, unrelated streak.
const dropStaleMarker = () => { if (existsSync(MARKER)) { try { unlinkSync(MARKER); } catch { /* already gone */ } } };

// Sidechain persistence timing (live-fire, 2026-07-04, this repo's own probes):
// a sidechain transcript persists the in-flight assistant message's EARLY lines
// (text/thinking blocks) BEFORE PreToolUse fires — the OPPOSITE of the main
// thread, where the in-flight message is entirely absent at hook time. So in a
// sidechain, a TRAILING zero-tool call is the in-flight partial, not a
// completed text-only message: trim trailing zero-tool calls before judging
// the tail, else the streak reads 0 forever and the gate never binds (the
// exact silent-allow observed on the 7-lone-read probe). The main thread is
// NOT trimmed — there a trailing zero-tool call is a real completed message
// and a genuine streak break.
let end = calls.length;
if (sidechain) { while (end > 0 && calls[end - 1].tools.length === 0) end--; }
const judged = calls.slice(0, end);
if (!judged.length) process.exit(0);

const last = judged[judged.length - 1];

const isSingleRead = (call) =>
  call.tools.length === 1 && /^(Read|Grep|Glob)$/.test(call.tools[0].name);

let streak = 0;
for (let i = judged.length - 1; i >= 0 && isSingleRead(judged[i]); i--) streak++;

// debug capture (see flag above): the computed decision inputs, so a live
// falsification can see WHAT the gate saw, not just what it received.
try {
  if (existsSync(join(ROOT, '.flowmap-gate-debug')))
    appendFileSync(join(ROOT, '.flowmap-gate-debug.jsonl'),
      JSON.stringify({ computed: { agentId, transcriptPath, calls: calls.length, judged: judged.length, lastTools: last.tools.length, streak } }) + '\n');
} catch { /* diagnostics must never change a decision */ }

if (last.tools.length >= 2) { dropStaleMarker(); process.exit(0); } // part of a batched turn

if (streak < THRESHOLD) { dropStaleMarker(); process.exit(0); }

let marker = null;
try { marker = JSON.parse(readFileSync(MARKER, 'utf8')); } catch { /* none yet */ }

// Frozen-window grace (see header): a grace marker records the transcript
// snapshot at the moment the retry was allowed. Every read of a following
// in-flight (not-yet-persisted) batch sees IDENTICAL transcript state, so
// calls.length/streak deltas of 0 from that snapshot are common; the retry
// itself may also have just persisted, advancing both by exactly 1. Either
// way is a "frozen window" -> allow-grace, snapshot left untouched. A delta
// > 1 means a genuinely new lone-read turn landed -> the window moved, so
// the grace marker is discarded and normal deny/marker logic re-arms below.
if (marker && marker.session === sessionId && marker.grace === true) {
  const frozen = (judged.length - marker.calls) <= 1 && (streak - marker.streak) <= 1;
  if (frozen) {
    recordEvent({ event: 'gate', source: 'turn-gate.mjs', session: sessionId, gate: 'turns', decision: 'allow-grace', agent: agentId });
    process.exit(0);
  }
  try { unlinkSync(MARKER); } catch { /* already gone */ }
  marker = null;
}

// <= not >=: the denied call's own message may or may not be persisted in
// the transcript depending on harness version (see header, live-fire), so
// the retry's recomputed streak can land EQUAL to the marker's (message not
// yet persisted) or ONE GREATER (message now persisted). <= passes both.
// Deliberate consequence: a streak that keeps growing turns into an
// alternating deny/allow throttle rather than a hard wall.
if (marker && marker.session === sessionId && marker.streak <= streak) {
  writeFileSync(MARKER, JSON.stringify({ session: sessionId, grace: true, calls: judged.length, streak }));
  recordEvent({ event: 'gate', source: 'turn-gate.mjs', session: sessionId, gate: 'turns', decision: 'allow-after-deny', agent: agentId });
  process.exit(0);
}

writeFileSync(MARKER, JSON.stringify({ session: sessionId, streak }));
const reason = `flowmap turn-gate: ${streak} consecutive single-read turns — batch independent reads ` +
  'into ONE response (multiple tool calls, or one grep over many files). If this read is genuinely ' +
  'alone, re-issue the same call once to pass.';
recordEvent({ event: 'gate', source: 'turn-gate.mjs', session: sessionId, gate: 'turns', decision: 'deny', agent: agentId });
process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
process.stderr.write(reason + '\n');
process.exit(2);
