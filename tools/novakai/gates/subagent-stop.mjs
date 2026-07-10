#!/usr/bin/env node
/* =====================================================================
   subagent-stop.mjs — C9: SubagentStop verdict hook.
   ---------------------------------------------------------------------
   When a CONTRACT subagent finishes (its prompt carried the same sentinel
   contract-gate reads), a machine VERDICT must EXIST — computed, not the
   agent's own account. This hook routes to verify-change and writes the
   verdict where the leader/dispatch done-criteria read it, so trust rests
   on the artifact, never the report.

     • no agent transcript / no sentinel -> exit 0 SILENTLY (a recon/verify
       subagent, or any non-contract spawn, is not our business)
     • sentinel present -> run
         verify-change --change <id> --json --strict
                        --drift-base <merge-base HEAD origin/main>
                        --drift-out .novakai-verdicts/<id>.drift.json
       write its stdout to .novakai-verdicts/<id>.json (dir gitignored),
       emit ONE non-blocking additionalContext line (verdict + drift count).

   NEVER blocks the stop: it emits no `decision` key and exits 0 on every
   path, including any internal error. The --drift flags are C6' (a sibling
   builder); if verify-change doesn't yet know them it ignores them (unknown
   flags are dropped by its arg()), so this hook is forward-compatible.

   TEST SEAMS (env overrides, so the suite needs no live subagent/git):
     • NOVAKAI_ROOT           — repo root (verdict dir, git cwd)
     • NOVAKAI_VERIFY_CHANGE  — path to the verify-change script to spawn
     • NOVAKAI_DRIFT_BASE     — skip `git merge-base`, use this ref directly

   stdin : SubagentStop payload { agent_id?, agent_transcript_path?, transcript_path? }
   exit  : always 0 (advisory; never blocks a stop).
   ===================================================================== */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NOVAKAI_ROOT ? resolve(process.env.NOVAKAI_ROOT) : join(HERE, '..', '..', '..');
// Same sentinel/plan tokens contract-gate.mjs:48-49 and edit-gate read.
const SENTINEL = /NOVAKAI-CONTRACT:\s*([A-Za-z0-9_-]+)/;
// path-char class, not \S: the transcript head is JSONL, so the newline after the tag
// is the two literal chars \n — \S+ swallows them plus the next word into the path.
const PLAN_TAG = /NOVAKAI-PLAN:\s*([\w./-]+)/;
const VERDICT_DIR = '.novakai-verdicts';

const silent = () => process.exit(0);

try {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    silent();
  }

  const agentId = (typeof payload?.agent_id === 'string' && /^[A-Za-z0-9_-]+$/.test(payload.agent_id))
    ? payload.agent_id : null;

  // Locate the agent's OWN transcript: the explicit field first, else the
  // turn-gate remap from the main transcript + agent_id (both JSONL shapes).
  let transcriptPath = typeof payload?.agent_transcript_path === 'string' ? payload.agent_transcript_path : null;
  if (!transcriptPath) {
    transcriptPath = payload?.transcript_path;
    if (agentId && typeof transcriptPath === 'string' && !transcriptPath.includes('/subagents/')) {
      const candidate = join(
        dirname(transcriptPath), basename(transcriptPath, '.jsonl'), 'subagents', `agent-${agentId}.jsonl`,
      );
      if (existsSync(candidate)) transcriptPath = candidate;
    }
  }

  let text;
  try {
    text = readFileSync(transcriptPath, 'utf8');
  } catch {
    silent();
  }
  const head = text.slice(0, 64 * 1024);
  const sentinelMatch = SENTINEL.exec(head);
  if (!sentinelMatch) silent(); // no sentinel -> not a contract subagent -> no-op
  const id = sentinelMatch[1];
  const planTag = PLAN_TAG.exec(head);

  // drift base: env override (test seam) else the merge-base with origin/main.
  let base = process.env.NOVAKAI_DRIFT_BASE || null;
  if (!base) {
    const mergeBaseRun = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
    if (mergeBaseRun.status === 0 && mergeBaseRun.stdout) base = mergeBaseRun.stdout.trim();
  }

  const dir = join(ROOT, VERDICT_DIR);
  mkdirSync(dir, { recursive: true });
  const driftOut = join(dir, `${id}.drift.json`);
  const verdictOut = join(dir, `${id}.json`);

  const VERIFY = process.env.NOVAKAI_VERIFY_CHANGE || join('tools', 'novakai', 'contract', 'verify-change.mjs');
  const args = [VERIFY, '--change', id, '--json', '--strict'];
  if (planTag) args.push('--plan', planTag[1]);
  if (base) args.push('--drift-base', base, '--drift-out', driftOut);
  const verifyRun = spawnSync('node', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (verifyRun.stdout) {
    try {
      writeFileSync(verdictOut, verifyRun.stdout);
    } catch { /* non-fatal */ }
  }

  let verdict = 'UNKNOWN';
  try {
    verdict = JSON.parse(verifyRun.stdout).verdict || verdict;
  } catch { /* leave UNKNOWN */ }
  let driftCount = 0;
  try {
    driftCount = (JSON.parse(readFileSync(driftOut, 'utf8')).files || []).length;
  } catch { /* no drift file */ }

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'SubagentStop',
      additionalContext: `novakai verdict for change "${id}": ${verdict}; `
        + `scope drift ${driftCount} file(s) — see ${VERDICT_DIR}/${id}.json`,
    },
  }) + '\n');
} catch { /* any internal error -> never block the stop */ }
process.exit(0);
