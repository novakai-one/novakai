#!/usr/bin/env node
/* =====================================================================
   reminder-hook.mjs — M10: PreToolUse advisory reminder injector.
   ---------------------------------------------------------------------
   Purpose: periodically nudge the main agent (never a subagent) with a
   one-line reminder about subagent delegation and read/write batching —
   the same discipline turn-gate.mjs enforces, but here it is purely
   ADVISORY: this hook never blocks, denies, or alters permission
   behavior. It only ever adds context.

   SCHEMA SAFETY (why this hook is written so defensively): a prior
   Phase B finding (see turn-gate.mjs header, 2026-07-04) showed that
   hook stdout JSON which doesn't match the harness's accepted schema is
   silently downgraded rather than erroring loudly — a `decision` value
   outside the accepted vocabulary just makes the hook's output inert.
   For a BLOCKING gate that is a bug (the gate un-blocks itself). For an
   advisory hook it would be a *different* hazard in reverse: emitting a
   `decision` or `permissionDecision` field at all — even accidentally,
   even with a "safe" value — would let this hook affect real permission
   behavior, which it must never do. So this hook:
     - NEVER emits a `decision` or `permissionDecision` key, anywhere.
     - The ONLY thing ever printed to stdout is nothing, or exactly one
       line shaped { hookSpecificOutput: { hookEventName, additionalContext } }.
     - ALWAYS exits 0 — every branch, including any internal/unexpected
       error — so this hook can never wedge or otherwise affect a turn.

   Behavior: counts PreToolUse(Bash) calls for the current session in
   <ROOT>/.flowmap-reminders.json (ROOT resolved the same way as
   turn-gate.mjs: FLOWMAP_ROOT env var, else repo root). Every Nth call
   (N = FLOWMAP_REMINDER_EVERY env var, default 2) it fires: prints one
   additionalContext line, alternating between two rotating messages.
   Subagent calls (payload.isSidechain or payload.agent_id present) are
   skipped entirely and never counted — reminders target the main agent.

   stdin : PreToolUse payload { tool_name, session_id, isSidechain?, agent_id? }
   exit  : always 0.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../lib/metrics-log.mjs';

const MESSAGES = [
  'high priority reminder: subagent use is high priority, 2-5x cheaper, only essential tasks in main agent.',
  'high priority reminder: batch read and write activities to reduce turns, grep by lookup where appropriate.',
];

function main() {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..', '..');
  const STATE_FILE = join(ROOT, '.flowmap-reminders.json');

  let payload;
  try { payload = JSON.parse(readFileSync(0, 'utf8')); } catch { return; }

  if (payload?.isSidechain === true || payload?.agent_id) return; // main-thread only, not counted

  const sessionId = payload?.session_id ?? null;

  let state = null;
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* none yet */ }
  if (!state || state.session !== sessionId) state = { session: sessionId, count: 0 };

  state.count += 1;
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));

  const envN = parseInt(process.env.FLOWMAP_REMINDER_EVERY, 10);
  const N = Number.isInteger(envN) && envN > 0 ? envN : 2;

  if (state.count % N !== 0) return; // not firing this call

  const firingIndex = state.count / N;
  const message = MESSAGES[firingIndex % 2 === 0 ? 0 : 1];

  try {
    recordEvent({ event: 'gate', source: 'reminder-hook.mjs', session: sessionId, gate: 'reminder', decision: 'inject', agent: null });
  } catch { /* fail-silent: must never affect stdout output */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message },
  }) + '\n');
}

try {
  main();
} catch { /* always exit 0, no stdout on unexpected errors */ }
process.exit(0);
