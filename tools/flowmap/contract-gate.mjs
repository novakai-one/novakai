#!/usr/bin/env node
/* =====================================================================
   contract-gate.mjs — PreToolUse spawn-gate for contract-execution spawns.
   ---------------------------------------------------------------------
   SCOPE (honest, per audit finding F-01 — the old "100% GATE" header
   overstated): this gate covers Agent/Task spawns only (the hook matcher);
   main-agent Edit/Write is ungated by design. Within that scope it now
   fails CLOSED on anything sentinel-shaped or unverifiable:

     • prompt carries NO sentinel        -> ALLOW (recon / verify / analysis
                                            subagents pass through untouched)
     • prompt carries FLOWMAP-CONTRACT:<id> and <id> resolves to a VALID,
       COHERENT contract packet           -> ALLOW (the execution is provably
                                            handed a real contract, not prose)
     • sentinel present but <id> is missing / unresolvable / incoherent
                                          -> DENY (exit 2; reason on stderr)
     • NEAR-MISS sentinel (FLOWMAP_CONTRACT, wrong case, missing id)
                                          -> DENY — a typo'd sentinel is an
                                            attempted contract spawn, not prose
                                            (AUD2 attack A1: the typo hole)
     • stdin that does not parse          -> DENY — the matcher guarantees this
                                            payload IS an agent spawn; input the
                                            gate cannot read cannot be verified

   Still fails OPEN on the gate's own internal faults (e.g. contract.mjs
   unspawnable): the gate must not block legitimate work because of its own
   bug. Space-separated prose ("the flowmap contract loop") is NOT a
   near-miss — only compact token forms are.

   Sentinel (place in the subagent prompt):  FLOWMAP-CONTRACT:<change-id>
   Optional plan override:                    FLOWMAP-PLAN:<path/to/plan.json>

   stdin : { tool_name, tool_input: { prompt } }   (PreToolUse payload)
   stdout: on DENY, a JSON line { decision:"block", reason } — "block" is
           the harness's accepted vocabulary; "deny" fails schema
           validation and silently un-blocks the gate (live-fire, 2026-07-04).
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from './lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SENTINEL = /FLOWMAP-CONTRACT:\s*([A-Za-z0-9_-]+)/;
const PLAN_TAG = /FLOWMAP-PLAN:\s*(\S+)/;
// Compact token forms only (hyphen/underscore, any case) — a typo'd sentinel
// is an attempted contract spawn. Space-separated prose does not match.
const NEAR_MISS = /FLOWMAP[-_]CONTRACT/i;

// M2b telemetry (fail-silent; may never change a decision or exit code).
let evSession = null;
const record = (decision, reason) => recordEvent({
  event: 'gate', source: 'contract-gate.mjs', session: evSession,
  gate: 'contract', decision, ...(reason ? { reason } : {}),
});

function allow() { record('allow'); process.exit(0); }
function deny(reason) {
  record('deny', reason);
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.stderr.write('flowmap contract-gate DENIED spawn: ' + reason + '\n');
  process.exit(2);
}

let payload;
try {
  const raw = readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch {
  // The hook matcher is Agent|Task — this payload IS an agent spawn. Input
  // the gate cannot read cannot be verified: fail CLOSED (F-01; was ALLOW).
  deny('PreToolUse payload did not parse — the gate cannot verify this agent spawn');
}

// Only gate agent-spawning tools; anything else passes.
evSession = payload?.session_id ?? null;
const tool = payload?.tool_name || '';
if (!/^(Agent|Task)/.test(tool)) allow();

const prompt = String(payload?.tool_input?.prompt ?? '');
const m = SENTINEL.exec(prompt);
if (!m) {
  // A near-miss (FLOWMAP_CONTRACT, wrong case, sentinel with no id) is an
  // attempted contract spawn that would previously slip through ungated
  // (AUD2 attack A1). Deny with the correction rather than allow silently.
  if (NEAR_MISS.test(prompt)) {
    deny('near-miss contract sentinel in prompt (typo or missing id?) — use exactly FLOWMAP-CONTRACT:<change-id>');
  }
  allow(); // no sentinel at all -> not a contract-execution spawn -> pass through
}

const id = m[1];
const planTag = PLAN_TAG.exec(prompt);
const args = ['tools/flowmap/contract.mjs', '--change', id, '--json'];
if (planTag) args.push('--plan', planTag[1]);

let r;
try {
  r = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
  // tooling itself broke -> fail open rather than wedge the session
  allow();
}

if (r.status !== 0) {
  deny(`spawn carries FLOWMAP-CONTRACT:${id} but no valid contract resolves (contract.mjs exit ${r.status}). ` +
       `A subagent may not execute a change that has no emittable contract.`);
}

let packet;
try { packet = JSON.parse(r.stdout); }
catch { deny(`contract for "${id}" produced unparseable output`); }

if (!packet.coherent) {
  deny(`contract for "${id}" is incoherent: ${(packet.coherenceProblems || []).join('; ') || 'see plan-check'}`);
}

// valid + coherent contract -> the execution is provably grounded
allow();
