#!/usr/bin/env node
/* =====================================================================
   plan-gate.mjs — M2: PreToolUse plan-check gate for ExitPlanMode.
   ---------------------------------------------------------------------
   C3 (authoring-time coherence) enforced at the moment a plan is
   presented for approval: an agent may not exit plan mode while the
   flowmap planning state is incoherent. Two claims, both machine-checked
   by plan-check.mjs (REAL-IDS, DANGLING-DEP, ACYCLIC, PARENT-EXISTS,
   COHERENT-ACCEPTED):

     • plan text carries FLOWMAP-PLAN:<path> -> that plan file must
       resolve and pass plan-check              -> ALLOW / DENY
     • NEAR-MISS sentinel (FLOWMAP_PLAN, wrong case) -> DENY — a typo'd
       sentinel is an attempted flowmap plan, not prose (the AUD2 A1
       lesson, applied here from day one)
     • no sentinel -> the repo's in-flight plan (public/plan.json — the
       exact file CI certs) must still pass plan-check if it exists;
       absent -> ALLOW (nothing to check)
     • stdin that does not parse -> DENY — the matcher guarantees this
       payload IS a plan approval; input the gate cannot read cannot be
       verified (fail closed)
     • plan-check.mjs itself unspawnable -> ALLOW — the gate must not
       block legitimate work on its own bug

   FLOWMAP_ROOT env var is a test seam: it points the gate at a fixture
   checkout so the suite can prove all branches offline.

   stdin : { tool_name, tool_input: { plan } }   (PreToolUse payload)
   stdout: on DENY, a JSON line { decision:"block", reason } — "block" is
           the harness's accepted vocabulary; "deny" fails schema
           validation and silently un-blocks the gate (live-fire, 2026-07-04).
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from './lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..');
const PLAN_CHECK = join(HERE, 'plan-check.mjs');
const SENTINEL = /FLOWMAP-PLAN:\s*(\S+)/;
// Compact token forms only — space-separated prose ("the flowmap plan") is not a near-miss.
const NEAR_MISS = /FLOWMAP[-_]PLAN/i;

// M2b telemetry context (fail-silent; may never change a decision or exit code).
let evSession = null;
let evTarget = null;
const record = (decision, reason) => recordEvent({
  event: 'gate', source: 'plan-gate.mjs', session: evSession,
  gate: 'plan', decision,
  ...(reason ? { reason } : {}), ...(evTarget ? { target: evTarget } : {}),
});

function allow() { record('allow'); process.exit(0); }
function deny(reason) {
  record('deny', reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.stderr.write('flowmap plan-gate DENIED plan approval: ' + reason + '\n');
  process.exit(2);
}

function planCheck(planPath) {
  evTarget = planPath;
  let r;
  try {
    r = spawnSync('node', [PLAN_CHECK, '--plan', planPath], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    allow(); // the gate's own fault must not wedge the session
  }
  if (r.status !== 0) {
    deny(`plan "${planPath}" fails coherence (plan-check exit ${r.status}): ` +
         ((r.stdout || '').trim().split('\n').slice(0, 4).join(' | ') || 'see flowmap:plan-check'));
  }
}

let payload;
try {
  payload = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  deny('PreToolUse payload did not parse — the gate cannot verify this plan approval');
}

// Only gate plan approval; anything else passes.
evSession = payload?.session_id ?? null;
const tool = payload?.tool_name || '';
if (tool !== 'ExitPlanMode') allow();

const planText = String(payload?.tool_input?.plan ?? '');
const m = SENTINEL.exec(planText);

if (m) {
  // The plan explicitly names its flowmap plan file — that file is the contract.
  planCheck(resolve(ROOT, m[1]));
  allow();
}

if (NEAR_MISS.test(planText)) {
  deny('near-miss plan sentinel in the plan text (typo?) — use exactly FLOWMAP-PLAN:<path/to/plan.json>');
}

// No sentinel: the repo's in-flight plan must still be coherent at approval time.
const inflight = join(ROOT, 'public', 'plan.json');
if (existsSync(inflight)) planCheck(inflight);

allow();
