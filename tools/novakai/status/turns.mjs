#!/usr/bin/env node
/* =====================================================================
   turns.mjs — M10: MEASURE turn-discipline metrics over Claude Code
   session transcripts.
   ---------------------------------------------------------------------
   Measured evidence (17 real sessions): agents run ~1.26 tool calls per
   API turn, and ~99% of session tokens are cache-reads re-sent every
   turn — a lone Read/Grep/Glob re-pays the full cached-context bill for
   one file's worth of new information. This tool turns that observation
   into numbers instead of an anecdote.

   Transcript source: Claude Code writes one JSONL per session under
   ~/.claude/projects/<flattened-repo-path>/, flattened = the absolute
   repo root with every "/" and "." replaced by "-". Default dir is
   derived from the repo root (NOVAKAI_ROOT env seam, else the repo this
   file lives in — same resolution as metrics.mjs); --dir overrides it
   (the test seam, so the suite never touches the real transcript dir).

   Parsing: lib/transcript.mjs owns the dedupe-by-message.id rule shared
   with turn-gate.mjs (single parser, no drift). Per assistant API call,
   context tokens = cache_read_input_tokens + cache_creation_input_tokens
   + input_tokens (each defaulting 0) — this is what gets re-sent, cached
   or not, on every turn. subagentTokens sums TWO formats found in the raw
   transcript text: the legacy colon form `subagent_tokens: N` (pre-2026-07
   transcripts — summed as-is, no id to dedupe on) and the XML
   task-notification form `<subagent_tokens>N</subagent_tokens>` the
   harness switched to (observed live 2026-07-04). The XML form sits inside
   a `<task-notification>...</task-notification>` block that also carries
   `<tool-use-id>toolu_...</tool-use-id>` — and the harness writes the SAME
   notification twice (once as an internal "enqueue" queue-operation
   record, once as the delivered user message), so summing every XML match
   verbatim double-counts each real spawn. Dedupe by that tool-use-id —
   last occurrence wins per id (a resumed agent can notify more than once
   with an updated cumulative total) — so exactly one number survives per
   real spawn.

   tokensToFirstSrcEdit is the onboarding-cost proxy: cumulative context
   tokens over assistant calls, in file order, up to and including the
   first Edit/Write whose file_path contains "/src/" — how much re-read
   cost is paid before any real work lands. null if the session never
   touches src/.

   Two subcommands:
     summary [--json] [--dir <transcriptDir>]
       Per-session table + medians across sessions, and self-describing
       target lines (every printed metric states what it means and its
       target). Absent/empty dir -> "n/a", exit 0 — the reader is never
       a gate, same contract and same reasoning as metrics.mjs summary.
     check --file <transcript.jsonl> [--json]
       Evaluates ONE transcript against TARGETS.

   Exit (summary): always 0 (never itself a gate).
   Exit (check): 0 = every evaluated target passes, 1 = a target failed
   (named in the output), 2 = usage error / unreadable file.
   ===================================================================== */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTranscript } from '../lib/transcript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.NOVAKAI_ROOT ? resolve(process.env.NOVAKAI_ROOT) : join(HERE, '..', '..', '..');

function flatten(path) {
  return path.replace(/[/.]/g, '-');
}
function defaultTranscriptDir() {
  return join(homedir(), '.claude', 'projects', flatten(ROOT));
}

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export const TARGETS = {
  batchRatio: {
    label: 'batch ratio', target: '>=2.0', min: 2.0,
    meaning: 'tool calls per tool-bearing turn; low = full context re-read per lone file read',
  },
  tokensToFirstSrcEdit: {
    label: 'tokens to first src/ edit', target: '<50000', max: 50000,
    meaning: 'context tokens spent before the first src/ edit — the onboarding-cost proxy; high = paying the ' +
      're-read cost many times before any real work lands',
  },
  cacheReadTokens: {
    label: 'cache-read tokens',
    meaning: 'cache-read tokens per session — informational only, no pass/fail; ~99% of session tokens are cache ' +
      'reads, so this is near-total session volume',
  },
};

function median(nums) {
  if (!nums.length) return null;
  const sorted = [...nums].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
const round2 = (num) => Math.round(num * 100) / 100;

/* ---------------- per-session metrics ---------------- */
function callContextTokens(usage) {
  return (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.input_tokens || 0);
}

function isSrcEdit(tool) {
  return (tool.name === 'Edit' || tool.name === 'Write') &&
    typeof tool.input?.file_path === 'string' && tool.input.file_path.includes('/src/');
}

function countMainThreadWrites(tools) {
  let count = 0;
  for (const tool of tools) {
    if (tool.name === 'Edit' || tool.name === 'Write' || tool.name === 'NotebookEdit') count++;
  }
  return count;
}

function tallyOneCall(totals, call, cumulative) {
  const usage = call.usage || {};
  totals.cacheReadTokens += usage.cache_read_input_tokens || 0;
  totals.outputTokens += usage.output_tokens || 0;
  if (call.tools.length) totals.callsWithTools++;
  totals.toolCalls += call.tools.length;
  totals.mainThreadWrites += countMainThreadWrites(call.tools);
  if (totals.tokensToFirstSrcEdit !== null) return cumulative;
  const nextCumulative = cumulative + callContextTokens(usage);
  if (call.tools.some(isSrcEdit)) totals.tokensToFirstSrcEdit = nextCumulative;
  return nextCumulative;
}

function tallyCallMetrics(calls) {
  const totals = {
    toolCalls: 0, callsWithTools: 0, cacheReadTokens: 0, outputTokens: 0,
    mainThreadWrites: 0, tokensToFirstSrcEdit: null,
  };
  let cumulative = 0;
  for (const call of calls) cumulative = tallyOneCall(totals, call, cumulative);
  return totals;
}

function countLegacySubagentTokens(text) {
  let total = 0;
  for (const match of text.matchAll(/subagent_tokens: (\d+)/g)) total += parseInt(match[1], 10);
  return total;
}

function countXmlSubagentTokens(text) {
  const byToolUseId = new Map();
  for (const match of text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
    const idMatch = match[0].match(/<tool-use-id>([^<]+)<\/tool-use-id>/);
    const tokenMatch = match[0].match(/<subagent_tokens>(\d+)<\/subagent_tokens>/);
    if (idMatch && tokenMatch) byToolUseId.set(idMatch[1], parseInt(tokenMatch[1], 10));
  }
  let total = 0;
  for (const tokens of byToolUseId.values()) total += tokens;
  return total;
}

function countSubagentTokens(text) {
  return countLegacySubagentTokens(text) + countXmlSubagentTokens(text);
}

function sessionMetrics(text, id) {
  const { calls, malformed } = parseTranscript(text);
  const totals = tallyCallMetrics(calls);
  const subagentTokens = countSubagentTokens(text);

  return {
    id,
    apiCalls: calls.length,
    toolCalls: totals.toolCalls,
    callsWithTools: totals.callsWithTools,
    batchRatio: totals.callsWithTools > 0 ? round2(totals.toolCalls / totals.callsWithTools) : 0,
    cacheReadTokens: totals.cacheReadTokens,
    outputTokens: totals.outputTokens,
    subagentTokens,
    mainThreadWrites: totals.mainThreadWrites,
    tokensToFirstSrcEdit: totals.tokensToFirstSrcEdit,
    malformed,
  };
}

function evaluateTargets(metrics) {
  const results = [
    {
      key: 'batchRatio', value: metrics.batchRatio, pass: metrics.batchRatio >= TARGETS.batchRatio.min,
      line: `batch ratio ${metrics.batchRatio.toFixed(2)} (target ${TARGETS.batchRatio.target}) — ` +
        `${TARGETS.batchRatio.meaning}`,
    },
  ];
  if (metrics.tokensToFirstSrcEdit !== null) {
    results.push({
      key: 'tokensToFirstSrcEdit', value: metrics.tokensToFirstSrcEdit,
      pass: metrics.tokensToFirstSrcEdit < TARGETS.tokensToFirstSrcEdit.max,
      line: `tokens to first src/ edit ${metrics.tokensToFirstSrcEdit} ` +
        `(target ${TARGETS.tokensToFirstSrcEdit.target}) — ${TARGETS.tokensToFirstSrcEdit.meaning}`,
    });
  }
  return results;
}

/* ---------------- summary ---------------- */
function listTranscripts(dir) {
  if (!existsSync(dir)) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(dir, e.name));
}

function loadSessions(dir) {
  const files = listTranscripts(dir);
  if (!files || !files.length) return null;
  return files.map((file) => sessionMetrics(readFileSync(file, 'utf8'), basename(file, '.jsonl')));
}

function computeMedians(sessions) {
  const numeric = (key) => sessions.map((session) => session[key]);
  const numericNonNull = (key) => sessions.map((session) => session[key]).filter((value) => value !== null);
  return {
    apiCalls: median(numeric('apiCalls')),
    toolCalls: median(numeric('toolCalls')),
    batchRatio: median(numeric('batchRatio')),
    cacheReadTokens: median(numeric('cacheReadTokens')),
    outputTokens: median(numeric('outputTokens')),
    subagentTokens: median(numeric('subagentTokens')),
    mainThreadWrites: median(numeric('mainThreadWrites')),
    tokensToFirstSrcEdit: median(numericNonNull('tokensToFirstSrcEdit')),
  };
}

function printAbsentSummary(dir) {
  console.log('=== novakai turns — turn-discipline metrics ===');
  console.log(`dir: ${dir}`);
  console.log('\nturn discipline: n/a (no session transcripts found)');
}

function printSessionTable(sessions) {
  const cols = [
    'session', 'apiCalls', 'toolCalls', 'batchRatio', 'cacheRead', 'subagentTok', 'mainWrites', 'toFirstSrcEdit',
  ];
  console.log('  ' + cols.map((col) => col.padEnd(14)).join(''));
  for (const session of sessions) {
    console.log('  ' + [
      session.id.slice(0, 8), session.apiCalls, session.toolCalls, session.batchRatio.toFixed(2),
      session.cacheReadTokens, session.subagentTokens, session.mainThreadWrites,
      session.tokensToFirstSrcEdit === null ? 'n/a' : session.tokensToFirstSrcEdit,
    ].map((value) => String(value).padEnd(14)).join(''));
  }
}

function printMediansLine(medians) {
  const toFirstSrcEdit = medians.tokensToFirstSrcEdit === null ? 'n/a' : medians.tokensToFirstSrcEdit;
  console.log(
    `\n  medians: apiCalls=${medians.apiCalls} toolCalls=${medians.toolCalls} ` +
    `batchRatio=${medians.batchRatio.toFixed(2)} cacheRead=${medians.cacheReadTokens} ` +
    `subagentTokens=${medians.subagentTokens} mainThreadWrites=${medians.mainThreadWrites} ` +
    `tokensToFirstSrcEdit=${toFirstSrcEdit}`,
  );
}

function printTargetLines(medians) {
  console.log();
  console.log(
    `  ${TARGETS.batchRatio.label} ${medians.batchRatio.toFixed(2)} (target ${TARGETS.batchRatio.target}) — ` +
    `${TARGETS.batchRatio.meaning}`,
  );
  if (medians.tokensToFirstSrcEdit !== null) {
    console.log(
      `  ${TARGETS.tokensToFirstSrcEdit.label} ${medians.tokensToFirstSrcEdit} ` +
      `(target ${TARGETS.tokensToFirstSrcEdit.target}) — ${TARGETS.tokensToFirstSrcEdit.meaning}`,
    );
  }
  console.log(
    `  ${TARGETS.cacheReadTokens.label} ${medians.cacheReadTokens} (no target) — ${TARGETS.cacheReadTokens.meaning}`,
  );
}

function outputJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

function printSummaryTable(dir, sessions, medians) {
  console.log('=== novakai turns — turn-discipline metrics ===');
  console.log(`dir: ${dir} (${sessions.length} session(s))\n`);
  printSessionTable(sessions);
  printMediansLine(medians);
  printTargetLines(medians);
}

function runSummary() {
  const jsonOut = process.argv.includes('--json');
  const dir = arg('--dir') ? resolve(arg('--dir')) : defaultTranscriptDir();
  const sessions = loadSessions(dir);

  if (!sessions) {
    if (jsonOut) outputJson({ dir, sessions: [], medians: null, absent: true });
    printAbsentSummary(dir);
    process.exit(0);
  }

  const medians = computeMedians(sessions);
  if (jsonOut) outputJson({ dir, sessions, medians, absent: false });

  printSummaryTable(dir, sessions, medians);
  process.exit(0);
}

/* ---------------- check ---------------- */
function readTranscriptFile(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (err) {
    console.error(`cannot read transcript ${file}: ${err.message}`);
    process.exit(2);
  }
  return undefined;
}

function printCheckHuman(file, metrics, results, pass) {
  console.log(`=== novakai turns check — ${file} ===`);
  for (const result of results) console.log(`  ${result.pass ? '✓' : '✗'} ${result.line}`);
  console.log(
    `  · ${TARGETS.cacheReadTokens.label} ${metrics.cacheReadTokens} (no target) — ${TARGETS.cacheReadTokens.meaning}`,
  );
  if (!pass) {
    console.log(`\nFAILED: ${results.filter((result) => !result.pass).map((result) => result.key).join(', ')}`);
  }
}

function outputCheckJson(file, metrics, results, pass) {
  console.log(JSON.stringify({ file, metrics, results, pass }, null, 2));
  process.exit(pass ? 0 : 1);
}

function runCheck() {
  const file = arg('--file');
  const jsonOut = process.argv.includes('--json');
  if (!file) {
    console.error('usage: turns.mjs check --file <transcript.jsonl> [--json]');
    process.exit(2);
  }

  const text = readTranscriptFile(file);
  const metrics = sessionMetrics(text, basename(file, '.jsonl'));
  const results = evaluateTargets(metrics);
  const pass = results.every((result) => result.pass);

  if (jsonOut) outputCheckJson(file, metrics, results, pass);

  printCheckHuman(file, metrics, results, pass);
  process.exit(pass ? 0 : 1);
}

const CMD = process.argv[2];
if (CMD === 'summary') runSummary();
if (CMD === 'check') runCheck();
console.error(
  'usage: turns.mjs <summary|check> — summary [--json] [--dir <transcriptDir>] | ' +
  'check --file <transcript.jsonl> [--json]',
);
process.exit(2);
