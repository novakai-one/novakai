/* =====================================================================
   metrics-log.mjs — M2b: the ONE compliance-metrics emitter.
   ---------------------------------------------------------------------
   Every gate decision, quiz check, ship run and closed-form verdict is
   transient today: an exit code and a print. This module appends each as
   one JSONL line to docs/flowmap/metrics/session-log.jsonl so trust can
   be a RATE over N runs (summarised by metrics.mjs), not one green run.

   THE invariant, and the reason the whole body is one try/catch that
   swallows everything:

     Logging may never change any gate's decision, exit code, stdout,
     or latency class.

   This mirrors the gates' own fail-open rule (a gate must not block work
   on its own bug). A broken emitter therefore silently undercounts; that
   cost is accepted and named in the design (m2b-metrics-design.md §3/§8).
   FLOWMAP_METRICS_DEBUG=1 prints emit errors to stderr for development.

   Imported, not spawned (lib/canonical.mjs is the precedent): spawning a
   recorder CLI inside a PreToolUse hook would tax every Edit/Write.

   Schema v1 (design §2): the emitter stamps { v, ts, session:null-default };
   the caller supplies { event, source, session? } plus the extension block.
   The log lives under root/docs/flowmap/metrics/ — root is the explicit
   argument, else FLOWMAP_ROOT (the gates' hermetic test seam), else the
   repo this file lives in. The directory is gitignored (design §7).
   ===================================================================== */

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

/** Append one metrics event. Never throws; never writes to stdout. */
export function recordEvent(fields, root) {
  try {
    const base = root
      ? resolve(root)
      : (process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : REPO_ROOT);
    const dir = join(base, 'docs', 'flowmap', 'metrics');
    mkdirSync(dir, { recursive: true });
    const line = { v: 1, ts: new Date().toISOString(), session: null, ...fields };
    // One complete \n-terminated sub-1KB line on an O_APPEND fd — atomic in
    // practice; a torn line is absorbed by the summarizer's malformed-skip.
    appendFileSync(join(dir, 'session-log.jsonl'), JSON.stringify(line) + '\n');
  } catch (e) {
    if (process.env.FLOWMAP_METRICS_DEBUG === '1') {
      try { process.stderr.write('metrics-log emit failed: ' + (e?.message || e) + '\n'); } catch { /* still silent */ }
    }
  }
}
