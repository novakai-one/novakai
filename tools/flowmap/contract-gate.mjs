#!/usr/bin/env node
/* =====================================================================
   contract-gate.mjs — PreToolUse spawn-gate (the piece that makes
   "subagents go through the contract" a 100% GATE, not a convention).
   ---------------------------------------------------------------------
   Wired as a PreToolUse hook on the Agent/Task tool. It reads the spawn
   request on stdin ({ tool_name, tool_input:{ prompt, ... } }) and:

     • prompt carries NO sentinel        -> ALLOW (recon / verify / analysis
                                            subagents pass through untouched)
     • prompt carries FLOWMAP-CONTRACT:<id> and <id> resolves to a VALID,
       COHERENT contract packet           -> ALLOW (the execution is provably
                                            handed a real contract, not prose)
     • sentinel present but <id> is missing / unresolvable / incoherent
                                          -> DENY (exit 2; reason on stderr)

   It FAILS OPEN: any parse error, missing field, or internal fault -> ALLOW.
   A spawn-gate must never block legitimate work because of its own bug; its
   only job is to refuse a contract-execution spawn that lacks a real contract.

   Sentinel (place in the subagent prompt):  FLOWMAP-CONTRACT:<change-id>
   Optional plan override:                    FLOWMAP-PLAN:<path/to/plan.json>

   stdin : { tool_name, tool_input: { prompt } }   (PreToolUse payload)
   stdout: on DENY, a JSON line { decision:"deny", reason }
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SENTINEL = /FLOWMAP-CONTRACT:\s*([A-Za-z0-9_-]+)/;
const PLAN_TAG = /FLOWMAP-PLAN:\s*(\S+)/;

function allow() { process.exit(0); }
function deny(reason) {
  process.stdout.write(JSON.stringify({ decision: 'deny', reason }) + '\n');
  process.stderr.write('flowmap contract-gate DENIED spawn: ' + reason + '\n');
  process.exit(2);
}

let payload;
try {
  const raw = readFileSync(0, 'utf8');
  payload = JSON.parse(raw);
} catch {
  allow(); // can't parse the request -> fail open
}

// Only gate agent-spawning tools; anything else passes.
const tool = payload?.tool_name || '';
if (!/^(Agent|Task)/.test(tool)) allow();

const prompt = String(payload?.tool_input?.prompt ?? '');
const m = SENTINEL.exec(prompt);
if (!m) allow(); // not a contract-execution spawn -> pass through

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
