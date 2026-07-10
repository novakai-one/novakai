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
function readLogFile() {
  try {
    return readFileSync(LOG, 'utf8');
  } catch (err) {
    console.error(`metrics log exists but is unreadable: ${err.message}`);
    process.exit(1);
  }
  return undefined;
}

function parseEventLines(raw) {
  const events = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformed++;
    }
  }
  return { events, malformed };
}

function loadEvents() {
  // Absent log = fresh clone / no activity yet: a valid, empty summary.
  if (!existsSync(LOG)) return { events: [], malformed: 0, absent: true };
  const raw = readLogFile();
  const { events, malformed } = parseEventLines(raw);
  return { events, malformed, absent: false };
}

const ratio = (num, den) => (den > 0 ? num / den : null);
const pct = (ratioValue) => (ratioValue === null ? 'n/a' : Math.round(ratioValue * 100) + '%');

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function tallyQuiz(quiz, event) {
  if (event.cmd !== 'check') return;
  quiz.attempts++;
  if (event.pass) quiz.passes++;
}

function tallyGate(gates, event) {
  const gate = gates[event.gate] || (gates[event.gate] = { allow: 0, deny: 0, denyRatio: null });
  if (event.decision === 'deny') gate.deny++;
  else gate.allow++;
}

function tallyShip(ship, tally, event) {
  if (event.phase === 'start') {
    tally.openStarts++;
    return;
  }
  if (event.phase === 'end' && tally.openStarts > 0) {
    tally.openStarts--;
    ship.completed++;
    if (event.ok) tally.shipOk++;
    if (typeof event.durationMs === 'number') tally.durations.push(event.durationMs);
  }
}

function tallyVerdict(cert, verify, event) {
  if (event.tool === 'plan-cert') {
    cert.total++;
    if (event.verdict === 'PASS') cert.pass++;
  } else if (event.tool === 'verify-change') {
    verify.total++;
    if (event.verdict === 'PASS_UNPROVEN') verify.passUnproven++;
  }
}

const TALLIERS = {
  quiz: (acc, event) => tallyQuiz(acc.quiz, event),
  gate: (acc, event) => tallyGate(acc.gates, event),
  ship: (acc, event) => tallyShip(acc.ship, acc.tally, event),
  verdict: (acc, event) => tallyVerdict(acc.cert, acc.verify, event),
};

function tallyEvent(event, acc) {
  const tallier = TALLIERS[event.event];
  if (tallier) tallier(acc, event);
  else acc.tally.other++; // unknown event / future schema — counted, never fatal
}

function finalizeTotals({ quiz, gates, ship, cert, verify, tally }) {
  ship.aborted = tally.openStarts;
  ship.runs = ship.completed + ship.aborted;
  quiz.passRate = ratio(quiz.passes, quiz.attempts);
  for (const gate of Object.values(gates)) gate.denyRatio = ratio(gate.deny, gate.allow + gate.deny);
  ship.okRate = ratio(tally.shipOk, ship.completed);
  ship.medianDurationMs = median(tally.durations);
  cert.passRate = ratio(cert.pass, cert.total);
  verify.unprovenRatio = ratio(verify.passUnproven, verify.total);
}

function summarize(events) {
  const quiz = { attempts: 0, passes: 0, passRate: null };
  const gates = {};
  for (const gateName of GATES) gates[gateName] = { allow: 0, deny: 0, denyRatio: null };
  const ship = { runs: 0, completed: 0, aborted: 0, okRate: null, medianDurationMs: null };
  const cert = { total: 0, pass: 0, passRate: null };
  const verify = { total: 0, passUnproven: 0, unprovenRatio: null };
  const tally = { other: 0, openStarts: 0, shipOk: 0, durations: [] };

  const acc = { quiz, gates, ship, cert, verify, tally };
  for (const event of events) tallyEvent(event, acc);
  finalizeTotals(acc);

  return { quiz, gates, ship, cert, verify, other: tally.other };
}

function parseSince(sinceRaw) {
  if (sinceRaw === null) return null;
  const since = Date.parse(sinceRaw);
  if (Number.isNaN(since)) {
    console.error(`--since "${sinceRaw}" is not a parseable instant (use ISO 8601)`);
    process.exit(2);
  }
  return since;
}

function parseLast(lastRaw) {
  if (lastRaw === null) return null;
  const last = parseInt(lastRaw, 10);
  if (!Number.isFinite(last) || last < 0) {
    console.error(`--last "${lastRaw}" is not a number`);
    process.exit(2);
  }
  return last;
}

function filterEvents(all, since, last) {
  let events = all;
  if (since !== null) events = events.filter((event) => Date.parse(event.ts) >= since);
  if (last !== null) events = events.slice(-last);
  return events;
}

function windowLabel(sinceRaw, lastRaw, last) {
  if (sinceRaw && lastRaw) return `since ${sinceRaw}, last ${last}`;
  if (sinceRaw) return `since ${sinceRaw}`;
  if (lastRaw) return `last ${last}`;
  return 'all-time';
}

function formatFraction(num, den, ratioValue) {
  return den > 0 ? `${num}/${den} (${pct(ratioValue)})` : 'n/a';
}

function shipSummaryLine(ship) {
  if (ship.runs === 0) return 'n/a';
  const durationPart = ship.medianDurationMs !== null
    ? ` · median ${Math.round(ship.medianDurationMs / 100) / 10}s`
    : '';
  return `${ship.runs} run(s) — ${ship.completed} completed (${pct(ship.okRate)} ok) · ` +
    `${ship.aborted} aborted${durationPart}`;
}

function printGateDecisions(gates) {
  console.log('  gate decisions      :');
  for (const [name, gate] of Object.entries(gates)) {
    const line = gate.allow + gate.deny > 0
      ? `${gate.allow} allow · ${gate.deny} deny (${pct(gate.denyRatio)} deny)`
      : 'n/a';
    console.log(`      ${name.padEnd(15)} : ${line}`);
  }
}

function printSummaryHuman(out, window) {
  console.log('=== novakai metrics — compliance over recorded runs ===');
  console.log(`window: ${window}\n`);
  console.log(`  quiz pass rate      : ${formatFraction(out.quiz.passes, out.quiz.attempts, out.quiz.passRate)}`);
  printGateDecisions(out.gates);
  console.log(`  ship runs           : ${shipSummaryLine(out.ship)}`);
  console.log(`  cert pass rate      : ${formatFraction(out.cert.pass, out.cert.total, out.cert.passRate)}`);
  console.log(
    `  PASS_UNPROVEN ratio : ${formatFraction(out.verify.passUnproven, out.verify.total, out.verify.unprovenRatio)}`,
  );
  if (out.other) console.log(`  other events        : ${out.other} (unknown event kinds, counted not crashed)`);
  console.log(`\n  total events: ${out.totalEvents} · malformed skipped: ${out.malformed}`);
  printTurnDiscipline();
}

function parseWindow() {
  const sinceRaw = arg('--since');
  const lastRaw = arg('--last');
  const since = parseSince(sinceRaw);
  const last = parseLast(lastRaw);
  return { sinceRaw, lastRaw, since, last };
}

function outputJson(out) {
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

function runSummary() {
  const jsonOut = process.argv.includes('--json');
  const { sinceRaw, lastRaw, since, last } = parseWindow();

  const { events: all, malformed } = loadEvents();
  const events = filterEvents(all, since, last);
  const window = windowLabel(sinceRaw, lastRaw, last);

  const summary = summarize(events);
  const out = { window: { since: sinceRaw, last }, totalEvents: events.length, malformed, ...summary };

  if (jsonOut) outputJson(out);

  printSummaryHuman(out, window);
  process.exit(0);
}

/* M10: best-effort turn-discipline tail section. Shells to turns.mjs
   (never imports it) so a bug in the measuring tool can only degrade
   this one line to "n/a" — it must never change metrics.mjs's own exit
   code, the same fail-open contract every gate/reader in this file
   already follows. */
function printTurnDiscipline() {
  try {
    const result = spawnSync('node', [join(HERE, 'turns.mjs'), 'summary', '--json'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: ROOT },
    });
    const parsed = result.status === 0 ? JSON.parse(result.stdout) : null;
    if (parsed && !parsed.absent && parsed.sessions?.length) {
      console.log(
        `\n  turn discipline     : ${parsed.sessions.length} session(s) — median batch ratio ` +
        `${parsed.medians.batchRatio.toFixed(2)} (target >=2.0) · median tokens-to-first-src-edit ` +
        `${parsed.medians.tokensToFirstSrcEdit ?? 'n/a'}`,
      );
      return;
    }
  } catch { /* best-effort only */ }
  console.log('\n  turn discipline: n/a (no transcripts)');
}

/* ---------------- wrap ---------------- */
function parseWrapArgs() {
  const event = arg('--event');
  const sep = process.argv.indexOf('--');
  const cmd = sep >= 0 ? process.argv.slice(sep + 1) : [];
  if (!event || !cmd.length) {
    console.error('usage: metrics.mjs wrap --event <name> -- <cmd ...>');
    process.exit(2);
  }
  return { event, cmd };
}

function finishWrap(event, child, startedAt) {
  recordEvent({
    event, source: 'metrics.mjs', phase: 'end',
    'ok': child.status === 0 && !child.signal, durationMs: Date.now() - startedAt,
  });

  // Transparency: callers cannot tell the wrapper is there.
  if (child.signal) {
    process.kill(process.pid, child.signal);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

function runWrap() {
  const { event, cmd } = parseWrapArgs();
  recordEvent({ event, source: 'metrics.mjs', phase: 'start' });
  const startedAt = Date.now();
  const child = spawnSync(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit', shell: false });
  finishWrap(event, child, startedAt);
}

if (CMD === 'summary') runSummary();
if (CMD === 'wrap') runWrap();
console.error(
  'usage: metrics.mjs <summary|wrap> — summary [--json] [--since <ISO>] [--last <N>] | ' +
  'wrap --event <name> -- <cmd ...>',
);
process.exit(2);
