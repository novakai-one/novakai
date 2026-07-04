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
   derived from the repo root (FLOWMAP_ROOT env seam, else the repo this
   file lives in — same resolution as metrics.mjs); --dir overrides it
   (the test seam, so the suite never touches the real transcript dir).

   Parsing: lib/transcript.mjs owns the dedupe-by-message.id rule shared
   with turn-gate.mjs (single parser, no drift). Per assistant API call,
   context tokens = cache_read_input_tokens + cache_creation_input_tokens
   + input_tokens (each defaulting 0) — this is what gets re-sent, cached
   or not, on every turn. subagentTokens sums every
   /subagent_tokens: (\d+)/ match anywhere in the raw lines (the Agent
   tool's result embeds the spawned subagent's token spend).

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
import { parseTranscript } from './lib/transcript.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.FLOWMAP_ROOT ? resolve(process.env.FLOWMAP_ROOT) : join(HERE, '..', '..');

function flatten(p) { return p.replace(/[/.]/g, '-'); }
function defaultTranscriptDir() { return join(homedir(), '.claude', 'projects', flatten(ROOT)); }

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
    meaning: 'context tokens spent before the first src/ edit — the onboarding-cost proxy; high = paying the re-read cost many times before any real work lands',
  },
  cacheReadTokens: {
    label: 'cache-read tokens',
    meaning: 'cache-read tokens per session — informational only, no pass/fail; ~99% of session tokens are cache reads, so this is near-total session volume',
  },
};

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const round2 = (n) => Math.round(n * 100) / 100;

/* ---------------- per-session metrics ---------------- */
function sessionMetrics(text, id) {
  const { calls, malformed } = parseTranscript(text);
  let toolCalls = 0, callsWithTools = 0, cacheReadTokens = 0, outputTokens = 0, mainThreadWrites = 0;
  let cumulative = 0, tokensToFirstSrcEdit = null;

  for (const call of calls) {
    const u = call.usage || {};
    const ctx = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    cacheReadTokens += u.cache_read_input_tokens || 0;
    outputTokens += u.output_tokens || 0;
    if (call.tools.length) callsWithTools++;
    toolCalls += call.tools.length;
    for (const t of call.tools) {
      if (t.name === 'Edit' || t.name === 'Write' || t.name === 'NotebookEdit') mainThreadWrites++;
    }
    if (tokensToFirstSrcEdit === null) {
      cumulative += ctx;
      const srcEdit = call.tools.some((t) =>
        (t.name === 'Edit' || t.name === 'Write') &&
        typeof t.input?.file_path === 'string' && t.input.file_path.includes('/src/'));
      if (srcEdit) tokensToFirstSrcEdit = cumulative;
    }
  }

  let subagentTokens = 0;
  for (const m of text.matchAll(/subagent_tokens: (\d+)/g)) subagentTokens += parseInt(m[1], 10);

  return {
    id,
    apiCalls: calls.length,
    toolCalls,
    callsWithTools,
    batchRatio: callsWithTools > 0 ? round2(toolCalls / callsWithTools) : 0,
    cacheReadTokens,
    outputTokens,
    subagentTokens,
    mainThreadWrites,
    tokensToFirstSrcEdit,
    malformed,
  };
}

function evaluateTargets(m) {
  const results = [
    {
      key: 'batchRatio', value: m.batchRatio, pass: m.batchRatio >= TARGETS.batchRatio.min,
      line: `batch ratio ${m.batchRatio.toFixed(2)} (target ${TARGETS.batchRatio.target}) — ${TARGETS.batchRatio.meaning}`,
    },
  ];
  if (m.tokensToFirstSrcEdit !== null) {
    results.push({
      key: 'tokensToFirstSrcEdit', value: m.tokensToFirstSrcEdit,
      pass: m.tokensToFirstSrcEdit < TARGETS.tokensToFirstSrcEdit.max,
      line: `tokens to first src/ edit ${m.tokensToFirstSrcEdit} (target ${TARGETS.tokensToFirstSrcEdit.target}) — ${TARGETS.tokensToFirstSrcEdit.meaning}`,
    });
  }
  return results;
}

/* ---------------- summary ---------------- */
function listTranscripts(dir) {
  if (!existsSync(dir)) return null;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => join(dir, e.name));
}

function runSummary() {
  const jsonOut = process.argv.includes('--json');
  const dir = arg('--dir') ? resolve(arg('--dir')) : defaultTranscriptDir();
  const files = listTranscripts(dir);

  if (!files || !files.length) {
    if (jsonOut) { console.log(JSON.stringify({ dir, sessions: [], medians: null, absent: true }, null, 2)); process.exit(0); }
    console.log('=== flowmap turns — turn-discipline metrics ===');
    console.log(`dir: ${dir}`);
    console.log('\nturn discipline: n/a (no session transcripts found)');
    process.exit(0);
  }

  const sessions = files.map((f) => sessionMetrics(readFileSync(f, 'utf8'), basename(f, '.jsonl')));
  const numeric = (key) => sessions.map((s) => s[key]);
  const numericNonNull = (key) => sessions.map((s) => s[key]).filter((v) => v !== null);
  const medians = {
    apiCalls: median(numeric('apiCalls')),
    toolCalls: median(numeric('toolCalls')),
    batchRatio: median(numeric('batchRatio')),
    cacheReadTokens: median(numeric('cacheReadTokens')),
    outputTokens: median(numeric('outputTokens')),
    subagentTokens: median(numeric('subagentTokens')),
    mainThreadWrites: median(numeric('mainThreadWrites')),
    tokensToFirstSrcEdit: median(numericNonNull('tokensToFirstSrcEdit')),
  };

  if (jsonOut) { console.log(JSON.stringify({ dir, sessions, medians, absent: false }, null, 2)); process.exit(0); }

  console.log('=== flowmap turns — turn-discipline metrics ===');
  console.log(`dir: ${dir} (${sessions.length} session(s))\n`);
  const cols = ['session', 'apiCalls', 'toolCalls', 'batchRatio', 'cacheRead', 'subagentTok', 'mainWrites', 'toFirstSrcEdit'];
  console.log('  ' + cols.map((c) => c.padEnd(14)).join(''));
  for (const s of sessions) {
    console.log('  ' + [
      s.id.slice(0, 8), s.apiCalls, s.toolCalls, s.batchRatio.toFixed(2), s.cacheReadTokens,
      s.subagentTokens, s.mainThreadWrites, s.tokensToFirstSrcEdit === null ? 'n/a' : s.tokensToFirstSrcEdit,
    ].map((v) => String(v).padEnd(14)).join(''));
  }
  console.log(`\n  medians: apiCalls=${medians.apiCalls} toolCalls=${medians.toolCalls} batchRatio=${medians.batchRatio.toFixed(2)} ` +
    `cacheRead=${medians.cacheReadTokens} subagentTokens=${medians.subagentTokens} mainThreadWrites=${medians.mainThreadWrites} ` +
    `tokensToFirstSrcEdit=${medians.tokensToFirstSrcEdit === null ? 'n/a' : medians.tokensToFirstSrcEdit}`);
  console.log();
  console.log(`  ${TARGETS.batchRatio.label} ${medians.batchRatio.toFixed(2)} (target ${TARGETS.batchRatio.target}) — ${TARGETS.batchRatio.meaning}`);
  if (medians.tokensToFirstSrcEdit !== null) {
    console.log(`  ${TARGETS.tokensToFirstSrcEdit.label} ${medians.tokensToFirstSrcEdit} (target ${TARGETS.tokensToFirstSrcEdit.target}) — ${TARGETS.tokensToFirstSrcEdit.meaning}`);
  }
  console.log(`  ${TARGETS.cacheReadTokens.label} ${medians.cacheReadTokens} (no target) — ${TARGETS.cacheReadTokens.meaning}`);
  process.exit(0);
}

/* ---------------- check ---------------- */
function runCheck() {
  const file = arg('--file');
  const jsonOut = process.argv.includes('--json');
  if (!file) { console.error('usage: turns.mjs check --file <transcript.jsonl> [--json]'); process.exit(2); }

  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch (e) { console.error(`cannot read transcript ${file}: ${e.message}`); process.exit(2); }

  const metrics = sessionMetrics(text, basename(file, '.jsonl'));
  const results = evaluateTargets(metrics);
  const pass = results.every((r) => r.pass);

  if (jsonOut) {
    console.log(JSON.stringify({ file, metrics, results, pass }, null, 2));
    process.exit(pass ? 0 : 1);
  }

  console.log(`=== flowmap turns check — ${file} ===`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.line}`);
  console.log(`  · ${TARGETS.cacheReadTokens.label} ${metrics.cacheReadTokens} (no target) — ${TARGETS.cacheReadTokens.meaning}`);
  if (!pass) console.log(`\nFAILED: ${results.filter((r) => !r.pass).map((r) => r.key).join(', ')}`);
  process.exit(pass ? 0 : 1);
}

const CMD = process.argv[2];
if (CMD === 'summary') runSummary();
if (CMD === 'check') runCheck();
console.error('usage: turns.mjs <summary|check> — summary [--json] [--dir <transcriptDir>] | check --file <transcript.jsonl> [--json]');
process.exit(2);
