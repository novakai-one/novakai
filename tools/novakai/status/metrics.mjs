#!/usr/bin/env node
/* =====================================================================
   metrics.mjs — M2b: compliance metrics over the session log.
   ---------------------------------------------------------------------
   The roadmap intent: "Quantified trust: quiz pass rate, cert pass rate,
   gate-deny count, PASS_UNPROVEN ratio over N loop runs. Converts trust
   from one green run to a number." The gates/quiz/verdict tools emit
   events via lib/metrics-log.mjs into docs/novakai/metrics/
   session-log.jsonl (gitignored, session/machine-local); this CLI reads
   them back.

   Two subcommands:

     summary [--json] [--since <ISO>] [--last <N>]
       The four intent metrics + provenance counters. 0/0 renders as
       "n/a" (JSON null), NEVER 0% — "no data" and "perfect compliance"
       must be distinguishable (an unearned green is exactly what M2b
       exists to kill). Malformed lines are skipped and COUNTED, never
       fatal. Unknown event values count under "other" (a v-bump
       degrades gracefully).

     wrap --event <name> -- <cmd ...>
       The ship-run recorder: logs {phase:"start"}, runs the command,
       logs {phase:"end", ok, durationMs}, and is INVISIBLE to callers —
       the child's exit code passes through; a signal-killed child
       re-raises the same signal. An unmatched start (aborted/killed
       harder than SIGTERM) is what summary reports as "aborted".

   Root resolution matches the gates: NOVAKAI_ROOT (hermetic test seam)
   else the repo this file lives in.

   Exit (summary): 0 = summary produced, INCLUDING absent/empty log
   (the metrics reader is never itself a gate); 1 = log present but
   unreadable at the file level; 2 = usage error.
   Exit (wrap): the child's exit code / signal; 2 = usage error.
   ===================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordEvent } from '../lib/metrics-log.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NOVAKAI_ROOT ? resolve(process.env.NOVAKAI_ROOT) : join(HERE, '..', '..', '..');
const LOG = join(ROOT, 'docs', 'novakai', 'metrics', 'session-log.jsonl');
const GATES = ['edit', 'plan', 'ship-staleness', 'contract', 'turns'];

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CMD = process.argv[2];

/* ---------------- summary ---------------- */
function loadEvents() {
  // Absent log = fresh clone / no activity yet: a valid, empty summary.
  if (!existsSync(LOG)) return { events: [], malformed: 0, absent: true };
  let raw;
  try { raw = readFileSync(LOG, 'utf8'); }
  catch (e) {
    console.error(`metrics log exists but is unreadable: ${e.message}`);
    process.exit(1);
  }
  const events = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { malformed++; }
  }
  return { events, malformed, absent: false };
}

const ratio = (num, den) => (den > 0 ? num / den : null);
const pct = (r) => (r === null ? 'n/a' : Math.round(r * 100) + '%');

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function summarize(events) {
  const quiz = { attempts: 0, passes: 0, passRate: null };
  const gates = {};
  for (const g of GATES) gates[g] = { allow: 0, deny: 0, denyRatio: null };
  const ship = { runs: 0, completed: 0, aborted: 0, okRate: null, medianDurationMs: null };
  const cert = { total: 0, pass: 0, passRate: null };
  const verify = { total: 0, passUnproven: 0, unprovenRatio: null };
  let other = 0;

  let openStarts = 0;
  let shipOk = 0;
  const durations = [];

  for (const e of events) {
    switch (e.event) {
      case 'quiz':
        if (e.cmd === 'check') { quiz.attempts++; if (e.pass) quiz.passes++; }
        break;
      case 'gate': {
        const g = gates[e.gate] || (gates[e.gate] = { allow: 0, deny: 0, denyRatio: null });
        if (e.decision === 'deny') g.deny++; else g.allow++;
        break;
      }
      case 'ship':
        if (e.phase === 'start') openStarts++;
        else if (e.phase === 'end' && openStarts > 0) {
          openStarts--;
          ship.completed++;
          if (e.ok) shipOk++;
          if (typeof e.durationMs === 'number') durations.push(e.durationMs);
        }
        break;
      case 'verdict':
        if (e.tool === 'plan-cert') { cert.total++; if (e.verdict === 'PASS') cert.pass++; }
        else if (e.tool === 'verify-change') { verify.total++; if (e.verdict === 'PASS_UNPROVEN') verify.passUnproven++; }
        break;
      default:
        other++; // unknown event / future schema — counted, never fatal
    }
  }

  ship.aborted = openStarts;
  ship.runs = ship.completed + ship.aborted;
  quiz.passRate = ratio(quiz.passes, quiz.attempts);
  for (const g of Object.values(gates)) g.denyRatio = ratio(g.deny, g.allow + g.deny);
  ship.okRate = ratio(shipOk, ship.completed);
  ship.medianDurationMs = median(durations);
  cert.passRate = ratio(cert.pass, cert.total);
  verify.unprovenRatio = ratio(verify.passUnproven, verify.total);

  return { quiz, gates, ship, cert, verify, other };
}

function runSummary() {
  const jsonOut = process.argv.includes('--json');
  const sinceRaw = arg('--since');
  const lastRaw = arg('--last');

  let since = null;
  if (sinceRaw !== null) {
    since = Date.parse(sinceRaw);
    if (Number.isNaN(since)) { console.error(`--since "${sinceRaw}" is not a parseable instant (use ISO 8601)`); process.exit(2); }
  }
  let last = null;
  if (lastRaw !== null) {
    last = parseInt(lastRaw, 10);
    if (!Number.isFinite(last) || last < 0) { console.error(`--last "${lastRaw}" is not a number`); process.exit(2); }
  }

  const { events: all, malformed } = loadEvents();
  let events = all;
  if (since !== null) events = events.filter((e) => Date.parse(e.ts) >= since);
  if (last !== null) events = events.slice(-last);

  const window = sinceRaw && lastRaw ? `since ${sinceRaw}, last ${last}`
    : sinceRaw ? `since ${sinceRaw}`
    : lastRaw ? `last ${last}`
    : 'all-time';

  const s = summarize(events);
  const out = {
    window: { since: sinceRaw, last },
    totalEvents: events.length,
    malformed,
    ...s,
  };

  if (jsonOut) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }

  const frac = (num, den, r) => (den > 0 ? `${num}/${den} (${pct(r)})` : 'n/a');
  console.log('=== novakai metrics — compliance over recorded runs ===');
  console.log(`window: ${window}\n`);
  console.log(`  quiz pass rate      : ${frac(s.quiz.passes, s.quiz.attempts, s.quiz.passRate)}`);
  console.log('  gate decisions      :');
  for (const [name, g] of Object.entries(s.gates)) {
    const line = g.allow + g.deny > 0 ? `${g.allow} allow · ${g.deny} deny (${pct(g.denyRatio)} deny)` : 'n/a';
    console.log(`      ${name.padEnd(15)} : ${line}`);
  }
  const shipLine = s.ship.runs > 0
    ? `${s.ship.runs} run(s) — ${s.ship.completed} completed (${pct(s.ship.okRate)} ok) · ${s.ship.aborted} aborted` +
      (s.ship.medianDurationMs !== null ? ` · median ${Math.round(s.ship.medianDurationMs / 100) / 10}s` : '')
    : 'n/a';
  console.log(`  ship runs           : ${shipLine}`);
  console.log(`  cert pass rate      : ${frac(s.cert.pass, s.cert.total, s.cert.passRate)}`);
  console.log(`  PASS_UNPROVEN ratio : ${frac(s.verify.passUnproven, s.verify.total, s.verify.unprovenRatio)}`);
  if (s.other) console.log(`  other events        : ${s.other} (unknown event kinds, counted not crashed)`);
  console.log(`\n  total events: ${events.length} · malformed skipped: ${malformed}`);
  printTurnDiscipline();
  process.exit(0);
}

/* M10: best-effort turn-discipline tail section. Shells to turns.mjs
   (never imports it) so a bug in the measuring tool can only degrade
   this one line to "n/a" — it must never change metrics.mjs's own exit
   code, the same fail-open contract every gate/reader in this file
   already follows. */
function printTurnDiscipline() {
  try {
    const r = spawnSync('node', [join(HERE, 'turns.mjs'), 'summary', '--json'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: ROOT },
    });
    const parsed = r.status === 0 ? JSON.parse(r.stdout) : null;
    if (parsed && !parsed.absent && parsed.sessions?.length) {
      console.log(`\n  turn discipline     : ${parsed.sessions.length} session(s) — median batch ratio ${parsed.medians.batchRatio.toFixed(2)}` +
        ` (target >=2.0) · median tokens-to-first-src-edit ${parsed.medians.tokensToFirstSrcEdit ?? 'n/a'}`);
      return;
    }
  } catch { /* best-effort only */ }
  console.log('\n  turn discipline: n/a (no transcripts)');
}

/* ---------------- wrap ---------------- */
function runWrap() {
  const event = arg('--event');
  const sep = process.argv.indexOf('--');
  const cmd = sep >= 0 ? process.argv.slice(sep + 1) : [];
  if (!event || !cmd.length) {
    console.error('usage: metrics.mjs wrap --event <name> -- <cmd ...>');
    process.exit(2);
  }

  recordEvent({ event, source: 'metrics.mjs', phase: 'start' });
  const t0 = Date.now();
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit', shell: false });
  recordEvent({
    event, source: 'metrics.mjs', phase: 'end',
    ok: r.status === 0 && !r.signal, durationMs: Date.now() - t0,
  });

  // Transparency: callers cannot tell the wrapper is there.
  if (r.signal) { process.kill(process.pid, r.signal); process.exit(1); }
  process.exit(r.status ?? 1);
}

if (CMD === 'summary') runSummary();
if (CMD === 'wrap') runWrap();
console.error('usage: metrics.mjs <summary|wrap> — summary [--json] [--since <ISO>] [--last <N>] | wrap --event <name> -- <cmd ...>');
process.exit(2);
