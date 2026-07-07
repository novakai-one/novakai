#!/usr/bin/env node
/* =====================================================================
   edit-gate.mjs — M2: PreToolUse quiz-gate for Edit|Write.
   ---------------------------------------------------------------------
   Session-protocol rule 2 ("make understanding testable") as a machine
   gate: an agent may not EDIT the app before its read of the map is
   verified. The proof is the quiz-pass artifact (.novakai-quiz-pass.json,
   AUD5 F-03) — bound to the sha256 of the exact map bytes it was scored
   against, so a pass goes stale the moment the map changes.

   TWO PATHS (by whether the payload carries agent_id):
   • MAIN AGENT (no agent_id) — the quiz gate below. Only paths under src/
     are gated: the quiz proves understanding of the src map (_bundle.mmd),
     so that is the claim this gate can enforce. Edits to tools/, docs/,
     configs are ungated by design (they carry their own gates:
     tooling-coverage, roadmap:audit, handoff-fresh).
   • SUBAGENT (agent_id present, C2) — the contract-scope branch. A subagent
     is scoped by its spawn CONTRACT across the WHOLE repo (not just src/):
     the contract id rides its prompt as the same sentinel contract-gate
     reads, and the packet's editScope decides (deny=block, warn=allow+
     systemMessage, allow=pass). No resolvable contract -> block repo writes.
     HONEST LIMIT: Edit/Write only — a subagent's Bash-driven writes are
     caught at verdict time by the drift report (verify-change --drift-base /
     subagent-stop.mjs), never at this hook.

     • tool is not Edit/Write            -> ALLOW (defense in depth; the
                                            matcher should not send these)
     • target path outside src/          -> ALLOW (out of the map's claim)
     • src/ Write to a path that does    -> ALLOW (chicken-and-egg: a brand-
       NOT exist on disk yet                new file has no fragment yet, so
                                            a scoped quiz verify can never
                                            pass for it; the map cannot claim
                                            a file it doesn't contain, so
                                            creating one is outside its claim.
                                            The A1 completeness gate +
                                            novakai:ship still force the
                                            fragment before merge. Edit is
                                            NOT exempted — Edit only ever
                                            targets a file that already
                                            exists, so this branch cannot be
                                            used to sneak past the gate on a
                                            file the map should already cover)
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

   NOVAKAI_ROOT env var is a test seam: it points the gate at a fixture
   checkout so the suite can prove all branches without touching the real
   session's quiz state. NOVAKAI_CONTRACT_CMD is the sibling seam for the
   C2 subagent branch (a fixture packet emitter in place of contract.mjs).

   stdin : { tool_name, tool_input: { file_path } }   (PreToolUse payload)
   stdout: on DENY, a JSON line { decision:"block", reason } — "block" is
           the harness's accepted vocabulary; "deny" fails schema
           validation and silently un-blocks the gate (live-fire, 2026-07-04).
   exit  : 0 = allow, 2 = deny.
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../lib/metrics-log.mjs';
import { matchScope } from '../lib/scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NOVAKAI_ROOT ? resolve(process.env.NOVAKAI_ROOT) : join(HERE, '..', '..', '..');
const QUIZ = join(HERE, '..', 'onboard', 'quiz.mjs');

// C2 subagent branch: the SAME sentinel/plan tokens contract-gate.mjs:48-49
// reads (a subagent's spawn contract rides its own prompt). Kept byte-identical
// to contract-gate's literals — contract-gate self-executes on import, so the
// regex cannot be imported; this copy is the shared source.
const SENTINEL = /NOVAKAI-CONTRACT:\s*([A-Za-z0-9_-]+)/;
const PLAN_TAG = /NOVAKAI-PLAN:\s*(\S+)/;

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
  process.stderr.write('novakai edit-gate DENIED edit: ' + reason + '\n');
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
// Subagent sidechain id (only present inside a subagent call — same field
// turn-gate.mjs:142 reads). Validated so it is safe in a filename.
const agentId = (typeof payload?.agent_id === 'string' && /^[A-Za-z0-9_-]+$/.test(payload.agent_id))
  ? payload.agent_id : null;
const tool = payload?.tool_name || '';
if (!/^(Edit|Write)$/.test(tool)) allow();

const fp = payload?.tool_input?.file_path;
evTarget = typeof fp === 'string' ? fp : null;
if (!fp) deny('Edit/Write payload carries no file_path — an edit the gate cannot scope cannot be verified');

const target = resolve(ROOT, String(fp));

/* ---------- C2: subagent contract-scope branch (agent_id present) ----------
   A subagent's Edit/Write is scoped by its spawn CONTRACT (the whole repo,
   not just src/), not by the main-agent quiz. The contract id rides the
   subagent's own prompt as the same sentinel contract-gate reads; the
   regenerated packet's editScope decides via matchScope:
     deny  (FROZEN) -> BLOCK always
     warn  (out of allow) -> ALLOW + systemMessage (warn-first)
     allow (in scope)     -> plain ALLOW
   No sentinel / unreadable transcript / packet-regen failure -> BLOCK repo
   writes (remedy names dispatch), ALLOW writes outside the tree. Fails OPEN
   only on the gate's OWN unexpected bug. HONEST LIMIT: this covers Edit/Write
   only — a subagent's Bash-driven writes are caught at verdict time by the
   drift report (verify-change --drift-base / subagent-stop.mjs), not here. */
if (agentId) {
  const rel = relative(ROOT, target);
  const insideRepo = !!rel && !rel.startsWith('..') && !isAbsolute(rel);
  const noContract = (why) => {
    if (insideRepo) deny(`subagent Edit/Write of ${rel} without a resolved contract (${why}) — ` +
      `spawn via \`npm run novakai:dispatch -- --change <id>\` and carry NOVAKAI-CONTRACT:<id> in the prompt`);
    allow(); // outside the repo tree: not the contract's business
  };
  try {
    // derive the subagent's OWN transcript (turn-gate remap; both shapes:
    // an already-remapped /subagents/ path is used as-is, else derived from
    // the main transcript + agent_id when that sidechain file exists).
    let tp = payload?.transcript_path;
    if (typeof tp === 'string' && !tp.includes('/subagents/')) {
      const candidate = join(dirname(tp), basename(tp, '.jsonl'), 'subagents', `agent-${agentId}.jsonl`);
      if (existsSync(candidate)) tp = candidate;
    }
    let text;
    try { text = readFileSync(tp, 'utf8'); } catch { noContract('subagent transcript unreadable'); }
    const head = text.slice(0, 64 * 1024); // the spawn prompt lives at the top
    const m = SENTINEL.exec(head);
    if (!m) noContract('no contract sentinel in the subagent prompt');
    const id = m[1];
    // NOVAKAI_CONTRACT_CMD is a test seam (a fixture packet emitter), same
    // spirit as NOVAKAI_ROOT — production spawns the real contract.mjs.
    const contractCmd = process.env.NOVAKAI_CONTRACT_CMD || 'tools/novakai/contract/contract.mjs';
    const cArgs = [contractCmd, '--change', id, '--json'];
    const planTag = PLAN_TAG.exec(head);
    if (planTag) cArgs.push('--plan', planTag[1]);
    const cr = spawnSync('node', cArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (cr.status !== 0 || !cr.stdout) noContract(`contract for "${id}" did not resolve (contract.mjs exit ${cr.status})`);
    let packet;
    try { packet = JSON.parse(cr.stdout); } catch { noContract(`contract for "${id}" produced unparseable output`); }
    const decision = matchScope(rel, packet.editScope);
    if (decision === 'deny') {
      deny(`subagent edit of ${rel} hits change "${id}"'s FROZEN deny-list — this file's blast radius is the whole app, ` +
        `out of any one change's scope. Make it a dedicated, human-reviewed change.`);
    }
    if (decision === 'warn') {
      // out-of-allow: warn-first — allow but flag it (exit 0, non-blocking).
      record('allow', `warn: ${rel} outside change "${id}" editScope.allow`);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse', permissionDecision: 'allow',
          permissionDecisionReason: `${rel} is outside change "${id}" editScope.allow — permitted (warn-first)`,
        },
        systemMessage: `novakai edit-gate: ${rel} is OUTSIDE change "${id}" editScope.allow — allowed with a warning. ` +
          `Confirm it belongs to this contract (npm run novakai:dispatch -- --change ${id}).`,
      }) + '\n');
      process.exit(0);
    }
    allow(); // inside allow -> clean
  } catch { allow(); } // the gate's own bug must never wedge a subagent
}

// Outside src/ -> outside the map's claim -> ungated by design (see header).
if (!target.startsWith(join(ROOT, 'src') + sep)) allow();

// New-file bootstrap (see header): a Write creating a src/ file that does not
// yet exist cannot be scoped by a quiz verify (no fragment exists to score
// against), so it is outside the map's claim by definition. Edit is excluded
// on purpose — it only ever targets an existing file, which the map should
// already account for.
if (tool === 'Write' && !existsSync(target)) allow();

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
       ' (onboard STEP 4: npm run novakai:quiz)');
}

// quiz pass verified against the current map bytes -> the editor provably read the map
allow();
