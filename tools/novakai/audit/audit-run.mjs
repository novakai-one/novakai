#!/usr/bin/env node
/* =====================================================================
   audit-run.mjs — forensic reconstruction of "what actually happened in a
   Claude Code session", from IMMUTABLE JSONL transcripts only.
   ---------------------------------------------------------------------
   Never trusts an agent's self-reported manifest/prose. Everything in this
   report is extracted from ~/.claude/projects/.../*.jsonl (root transcript +
   every subagent transcript, wherever it physically sits) plus the live
   repo package.json (for the "known tool" index). A --manifest is only ever
   used for a REPORT-ONLY reconciliation section — it never changes what is
   counted, and never changes the exit code.

   READ-ONLY under ~/.claude — this script never writes there.

   Usage:
     node audit-run.mjs --session <root-session-uuid> [--manifest <path>]
                         [--json] [--out <file>] [--html <file>] [--selftest]
     --html <file>  write a self-contained HTML report to <file>
   Exit: 0 = normal report (always — manifest mismatches never flip this);
         1 = --selftest assertion failure; 2 = bad invocation.
   ===================================================================== */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import readline from 'node:readline';
import assert from 'node:assert';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SESSION = arg('--session');
const MANIFEST = arg('--manifest');
const JSON_OUT = process.argv.includes('--json');
const OUT = arg('--out');
const HTML_OUT = arg('--html');
const SELFTEST = process.argv.includes('--selftest');
const LIST = process.argv.includes('--list');

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_REPO = join(HERE, '..', '..', '..');
const PROJECT_DIR = join(homedir(), '.claude', 'projects', '-Users-christopherdasca-Programming-novakai');

/* =====================================================================
   Transcript-tree extraction — shared by the real run and --selftest.
   ===================================================================== */

function listJsonlFiles(rootDir) {
  const out = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(entryPath);
    }
  }
  walk(rootDir);
  return out;
}

function readJsonlLines(file) {
  const lines = [];
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return lines;
  }
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    try {
      lines.push(JSON.parse(trimmed));
    } catch {
      /* skip unparseable line */
    }
  }
  return lines;
}

function keepMatchingSession(files, targetSession) {
  const kept = [];
  for (const file of files) {
    const lines = readJsonlLines(file);
    if (lines.some((line) => line && line.sessionId === targetSession)) kept.push({ file, lines });
  }
  return kept;
}

// Dedupe by .agentId (root bucket = lines with no agentId). Prefer the file
// whose own basename equals the target session uuid as root.
function dedupeByAgentId(kept, targetSession) {
  const byKey = new Map();
  for (const entry of kept) {
    const agentIdLine = entry.lines.find((line) => line && line.agentId);
    entry.agentId = agentIdLine ? agentIdLine.agentId : null;
    const key = entry.agentId || '__root__';
    if (!byKey.has(key)) {
      byKey.set(key, entry);
      continue;
    }
    if (key === '__root__' && basename(entry.file, '.jsonl') === targetSession) byKey.set(key, entry);
  }
  return byKey;
}

function foreignDirNotes(subagents, rootDir, targetSession) {
  const notes = [];
  for (const sub of subagents) {
    const rel = relative(rootDir, sub.file);
    const firstSeg = rel.split(sep)[0];
    if (firstSeg !== targetSession) {
      notes.push(`NOTE: ${basename(sub.file)} has sessionId=${targetSession} but lives under foreign dir ${firstSeg}/`);
    }
  }
  return notes;
}

// Sibling meta.json for each subagent (mutates sub.meta / sub.metaPath in place).
function attachSubagentMeta(subagents) {
  for (const sub of subagents) {
    const metaPath = sub.file.replace(/\.jsonl$/, '.meta.json');
    if (!existsSync(metaPath)) {
      sub.meta = null;
      sub.metaPath = null;
      continue;
    }
    sub.metaPath = metaPath;
    try {
      sub.meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      sub.meta = null;
    }
  }
}

// Discover every .jsonl transcript belonging to targetSession, grouped by
// IN-FILE .sessionId (never by directory name — a subagent can be filed
// under a foreign session's directory on resume/fork).
function discoverTranscripts(rootDir, targetSession) {
  const files = listJsonlFiles(rootDir);
  const byKey = dedupeByAgentId(keepMatchingSession(files, targetSession), targetSession);

  const root = byKey.get('__root__') || null;
  if (root) root.isRoot = true;
  const subagents = [...byKey.entries()].filter(([key]) => key !== '__root__').map(([, entry]) => entry);
  for (const sub of subagents) sub.isRoot = false;

  const notes = foreignDirNotes(subagents, rootDir, targetSession);
  attachSubagentMeta(subagents);

  return { root, subagents, notes };
}

/* =====================================================================
   Session browse/pick front-end — pure discovery + selection helpers in
   front of buildReport/renderMarkdown (which are UNCHANGED below).
   ===================================================================== */

// Enumerate TOP-LEVEL *.jsonl files only (non-recursive — root transcripts
// live at the top level of projectDir; subagent transcripts live in
// per-session subdirs and are deliberately not walked here).
function findFirstMatch(lines, predicate, pick) {
  for (const line of lines) {
    if (predicate(line)) return pick(line);
  }
  return null;
}

function extractPromptText(line) {
  if (!line || line.type !== 'user' || !line.message) return null;
  const content = line.message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = content.find((piece) => piece && piece.type === 'text' && typeof piece.text === 'string');
    if (block) return block.text;
  }
  return null;
}

function findFirstPrompt(lines) {
  for (const line of lines) {
    const text = extractPromptText(line);
    if (typeof text !== 'string') continue;
    if (/^</.test(text) || /^Caveat/.test(text) || /^command-/.test(text)) continue;
    return text;
  }
  return null;
}

function safeMtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

// A "root" session file: carries lines with its own sessionId and no agentId
// anywhere (agentId marks a subagent transcript).
function isRootSessionFile(lines, sessionId) {
  const hasSessionId = lines.some((line) => line && line.sessionId === sessionId);
  const hasAgentId = lines.some((line) => line && line.agentId);
  return hasSessionId && !hasAgentId;
}

function buildSessionRecord(file, sessionId, lines) {
  const hasTimestamp = (line) => line && typeof line.timestamp === 'string';
  const hasGitBranch = (line) => line && line.gitBranch;
  const hasAiTitle = (line) => line && line.type === 'ai-title' && line.aiTitle;
  return {
    sessionId,
    startTime: findFirstMatch(lines, hasTimestamp, (line) => line.timestamp),
    mtime: safeMtime(file),
    gitBranch: findFirstMatch(lines, hasGitBranch, (line) => line.gitBranch),
    aiTitle: findFirstMatch(lines, hasAiTitle, (line) => line.aiTitle),
    firstPrompt: findFirstPrompt(lines),
  };
}

function sessionRecordFor(entry, projectDir) {
  if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return null;
  const file = join(projectDir, entry.name);
  const sessionId = basename(entry.name, '.jsonl');
  const lines = readJsonlLines(file);
  if (!isRootSessionFile(lines, sessionId)) return null;
  return buildSessionRecord(file, sessionId, lines);
}

function listRootSessions(projectDir) {
  let entries;
  try {
    entries = readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sessions = [];
  for (const entry of entries) {
    const record = sessionRecordFor(entry, projectDir);
    if (record) sessions.push(record);
  }
  sessions.sort((first, second) => (second.mtime ?? 0) - (first.mtime ?? 0));
  return sessions;
}

function collapseWs(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sessionTitle(session) {
  const raw = session.aiTitle || session.firstPrompt || '(no title)';
  return collapseWs(raw);
}

function truncate(value, maxLen) {
  const str = String(value ?? '');
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
}

function renderSessionList(sessions) {
  if (!sessions.length) return '(no sessions found)';
  const rows = sessions.map((session, index) => {
    const num = String(index + 1);
    const date = session.mtime ? new Date(session.mtime).toISOString().slice(0, 10) : '?';
    const branch = truncate(collapseWs(session.gitBranch || ''), 20);
    const title = truncate(sessionTitle(session), 60);
    return { num, date, branch, title };
  });
  const out = [];
  out.push('  #  date        branch                title');
  out.push('  -  ----------  --------------------  -----');
  for (const row of rows) {
    out.push(`  ${row.num.padEnd(2)} ${row.date.padEnd(11)} ${row.branch.padEnd(21)} ${row.title}`);
  }
  return out.join('\n');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Resolve a user token (row number / uuid prefix / full uuid) to a full
// sessionId uuid, or throw a helpful Error. Precedence: in-range row index
// -> exact sessionId/uuid match -> unique prefix match.
function resolveSession(input, sessions) {
  const token = String(input ?? '').trim();
  if (/^\d+$/.test(token)) {
    const idx = Number(token) - 1;
    if (idx >= 0 && idx < sessions.length) return sessions[idx].sessionId;
    // out-of-range all-digit token falls through to prefix/exact match below.
  }
  const exact = sessions.find((session) => session.sessionId === token);
  if (exact) return exact.sessionId;
  if (UUID_RE.test(token)) return token; // valid-but-unlisted uuid: preserve today's behaviour.

  const candidates = sessions.filter((session) => session.sessionId.startsWith(token));
  if (candidates.length === 1) return candidates[0].sessionId;
  if (candidates.length === 0) throw new Error(`no session matches "${token}"`);
  const ids = candidates.map((candidate) => candidate.sessionId).join(', ');
  throw new Error(`ambiguous session "${token}" — matches: ${ids}`);
}

// The callback-side of pickSessionInteractive's prompt loop: validates one
// answer, resolves/exits on success or "q", else reports the error and
// re-prompts. `state.resolved` is shared with the 'close' handler below.
function promptOnce(reader, sessions, resolve, state) {
  reader.question(`Pick a session [1-${sessions.length}] (q to quit): `, (answer) => {
    const trimmed = answer.trim();
    if (!trimmed || trimmed.toLowerCase() === 'q') {
      reader.close();
      process.exit(0);
      return;
    }
    try {
      const uuid = resolveSession(trimmed, sessions);
      state.resolved = true;
      reader.close();
      resolve(uuid);
    } catch (err) {
      console.error(err.message);
      promptOnce(reader, sessions, resolve, state);
    }
  });
}

// Only reached when process.stdin.isTTY. Prints the list, prompts, resolves
// the answer via resolveSession (re-prompting on a bad token), and returns
// a Promise<uuid>.
function pickSessionInteractive(sessions) {
  if (!sessions.length) {
    console.log('(no sessions found)');
    process.exit(0);
  }
  console.log(renderSessionList(sessions));
  const reader = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    const state = { resolved: false };
    reader.on('close', () => {
      if (!state.resolved) process.exit(0);
    });
    promptOnce(reader, sessions, resolve, state);
  });
}

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function firstModel(lines) {
  for (const line of lines) {
    if (line && line.type === 'assistant' && line.message && line.message.model) return line.message.model;
  }
  return null;
}

function usageEntryOf(line) {
  if (!line || line.type !== 'assistant' || !line.message) return null;
  const { id, usage } = line.message;
  if (!id || !usage) return null;
  return { id, usage };
}

// Sum ONE .message.usage per distinct .message.id (usage repeats identically
// across streamed partial lines of the same message — dedupe or you inflate).
function tokensOf(lines) {
  const seen = new Map();
  for (const line of lines) {
    const entry = usageEntryOf(line);
    if (entry && !seen.has(entry.id)) seen.set(entry.id, entry.usage);
  }
  let input = 0, output = 0, cacheCreation = 0, cacheRead = 0;
  for (const usage of seen.values()) {
    input += usage.input_tokens || 0;
    output += usage.output_tokens || 0;
    cacheCreation += usage.cache_creation_input_tokens || 0;
    cacheRead += usage.cache_read_input_tokens || 0;
  }
  return { input, output, cacheCreation, cacheRead, bill: input + output + cacheCreation, messages: seen.size };
}

function toolUseBlocksOf(line) {
  if (!line || line.type !== 'assistant' || !line.message || !Array.isArray(line.message.content)) return [];
  return line.message.content.filter((block) => block && block.type === 'tool_use' && block.id);
}

// Distinct tool_use.id -> {name, input, timestamp} (a block can be echoed
// across streamed lines the same way usage is — dedupe by id).
function toolUsesOf(lines) {
  const map = new Map();
  for (const line of lines) {
    for (const block of toolUseBlocksOf(line)) {
      if (!map.has(block.id)) {
        map.set(block.id, {
          id: block.id, name: block.name, input: block.input || {}, timestamp: line.timestamp || null,
        });
      }
    }
  }
  return map;
}

function toolResultBlocksOf(line) {
  if (!line || line.type !== 'user' || !line.message || !Array.isArray(line.message.content)) return [];
  return line.message.content.filter((block) => block && block.type === 'tool_result' && block.tool_use_id);
}

// tool_use_id -> {is_error, stdout, timestamp}. is_error is true/false only
// for Bash; null/absent for every other tool — NEVER treat that as a pass.
function toolResultsOf(lines) {
  const map = new Map();
  for (const line of lines) {
    for (const block of toolResultBlocksOf(line)) {
      const isError = (block.is_error === true || block.is_error === false) ? block.is_error : null;
      const hasStdout = line.toolUseResult && typeof line.toolUseResult.stdout === 'string';
      const stdout = hasStdout ? line.toolUseResult.stdout : null;
      map.set(block.tool_use_id, { isError, stdout, timestamp: line.timestamp || null });
    }
  }
  return map;
}

function timelineEventsOf(lines) {
  return lines.filter((line) => line && typeof line.timestamp === 'string');
}

/* =====================================================================
   Known-tool index — read LIVE from package.json, never hardcoded.
   ===================================================================== */

function buildKnownTools(pkgJsonPath) {
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  const scripts = pkg.scripts || {};
  const scriptKeys = new Set();
  const mjsPaths = new Set();
  const mjsRe = /tools\/[\w./-]+\.mjs/g;
  for (const [key, value] of Object.entries(scripts)) {
    if (!key.startsWith('novakai:') && !key.startsWith('spec:')) continue;
    scriptKeys.add(key);
    for (const match of String(value).match(mjsRe) || []) mjsPaths.add(match);
  }
  return { scriptKeys, mjsPaths };
}

function matchKnownScript(sub, known) {
  const npmMatch = sub.match(/npm run ((?:novakai|spec):[\w:-]+)/);
  if (npmMatch && known.scriptKeys.has(npmMatch[1])) return npmMatch[1];
  for (const mjsPath of known.mjsPaths) {
    if (sub.includes(mjsPath)) return mjsPath;
  }
  return null;
}

// Split a Bash .input.command on &&, ;, |, newlines; for each sub-command,
// strip a trailing "-- --flag..." tail, then check for a known script/path.
function classifyBash(command, known) {
  const subs = String(command || '').split(/&&|;|\||\n/).map((piece) => piece.trim()).filter(Boolean);
  const hits = [];
  for (const rawSub of subs) {
    const sub = rawSub.replace(/\s+--\s+.*$/, '');
    const matched = matchKnownScript(sub, known);
    if (matched) hits.push({ sub: rawSub, matched });
  }
  return hits;
}

function mmdRefsOf(toolUses) {
  const refs = [];
  for (const [id, toolUse] of toolUses) {
    const isReadMmd = toolUse.name === 'Read' && typeof toolUse.input.file_path === 'string'
      && toolUse.input.file_path.endsWith('.mmd');
    if (isReadMmd) {
      refs.push({ toolUseId: id, tool: 'Read', path: toolUse.input.file_path });
    }
    if (toolUse.name === 'Bash' && typeof toolUse.input.command === 'string') {
      for (const match of toolUse.input.command.match(/[\w./-]+\.mmd/g) || []) {
        refs.push({ toolUseId: id, tool: 'Bash', path: match });
      }
    }
  }
  return refs;
}

function selfMutationFlagsOf(toolUses) {
  const flags = [];
  const writePattern = /node -e|sed -i|cat\s*>>?/;
  const targetPattern = /plan[^"'\s]*\.json|verdict|approved|m10-run\.json/;
  for (const [, toolUse] of toolUses) {
    if (toolUse.name !== 'Bash') continue;
    const cmd = String(toolUse.input.command || '');
    if (writePattern.test(cmd) && targetPattern.test(cmd)) {
      flags.push(cmd.length > 200 ? cmd.slice(0, 200) + '…' : cmd);
    }
  }
  return flags;
}

/* =====================================================================
   Agent wrapper: bundles a discovered transcript with its derived facts.
   ===================================================================== */

function wrapAgent(entry, label) {
  const tokens = tokensOf(entry.lines);
  const toolUses = toolUsesOf(entry.lines);
  const toolResults = toolResultsOf(entry.lines);
  return {
    label,
    file: entry.file,
    isRoot: entry.isRoot,
    agentId: entry.agentId || null,
    meta: entry.meta || null,
    model: firstModel(entry.lines),
    tokens,
    toolUses,
    toolResults,
    events: timelineEventsOf(entry.lines),
    mmdRefs: mmdRefsOf(toolUses),
  };
}

// Find, across ALL agents, the tool_use with name "Agent" whose id === toolUseId.
function findSpawner(agents, toolUseId) {
  for (const agent of agents) {
    for (const [id, toolUse] of agent.toolUses) {
      if (toolUse.name === 'Agent' && id === toolUseId) return agent;
    }
  }
  return null;
}

/* =====================================================================
   Report builder
   ===================================================================== */

// Wrap root + subagent transcripts into agents, resolve each subagent's
// parent (the Agent tool_use that spawned it), and compute spawn depth.
function resolveAgents(root, subagents) {
  const rootAgent = wrapAgent(root, 'lead');
  const subAgents = subagents
    .map((sub) => wrapAgent(sub, slugify((sub.meta && sub.meta.description) || sub.agentId)))
    .sort((first, second) => (first.meta?.spawnDepth ?? 1) - (second.meta?.spawnDepth ?? 1)); // by spawnDepth

  const allAgents = [rootAgent, ...subAgents];

  // Resolve parent for each subagent by matching meta.toolUseId to an Agent tool_use.
  for (const sub of subAgents) {
    const toolUseId = sub.meta && sub.meta.toolUseId;
    sub.parent = toolUseId ? findSpawner(allAgents, toolUseId) : null;
  }

  const depth = subAgents.length ? Math.max(...subAgents.map((sub) => sub.meta?.spawnDepth ?? 1)) : 0;
  const completeness = `${allAgents.length} transcripts found (1 root + ${allAgents.length - 1} `
    + `subagent(s)), spawn tree depth ${depth}`;

  return { rootAgent, subAgents, allAgents, depth, completeness };
}

function findGitBranch(allAgents) {
  for (const agent of allAgents) {
    const withBranch = agent.events.find((event) => event.gitBranch);
    if (withBranch) return withBranch.gitBranch;
  }
  return null;
}

// Time range + gitBranch across ALL discovered transcripts.
function computeTimeContext(allAgents) {
  const allTimestamps = allAgents.flatMap((agent) => agent.events.map((event) => event.timestamp));
  const timeRange = allTimestamps.length
    ? {
      min: allTimestamps.reduce((first, second) => (first < second ? first : second)),
      max: allTimestamps.reduce((first, second) => (first > second ? first : second)),
    }
    : { min: null, max: null };
  return { timeRange, gitBranch: findGitBranch(allAgents) };
}

// Unified timeline across all transcripts.
function buildTimeline(allAgents) {
  return allAgents
    .flatMap((agent) => agent.events.map((event) => ({ agent: agent.label, event })))
    .sort((first, second) => (first.event.timestamp < second.event.timestamp
      ? -1
      : first.event.timestamp > second.event.timestamp ? 1 : 0));
}

function recordToolRun(toolRuns, hit, opts) {
  if (!toolRuns.has(hit.matched)) toolRuns.set(hit.matched, []);
  toolRuns.get(hit.matched).push({
    agent: opts.agentLabel, toolUseId: opts.id, sub: hit.sub, isError: opts.result ? opts.result.isError : null,
  });
}

function collectToolRuns(allAgents, known) {
  const toolRuns = new Map(); // key -> [{agent, hits, blocks}]
  for (const agent of allAgents) {
    for (const [id, toolUse] of agent.toolUses) {
      if (toolUse.name !== 'Bash') continue;
      const hits = classifyBash(toolUse.input.command, known);
      if (!hits.length) continue;
      const result = agent.toolResults.get(id);
      for (const hit of hits) recordToolRun(toolRuns, hit, { agentLabel: agent.label, id, result });
    }
  }
  return toolRuns;
}

// Known-tool inventory: which novakai/buildspec scripts got directly invoked.
function buildToolInventory(allAgents) {
  const known = buildKnownTools(join(ROOT_REPO, 'package.json'));
  const toolRuns = collectToolRuns(allAgents, known);
  const invokedKeys = new Set(toolRuns.keys());
  const allKnown = [...known.scriptKeys, ...known.mjsPaths];
  const notInvoked = allKnown.filter((key) => !invokedKeys.has(key));
  return { known, toolRuns, notInvoked };
}

// .mmd routing proof.
function buildMmdRouting(allAgents) {
  return allAgents
    .map((agent) => ({ agent: agent.label, refs: agent.mmdRefs }))
    .filter((entry) => entry.refs.length);
}

function combineTokenRows(rows) {
  return rows.reduce((acc, row) => ({
    input: acc.input + row.input, output: acc.output + row.output,
    cacheCreation: acc.cacheCreation + row.cacheCreation, cacheRead: acc.cacheRead + row.cacheRead,
    bill: acc.bill + row.bill, messages: acc.messages + row.messages,
  }), { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, bill: 0, messages: 0 });
}

// Tokens table.
function buildTokensSummary(allAgents) {
  const tokensTable = allAgents.map((agent) => ({ agent: agent.label, ...agent.tokens }));
  const combined = combineTokenRows(tokensTable);
  const zeroOutputAgents = tokensTable
    .filter((row) => row.agent !== 'lead' && row.output === 0)
    .map((row) => row.agent);
  return { tokensTable, combined, zeroOutputAgents };
}

function countErrorResults(toolResults) {
  let trueCount = 0, falseCount = 0, naCount = 0;
  for (const [, result] of toolResults) {
    if (result.isError === true) trueCount++;
    else if (result.isError === false) falseCount++;
    else naCount++;
  }
  return { trueCount, falseCount, naCount };
}

// Pass/fail across ALL discovered transcripts.
function buildErrorSummary(allAgents) {
  let isErrorTrueTotal = 0, isErrorFalseTotal = 0, isErrorNA = 0;
  const isErrorByAgent = allAgents.map((agent) => {
    const { trueCount, falseCount, naCount } = countErrorResults(agent.toolResults);
    isErrorTrueTotal += trueCount;
    isErrorFalseTotal += falseCount;
    isErrorNA += naCount;
    return { agent: agent.label, true: trueCount, false: falseCount, 'na': naCount };
  });
  return { isErrorByAgent, isErrorTrueTotal, isErrorFalseTotal, isErrorNA };
}

function attemptsSumRow(manifestData, subAgentsCount) {
  const attemptsSum = (manifestData.spawns || []).reduce((acc, spawn) => acc + (spawn.attempts || 0), 0);
  return {
    check: 'spawns[].attempts sum vs subagent transcripts found',
    manifest: attemptsSum, actual: subAgentsCount,
    verdict: attemptsSum === subAgentsCount ? 'match' : 'MISMATCH',
  };
}

function spawnModelChecksOf(manifestData, subAgents) {
  const modelFamilies = ['opus', 'sonnet', 'haiku', 'fable'];
  void modelFamilies; // ponytail: pre-existing unused local, kept verbatim (not in this burndown's scope).
  return (manifestData.spawns || []).map((spawn) => {
    const short = String(spawn.model || '').toLowerCase();
    const anyAgentWithFamily = subAgents.some((agent) => (agent.model || '').toLowerCase().includes(short));
    return {
      role: spawn.role, model: spawn.model,
      verdict: anyAgentWithFamily ? 'match' : 'MISMATCH (no transcript model contains this family)',
    };
  });
}

function leadToolCallsRow(manifestData, rootAgent) {
  const mismatchNote = 'a small under-count vs the live transcript total is consistent with the manifest '
    + 'being written before the session\'s final tool calls were serialized (a post-serialization commit), '
    + 'not necessarily dishonest under-reporting';
  const matches = manifestData.leadToolCalls === rootAgent.toolUses.size;
  return {
    check: 'leadToolCalls',
    manifest: manifestData.leadToolCalls, actual: rootAgent.toolUses.size,
    verdict: matches ? 'match' : 'MISMATCH',
    note: matches ? null : mismatchNote,
  };
}

function leadSrcReadsRow(manifestData, rootAgent) {
  const leadSrcReads = [...rootAgent.toolUses.values()]
    .filter((toolUse) => toolUse.name === 'Read' && typeof toolUse.input.file_path === 'string'
      && toolUse.input.file_path.startsWith('src/')).length;
  return {
    check: 'leadSrcReads',
    manifest: manifestData.leadSrcReads, actual: leadSrcReads,
    verdict: manifestData.leadSrcReads === leadSrcReads ? 'match' : 'MISMATCH',
  };
}

function stageRowsOf(manifestData, allAgents) {
  const allCommands = allAgents.flatMap((agent) => [...agent.toolUses.values()]
    .filter((toolUse) => toolUse.name === 'Bash').map((toolUse) => toolUse.input.command || ''));
  return (manifestData.stages || []).map((stage) => {
    const cmdPrefix = String(stage.cmd || '').split(/\s+--\s+/)[0].trim();
    const present = allCommands.some((cmd) => cmd.includes(cmdPrefix) || cmd.includes(stage.cmd));
    return {
      stage: stage.stage, cmd: stage.cmd, claimedExit: stage.exit,
      verdict: present ? 'match (command present)' : 'MISMATCH (command not found in any Bash tool_use)',
      note: 'claimed exit is NOT independently verifiable against is_error at this granularity (a chained/looped '
        + 'stage does not map 1:1 to a single Bash invocation) — presence-of-command only',
    };
  });
}

// Manifest reconciliation (report-only — never affects exit code or counted totals).
function buildManifestReconciliation(manifestPath, subAgents, rootAgent, allAgents) {
  if (!manifestPath) return null;
  const manifestData = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rows = [
    attemptsSumRow(manifestData, subAgents.length),
    leadToolCallsRow(manifestData, rootAgent),
    leadSrcReadsRow(manifestData, rootAgent),
  ];
  const spawnModelChecks = spawnModelChecksOf(manifestData, subAgents);
  const stageRows = stageRowsOf(manifestData, allAgents);
  return { path: manifestPath, rows, spawnModelChecks, stageRows };
}

function buildReport(targetSession, manifestPath) {
  const { root, subagents, notes } = discoverTranscripts(PROJECT_DIR, targetSession);
  if (!root) throw new Error(`no root transcript found for session ${targetSession} under ${PROJECT_DIR}`);

  const { rootAgent, subAgents, allAgents, depth, completeness } = resolveAgents(root, subagents);
  const { timeRange, gitBranch } = computeTimeContext(allAgents);
  const timeline = buildTimeline(allAgents);
  const { known, toolRuns, notInvoked } = buildToolInventory(allAgents);
  const mmdRouting = buildMmdRouting(allAgents);
  const { tokensTable, combined, zeroOutputAgents } = buildTokensSummary(allAgents);
  const { isErrorByAgent, isErrorTrueTotal, isErrorFalseTotal, isErrorNA } = buildErrorSummary(allAgents);
  const selfMutation = selfMutationFlagsOf(rootAgent.toolUses);
  const manifest = buildManifestReconciliation(manifestPath, subAgents, rootAgent, allAgents);

  return {
    session: targetSession, gitBranch, timeRange, rootModel: rootAgent.model, completeness, notes, depth,
    rootAgent, subAgents, allAgents, timeline,
    known: { scriptKeys: [...known.scriptKeys], mjsPaths: [...known.mjsPaths] },
    toolRuns: [...toolRuns.entries()], notInvoked, mmdRouting, tokensTable, combined, zeroOutputAgents,
    isErrorByAgent, isErrorTrueTotal, isErrorFalseTotal, isErrorNA, selfMutation, manifest,
  };
}

/* =====================================================================
   Markdown rendering
   ===================================================================== */

function fmtNum(tokenCount) {
  return tokenCount.toLocaleString('en-US');
}

const NONE_FOUND = '(none found)';
const SECTION_CLOSE = '</section>';
const TBODY_CLOSE = '</tbody></table>';

function agentSpawnNote(block, report) {
  const target = report.subAgents.find((sub) => sub.meta?.toolUseId === block.id);
  return target
    ? `spawned subagent → ${target.meta?.description} (${target.model})`
    : 'spawned subagent (Agent tool_use)';
}

function bashBlockNote(block, agent, report) {
  if (typeof block.input?.command === 'string' && /\.mmd/.test(block.input.command)) {
    return `Bash referencing .mmd → ${block.input.command.slice(0, 120)}`;
  }
  const owner = report.allAgents.find((candidate) => candidate.label === agent);
  const result = owner?.toolResults.get(block.id);
  if (result?.isError === true) {
    return `Bash block exit non-zero: ${String(block.input?.command || '').slice(0, 100)}`;
  }
  return null;
}

function toolUseNote(block, agent, report) {
  if (block.name === 'Agent') return agentSpawnNote(block, report);
  const isMmdRead = block.name === 'Read' && typeof block.input?.file_path === 'string'
    && block.input.file_path.endsWith('.mmd');
  if (isMmdRead) return `Read .mmd → ${block.input.file_path}`;
  if (block.name === 'Bash') return bashBlockNote(block, agent, report);
  return null;
}

// Per-timeline-row note text (spawn/read-.mmd/bash-.mmd/bash-exit-non-zero).
// Pure: only reads report.subAgents / report.allAgents / agent / event —
// never touches an `out` accumulator — so both renderMarkdown and renderHtml
// can share it.
function timelineNotes(agent, event, report) {
  const notesFor = [];
  if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
    for (const block of event.message.content) {
      if (block?.type !== 'tool_use') continue;
      const note = toolUseNote(block, agent, report);
      if (note) notesFor.push(note);
    }
  }
  return notesFor;
}

function renderRunHeaderMd(report) {
  const out = [];
  out.push(`# Audit run — session ${report.session}`);
  out.push('');
  out.push('## 1. Run header');
  out.push(`- sessionId: \`${report.session}\``);
  out.push(`- gitBranch: \`${report.gitBranch ?? NONE_FOUND}\``);
  out.push(`- time range: ${report.timeRange.min ?? '?'} → ${report.timeRange.max ?? '?'}`);
  out.push(`- root model: \`${report.rootModel ?? NONE_FOUND}\``);
  out.push(`- ${report.completeness}`);
  for (const note of report.notes) out.push(`- ${note}`);
  out.push('');
  return out;
}

function renderSpawnTreeMd(report) {
  const out = [];
  out.push('## 2. Subagent roster + spawn tree');
  out.push('');
  out.push('- lead (root, depth 0)');
  for (const sub of report.subAgents) {
    const parentLabel = sub.parent ? sub.parent.label : '(unresolved)';
    out.push(`  - **${sub.label}** — agentType: ${sub.meta?.agentType ?? '?'}, description: `
      + `"${sub.meta?.description ?? '?'}", model: \`${sub.model ?? '?'}\`, `
      + `spawnDepth: ${sub.meta?.spawnDepth ?? '?'}, parent: ${parentLabel}`);
  }
  out.push('');
  return out;
}

function renderTimelineMd(report) {
  const out = [];
  out.push('## 3. Unified timeline (event lines with a `.timestamp`, all transcripts interleaved)');
  out.push('');
  out.push('| timestamp | agent | note |');
  out.push('|---|---|---|');
  for (const { agent, event } of report.timeline) {
    const notesFor = timelineNotes(agent, event, report);
    if (notesFor.length) out.push(`| ${event.timestamp} | ${agent} | ${notesFor.join('; ')} |`);
  }
  out.push('');
  return out;
}

function toolRunMdRow(key, runs) {
  const agentsList = [...new Set(runs.map((run) => run.agent))].join(', ');
  const verdicts = runs
    .map((run) => (run.isError === true ? 'FAIL' : run.isError === false ? 'pass' : 'n/a'))
    .join(', ');
  return `| \`${key}\` | ${runs.length} | ${agentsList} | ${verdicts} |`;
}

function renderToolsUsedMd(report) {
  const out = [];
  out.push('## 4. Novakai/buildspec tools used');
  out.push('');
  out.push('| known key/path | invocations | agents | block pass/fail |');
  out.push('|---|---|---|---|');
  for (const [key, runs] of report.toolRuns) out.push(toolRunMdRow(key, runs));
  out.push('');
  out.push('Not directly invoked (may still run transitively — this only proves DIRECT invocation):');
  for (const key of report.notInvoked) out.push(`- \`${key}\``);
  out.push('');
  return out;
}

function renderMmdRoutingMd(report) {
  const out = [];
  out.push('## 5. .mmd routing proof');
  out.push('');
  for (const { agent, refs } of report.mmdRouting) {
    for (const ref of refs) out.push(`- **${agent}** — ${ref.tool} → \`${ref.path}\``);
  }
  if (!report.mmdRouting.length) out.push('(no agent Read or Bash-referenced a .mmd path)');
  out.push('');
  return out;
}

function renderTokensMd(report) {
  const out = [];
  out.push('## 6. Tokens table (deduped by message.id; bill = input + output + cache_creation)');
  out.push('');
  out.push('| agent | input | output | cache_creation | cache_read | bill |');
  out.push('|---|---|---|---|---|---|');
  for (const row of report.tokensTable) {
    out.push(`| ${row.agent} | ${fmtNum(row.input)} | ${fmtNum(row.output)} | ${fmtNum(row.cacheCreation)} `
      + `| ${fmtNum(row.cacheRead)} | ${fmtNum(row.bill)} |`);
  }
  out.push(`| **combined** | ${fmtNum(report.combined.input)} | ${fmtNum(report.combined.output)} `
    + `| ${fmtNum(report.combined.cacheCreation)} | ${fmtNum(report.combined.cacheRead)} `
    + `| ${fmtNum(report.combined.bill)} |`);
  if (report.zeroOutputAgents.length) {
    out.push(`\nSmell: zero output tokens for: ${report.zeroOutputAgents.join(', ')} `
      + `(spawned but did no real generation).`);
  }
  out.push('');
  return out;
}

function manifestMdRow(row) {
  const note = row.note ? ` (${row.note})` : '';
  return `| ${row.check} | ${JSON.stringify(row.manifest)} | ${JSON.stringify(row.actual)} | ${row.verdict}${note} |`;
}

function stageMdLine(stageRow) {
  return `- **${stageRow.stage}**: ${stageRow.verdict} — \`${stageRow.cmd}\` `
    + `(claimed exit ${stageRow.claimedExit})`;
}

function spawnModelCheckMdLine(check) {
  return `- ${check.role}: manifest says \`${check.model}\` → ${check.verdict}`;
}

function renderManifestMd(report) {
  if (!report.manifest) return [];
  const rows = report.manifest.rows.map(manifestMdRow);
  const checks = report.manifest.spawnModelChecks.map(spawnModelCheckMdLine);
  const stages = report.manifest.stageRows.map(stageMdLine);
  return [
    '## 7. Manifest reconciliation (REPORT-ONLY — never affects exit code)', '',
    `manifest: \`${report.manifest.path}\``, '',
    '| check | manifest | actual | verdict |', '|---|---|---|---|',
    ...rows, '',
    'spawns[] model-family normalization:', ...checks, '',
    'stages[] (presence-of-command only; claimed exit codes are NOT independently verifiable):', ...stages, '',
  ];
}

const PROOF_PRESENT_MD = [
  '- `is_error` — structured Bash pass/fail, paired to its tool_use by `tool_use_id`.',
  '- `usage` tokens — per-message.id, deduped; structured counters, not narrated.',
  '- `.message.model` per agent — read from the transcript itself, not meta.json.',
  '- `sessionId`/`agentId`/`spawnDepth` — the spawn-tree structure.',
  '- `.timestamp` — total event ordering across all transcripts.',
  '- tool_use ↔ tool_result pairing by id.',
  '- captured stdout in tool results (`toolUseResult.stdout`) — real output, not agent summary.',
  '- git commit hashes / ship-stamp content hashes referenced in the session exist as a class of '
    + 'signal (not deeply parsed here).',
];

const PROOF_GAP_MD = [
  '- no structured numeric process exit code anywhere — only the boolean `is_error`.',
  '- transcript integrity rests on the local filesystem only, not a cryptographic signature.',
  '- a mutable sidecar log (if present) is not proof of anything, just a log.',
];

function errorRowMdLine(row) {
  return `- ${row.agent}: true=${row.true}, false=${row.false}, n/a=${row.na}`;
}

function selfMutationMdLines(report) {
  const out = [];
  out.push(`Self-mutation flags (lead transcript Bash commands touching plan/verdict/approval artifacts `
    + `inline) — ${report.selfMutation.length} found:`);
  for (const flag of report.selfMutation) out.push(`- \`${flag}\``);
  if (!report.selfMutation.length) out.push('- none found');
  return out;
}

function errorTotalsMdLines(report) {
  const out = [];
  const leadTrue = report.isErrorByAgent.find((row) => row.agent === 'lead')?.true ?? 0;
  out.push(`Total \`is_error === true\` across ALL discovered transcripts: ${report.isErrorTrueTotal} `
    + `(0 in lead means: ${leadTrue})`);
  for (const row of report.isErrorByAgent) out.push(errorRowMdLine(row));
  return out;
}

function renderProofLedgerMd(report) {
  return [
    '## 8. Proof-signal ledger', '',
    'PRESENT:', ...PROOF_PRESENT_MD, '',
    'GAP:', ...PROOF_GAP_MD, '',
    ...selfMutationMdLines(report), '',
    ...errorTotalsMdLines(report), '',
  ];
}

function renderMarkdown(report) {
  return [
    ...renderRunHeaderMd(report),
    ...renderSpawnTreeMd(report),
    ...renderTimelineMd(report),
    ...renderToolsUsedMd(report),
    ...renderMmdRoutingMd(report),
    ...renderTokensMd(report),
    ...renderManifestMd(report),
    ...renderProofLedgerMd(report),
  ].join('\n');
}

/* =====================================================================
   HTML rendering — same `report` as renderMarkdown, full section parity, no JS.
   ponytail: no client JS (no sortable table) — the token table is a handful
   of rows read top-to-bottom; add sort only if a report ever grows large.
   ponytail: renders the live in-process `report`, so no slimming of the fat
   `--json` payload — do that only when an external JSON consumer appears.
   ===================================================================== */

function esc(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(value) {
  return typeof value === 'number' ? value.toLocaleString('en-US') : String(value ?? '');
}

function runHeaderHtmlLines(report) {
  return [
    `<li>sessionId: <code>${esc(report.session)}</code></li>`,
    `<li>gitBranch: <code>${esc(report.gitBranch ?? NONE_FOUND)}</code></li>`,
    `<li>time range: ${esc(report.timeRange.min ?? '?')} &rarr; ${esc(report.timeRange.max ?? '?')}</li>`,
    `<li>root model: <code>${esc(report.rootModel ?? NONE_FOUND)}</code></li>`,
    `<li>${esc(report.completeness)}</li>`,
    ...report.notes.map((note) => `<li>${esc(note)}</li>`),
  ];
}

function renderRunHeaderHtml(report) {
  return [
    '<section id="header">',
    `<h1>Audit run — session ${esc(report.session)}</h1>`,
    '<h2>1. Run header</h2>',
    '<ul>',
    ...runHeaderHtmlLines(report),
    '</ul>',
    SECTION_CLOSE,
  ];
}

function spawnNodeLine(agent) {
  return `<strong>${esc(agent.label)}</strong> — agentType: ${esc(agent.meta?.agentType ?? '?')}, `
    + `description: "${esc(agent.meta?.description ?? '?')}", model: <code>${esc(agent.model ?? '?')}</code>, `
    + `spawnDepth: ${esc(agent.meta?.spawnDepth ?? '?')}, tokens.bill: ${fmt(agent.tokens.bill)}`;
}

// Nested <ul>, orphan sweep for anything not reachable from rootAgent by
// identity-equal .parent pointers.
function renderSpawnChildren(node, subAgents, rendered) {
  const children = subAgents.filter((sub) => sub.parent === node);
  if (!children.length) return '';
  const items = children.map((child) => {
    rendered.add(child);
    return `<li>${spawnNodeLine(child)}${renderSpawnChildren(child, subAgents, rendered)}</li>`;
  });
  return `<ul>${items.join('')}</ul>`;
}

function renderSpawnTreeHtml(report) {
  const out = [];
  out.push('<section id="spawn-tree">');
  out.push('<h2>2. Subagent roster + spawn tree</h2>');
  const rendered = new Set([report.rootAgent]);
  const rootChildren = renderSpawnChildren(report.rootAgent, report.subAgents, rendered);
  out.push(`<ul><li>lead (root, depth 0)${rootChildren}</li></ul>`);
  const unlinked = report.subAgents.filter((sub) => !rendered.has(sub));
  if (unlinked.length) {
    out.push('<p>Unlinked (parent unresolved/unreachable):</p>');
    out.push(`<ul>${unlinked.map((sub) => `<li>${spawnNodeLine(sub)}</li>`).join('')}</ul>`);
  }
  out.push(SECTION_CLOSE);
  return out;
}

function timelineRowHtml(agent, event, report) {
  const notesFor = timelineNotes(agent, event, report);
  if (!notesFor.length) return null;
  const noteText = notesFor.join('; ');
  const badge = noteText.includes('exit non-zero') ? '<span class="fail-badge">&#10007;</span> ' : '';
  return `<tr><td>${esc(event.timestamp)}</td><td>${esc(agent)}</td><td>${badge}${esc(noteText)}</td></tr>`;
}

// Collapsible, rows only where timelineNotes is non-empty.
function renderTimelineHtml(report) {
  const out = [];
  out.push('<section id="timeline">');
  out.push('<h2>3. Unified timeline (event lines with a <code>.timestamp</code>, all transcripts interleaved)</h2>');
  out.push('<details open><summary>timeline</summary>');
  out.push('<table><thead><tr><th>timestamp</th><th>agent</th><th>note</th></tr></thead><tbody>');
  for (const { agent, event } of report.timeline) {
    const row = timelineRowHtml(agent, event, report);
    if (row) out.push(row);
  }
  out.push(TBODY_CLOSE);
  out.push('</details>');
  out.push(SECTION_CLOSE);
  return out;
}

function toolRunHtmlRow(key, runs) {
  const agentsList = [...new Set(runs.map((run) => run.agent))].join(', ');
  const verdicts = runs
    .map((run) => (run.isError === true ? 'FAIL' : run.isError === false ? 'pass' : 'n/a'))
    .join(', ');
  return `<tr><td><code>${esc(key)}</code></td><td>${runs.length}</td><td>${esc(agentsList)}</td>`
    + `<td>${esc(verdicts)}</td></tr>`;
}

// toolRuns is already [key, runs[]][].
function renderToolsUsedHtml(report) {
  const out = [];
  out.push('<section id="tools-used">');
  out.push('<h2>4. Novakai/buildspec tools used</h2>');
  out.push('<table><thead><tr><th>known key/path</th><th>invocations</th><th>agents</th>'
    + '<th>block pass/fail</th></tr></thead><tbody>');
  for (const [key, runs] of report.toolRuns) out.push(toolRunHtmlRow(key, runs));
  out.push(TBODY_CLOSE);
  out.push('<p>Not directly invoked (may still run transitively — this only proves DIRECT invocation):</p>');
  out.push(`<ul>${report.notInvoked.map((key) => `<li><code>${esc(key)}</code></li>`).join('')}</ul>`);
  out.push(SECTION_CLOSE);
  return out;
}

function renderMmdRoutingHtml(report) {
  const out = [];
  out.push('<section id="mmd-routing">');
  out.push('<h2>5. .mmd routing proof</h2>');
  if (report.mmdRouting.length) {
    const items = [];
    for (const { agent, refs } of report.mmdRouting) {
      for (const ref of refs) {
        items.push(`<li><strong>${esc(agent)}</strong> — ${esc(ref.tool)} &rarr; <code>${esc(ref.path)}</code></li>`);
      }
    }
    out.push(`<ul>${items.join('')}</ul>`);
  } else {
    out.push('<p>(no agent Read or Bash-referenced a .mmd path)</p>');
  }
  out.push(SECTION_CLOSE);
  return out;
}

function tokenRowHtml(row) {
  return `<tr><td>${esc(row.agent)}</td><td>${fmt(row.input)}</td><td>${fmt(row.output)}</td>`
    + `<td>${fmt(row.cacheCreation)}</td><td>${fmt(row.cacheRead)}</td><td>${fmt(row.bill)}</td></tr>`;
}

function combinedTokenRowHtml(combined) {
  return `<tr><td><strong>combined</strong></td><td>${fmt(combined.input)}</td><td>${fmt(combined.output)}</td>`
    + `<td>${fmt(combined.cacheCreation)}</td><td>${fmt(combined.cacheRead)}</td><td>${fmt(combined.bill)}</td></tr>`;
}

// Tokens table + zero-output smell line.
function renderTokensHtml(report) {
  const out = [];
  out.push('<section id="tokens">');
  out.push('<h2>6. Tokens table (deduped by message.id; bill = input + output + cache_creation)</h2>');
  out.push('<table><thead><tr><th>agent</th><th>input</th><th>output</th><th>cache_creation</th>'
    + '<th>cache_read</th><th>bill</th></tr></thead><tbody>');
  for (const row of report.tokensTable) out.push(tokenRowHtml(row));
  out.push(combinedTokenRowHtml(report.combined));
  out.push(TBODY_CLOSE);
  if (report.zeroOutputAgents.length) {
    out.push(`<p>Smell: zero output tokens for: ${esc(report.zeroOutputAgents.join(', '))} `
      + `(spawned but did no real generation).</p>`);
  }
  out.push(SECTION_CLOSE);
  return out;
}

function manifestRowHtml(row) {
  const noteHtml = row.note ? esc(` (${row.note})`) : '';
  return `<tr><td>${esc(row.check)}</td><td>${esc(JSON.stringify(row.manifest))}</td>`
    + `<td>${esc(JSON.stringify(row.actual))}</td><td>${esc(row.verdict)}${noteHtml}</td></tr>`;
}

function spawnCheckHtmlLine(check) {
  return `<li>${esc(check.role)}: manifest says <code>${esc(check.model)}</code> `
    + `&rarr; ${esc(check.verdict)}</li>`;
}

function stageHtmlLine(stageRow) {
  return `<li><strong>${esc(stageRow.stage)}</strong>: ${esc(stageRow.verdict)} — `
    + `<code>${esc(stageRow.cmd)}</code> (claimed exit ${esc(stageRow.claimedExit)})</li>`;
}

function manifestTableHtmlLines(report) {
  const out = [];
  out.push('<table><thead><tr><th>check</th><th>manifest</th><th>actual</th><th>verdict</th></tr></thead><tbody>');
  for (const row of report.manifest.rows) out.push(manifestRowHtml(row));
  out.push(TBODY_CLOSE);
  return out;
}

// Manifest reconciliation — only when present.
function renderManifestHtml(report) {
  if (!report.manifest) return [];
  const checksHtml = report.manifest.spawnModelChecks.map(spawnCheckHtmlLine).join('');
  const stagesHtml = report.manifest.stageRows.map(stageHtmlLine).join('');
  return [
    '<section id="manifest">',
    '<h2>7. Manifest reconciliation (REPORT-ONLY — never affects exit code)</h2>',
    `<p>manifest: <code>${esc(report.manifest.path)}</code></p>`,
    ...manifestTableHtmlLines(report),
    '<p>spawns[] model-family normalization:</p>',
    `<ul>${checksHtml}</ul>`,
    '<p>stages[] (presence-of-command only; claimed exit codes are NOT independently verifiable):</p>',
    `<ul>${stagesHtml}</ul>`,
    SECTION_CLOSE,
  ];
}

const PROOF_PRESENT_HTML = [
  '<li><code>is_error</code> — structured Bash pass/fail, paired to its tool_use by '
    + '<code>tool_use_id</code>.</li>',
  '<li><code>usage</code> tokens — per-message.id, deduped; structured counters, not narrated.</li>',
  '<li><code>.message.model</code> per agent — read from the transcript itself, not meta.json.</li>',
  '<li><code>sessionId</code>/<code>agentId</code>/<code>spawnDepth</code> — the spawn-tree structure.</li>',
  '<li><code>.timestamp</code> — total event ordering across all transcripts.</li>',
  '<li>tool_use &harr; tool_result pairing by id.</li>',
  '<li>captured stdout in tool results (<code>toolUseResult.stdout</code>) — real output, not agent '
    + 'summary.</li>',
  '<li>git commit hashes / ship-stamp content hashes referenced in the session exist as a class of '
    + 'signal (not deeply parsed here).</li>',
];

const PROOF_GAP_HTML = [
  '<li>no structured numeric process exit code anywhere — only the boolean <code>is_error</code>.</li>',
  '<li>transcript integrity rests on the local filesystem only, not a cryptographic signature.</li>',
  '<li>a mutable sidecar log (if present) is not proof of anything, just a log.</li>',
];

function selfMutationHtmlLines(report) {
  const out = [];
  out.push(`<p>Self-mutation flags (lead transcript Bash commands touching plan/verdict/approval artifacts `
    + `inline) — ${report.selfMutation.length} found:</p>`);
  out.push('<ul>');
  for (const flag of report.selfMutation) out.push(`<li><code>${esc(flag)}</code></li>`);
  if (!report.selfMutation.length) out.push('<li>none found</li>');
  out.push('</ul>');
  return out;
}

function errorTotalsHtmlLines(report) {
  const leadTrue = report.isErrorByAgent.find((row) => row.agent === 'lead')?.true ?? 0;
  const errRowsHtml = report.isErrorByAgent
    .map((row) => `<li>${esc(row.agent)}: true=${row.true}, false=${row.false}, n/a=${row.na}</li>`)
    .join('');
  return [
    `<p>Total <code>is_error === true</code> across ALL discovered transcripts: `
      + `${report.isErrorTrueTotal} (0 in lead means: ${leadTrue})</p>`,
    `<ul>${errRowsHtml}</ul>`,
  ];
}

// Static PRESENT/GAP bullets ported verbatim.
function renderProofLedgerHtml(report) {
  return [
    '<section id="proof-signal">',
    '<h2>8. Proof-signal ledger</h2>',
    '<p>PRESENT:</p>', '<ul>', ...PROOF_PRESENT_HTML, '</ul>',
    '<p>GAP:</p>', '<ul>', ...PROOF_GAP_HTML, '</ul>',
    ...selfMutationHtmlLines(report),
    ...errorTotalsHtmlLines(report),
    SECTION_CLOSE,
  ];
}

const HTML_STYLE = `
    :root { color-scheme: light dark; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
           margin: 2rem; line-height: 1.5; background: #fff; color: #111; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; margin-top: 2rem; border-bottom: 1px solid #ccc; padding-bottom: .25rem; }
    table { border-collapse: collapse; width: 100%; margin: .5rem 0 1rem; }
    th, td { border: 1px solid #ccc; padding: .35rem .5rem; text-align: left; vertical-align: top; font-size: .9rem; }
    th { background: #f0f0f0; }
    code { background: #f5f5f5; padding: 0 .25rem; border-radius: 3px; }
    .fail-badge { color: #fff; background: #c0392b; padding: 0 .35rem; border-radius: 3px; font-weight: bold; }
    section { margin-bottom: 1.5rem; }
    details > summary { cursor: pointer; font-weight: bold; margin-bottom: .5rem; }
    @media (prefers-color-scheme: dark) {
      body { background: #1a1a1a; color: #eee; }
      th, td { border-color: #444; }
      th { background: #2a2a2a; }
      code { background: #2a2a2a; }
      h2 { border-bottom-color: #444; }
    }
  `;

function htmlShell(session, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audit run — ${esc(session)}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function renderHtmlSections(report) {
  return [
    ...renderRunHeaderHtml(report),
    ...renderSpawnTreeHtml(report),
    ...renderTimelineHtml(report),
    ...renderToolsUsedHtml(report),
    ...renderMmdRoutingHtml(report),
    ...renderTokensHtml(report),
    ...renderManifestHtml(report),
    ...renderProofLedgerHtml(report),
  ];
}

function renderHtml(report) {
  return htmlShell(report.session, renderHtmlSections(report).join('\n'));
}

/* =====================================================================
   --selftest
   ===================================================================== */

function runToolUseAndErrorChecks(check, allEntries, root) {
  check('distinct tool_use.id count across fixture transcripts is 3 (tu_bash1, tu_read1, tu_agent1)', () => {
    const ids = new Set();
    for (const entry of allEntries) for (const id of toolUsesOf(entry.lines).keys()) ids.add(id);
    assert.strictEqual(ids.size, 3, `got ${ids.size}`);
  });

  check('is_error aggregation: 1 true, 0 false, 1 n/a (null never counted as pass)', () => {
    const results = toolResultsOf(root.lines);
    let trueCount = 0, falseCount = 0, naCount = 0;
    for (const [, result] of results) {
      if (result.isError === true) trueCount++;
      else if (result.isError === false) falseCount++;
      else naCount++;
    }
    assert.strictEqual(trueCount, 1, `true=${trueCount}`);
    assert.strictEqual(falseCount, 0, `false=${falseCount}`);
    assert.strictEqual(naCount, 1, `na=${naCount}`);
  });
}

function runTokenDedupAndForeignDirChecks(check, root, subagents) {
  check('deduped token sum for a repeated message.id equals ONE copy, not doubled', () => {
    const tok = tokensOf(root.lines);
    // msg_1(output 50) + msg_2(output 8) + msg_3(output 12) = 70; a dedup bug would double msg_1 -> 120.
    assert.strictEqual(tok.output, 70, `output=${tok.output}`);
  });

  check('foreign-dir subagent transcript IS included in the discovered set '
    + '(sessionId-grouping, not dir-grouping)', () => {
    assert.ok(subagents.some((sub) => sub.agentId === 'fx2'),
      'agent-fx2 (filed under foreign dir 22222222.../subagents/) missing from discovered set');
  });
}

function runFixtureDiscoveryChecks(check, fixtures, target) {
  const { root, subagents } = discoverTranscripts(fixtures, target);
  const allEntries = [root, ...subagents];
  runToolUseAndErrorChecks(check, allEntries, root);
  runTokenDedupAndForeignDirChecks(check, root, subagents);
  return { root, subagents };
}

function runResolveSessionBasicChecks(check, fakeSessions) {
  check('resolveSession: in-range row index resolves', () => {
    assert.strictEqual(resolveSession('1', fakeSessions), fakeSessions[0].sessionId);
  });

  check('resolveSession: unique prefix resolves', () => {
    assert.strictEqual(resolveSession('30568351', fakeSessions), fakeSessions[0].sessionId);
  });

  check('resolveSession: ambiguous prefix throws', () => {
    assert.throws(() => resolveSession('aabbcc', fakeSessions), /ambiguous/);
  });
}

function runResolveSessionEdgeChecks(check, fakeSessions) {
  check('resolveSession: unknown token throws', () => {
    assert.throws(() => resolveSession('zzzzzzzz', fakeSessions), /no session matches/);
  });

  check('resolveSession: out-of-range all-digit token that IS a valid id prefix resolves '
    + '(falls through, does not throw)', () => {
    assert.strictEqual(resolveSession('30568351', fakeSessions.slice()), fakeSessions[0].sessionId);
    // 99 is out of range (only 3 fake sessions) and matches no prefix -> must throw, not silently misresolve.
    assert.throws(() => resolveSession('99', fakeSessions), /no session matches/);
  });
}

function runResolveSessionChecks(check) {
  const FAKE_SESSIONS = [
    { sessionId: '30568351-aaaa-1111-2222-333344445555' },
    { sessionId: 'aabbccdd-0000-1111-2222-333344445566' },
    { sessionId: 'aabbccee-0000-1111-2222-333344445577' },
  ];
  runResolveSessionBasicChecks(check, FAKE_SESSIONS);
  runResolveSessionEdgeChecks(check, FAKE_SESSIONS);
}

function runListRootSessionsCheck(check, fixtures, target) {
  check('listRootSessions(__fixtures__): finds exactly the top-level root, title falls back to firstPrompt', () => {
    const sessions = listRootSessions(fixtures);
    assert.strictEqual(sessions.length, 1, `length=${sessions.length}`);
    assert.strictEqual(sessions[0].sessionId, target);
    assert.strictEqual(sessionTitle(sessions[0]), 'start');
  });
}

// A minimal-but-complete report stub for the two render-facing checks below.
function buildSelftestStub(target, agents) {
  return {
    session: target, gitBranch: null, timeRange: { min: null, max: null }, rootModel: agents.rootAgent.model,
    completeness: 'selftest', notes: [], depth: 1,
    rootAgent: agents.rootAgent, subAgents: agents.subAgents, allAgents: agents.allAgents, timeline: agents.timeline,
    known: { scriptKeys: [], mjsPaths: [] }, toolRuns: [], notInvoked: [], mmdRouting: [],
    tokensTable: [],
    combined: { agent: 'combined', input: 0, output: 0, cacheCreation: 0, cacheRead: 0, bill: 0, messages: 0 },
    zeroOutputAgents: [], isErrorByAgent: [], isErrorTrueTotal: 0, isErrorFalseTotal: 0, isErrorNA: 0,
    selfMutation: [], manifest: null,
  };
}

// Real Map-backed agents, for the two checks below.
function buildFixtureAgents(root, subagents) {
  const rootAgent = wrapAgent(root, 'lead');
  const subAgents = subagents.map((sub, index) => wrapAgent(sub, 'sub' + index));
  const allAgents = [rootAgent, ...subAgents];
  const timeline = allAgents
    .flatMap((agent) => agent.events.map((event) => ({ agent: agent.label, event })))
    .sort((first, second) => (first.event.timestamp < second.event.timestamp
      ? -1
      : first.event.timestamp > second.event.timestamp ? 1 : 0));
  return { rootAgent, subAgents, allAgents, timeline };
}

function runTimelineNotesCheck(check, rootAgent, rStub) {
  check('timelineNotes extracts the exit-non-zero note for the fixture Bash tool_use (exercises Map .get())', () => {
    const event = rootAgent.events.find((evt) => evt.type === 'assistant' && Array.isArray(evt.message?.content)
      && evt.message.content.some((block) => block?.type === 'tool_use' && block.name === 'Bash'
        && block.id === 'tu_bash1'));
    assert.ok(event, 'fixture assistant event carrying tu_bash1 not found');
    const notes = timelineNotes('lead', event, rStub);
    assert.ok(notes.includes('Bash block exit non-zero: false; true'), `got ${JSON.stringify(notes)}`);
  });
}

function runRenderHtmlSmokeCheck(check, rStub, target) {
  check('renderHtml(r) smoke test: contains the session id, a <table, and the fail badge', () => {
    const html = renderHtml(rStub);
    assert.ok(typeof html === 'string' && html.length > 0);
    assert.ok(html.includes(target), 'missing session id');
    assert.ok(html.includes('<table'), 'missing <table');
    assert.ok(html.includes('fail-badge'), 'missing fail-badge marker');
  });
}

function runRenderChecks(check, root, subagents, target) {
  const agents = buildFixtureAgents(root, subagents);
  const rStub = buildSelftestStub(target, agents);
  runTimelineNotesCheck(check, agents.rootAgent, rStub);
  runRenderHtmlSmokeCheck(check, rStub, target);
}

function runSelftest() {
  const FIXTURES = join(HERE, '__fixtures__');
  const TARGET = '11111111-1111-1111-1111-111111111111';
  let failures = 0;

  function check(name, testFn) {
    try {
      testFn();
      console.log(`PASS: ${name}`);
    } catch (err) {
      failures++;
      console.log(`FAIL: ${name} — ${err.message}`);
    }
  }

  const { root, subagents } = runFixtureDiscoveryChecks(check, FIXTURES, TARGET);
  runResolveSessionChecks(check);
  runListRootSessionsCheck(check, FIXTURES, TARGET);
  runRenderChecks(check, root, subagents, TARGET);

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/* =====================================================================
   main
   ===================================================================== */

const USAGE = 'usage: audit-run.mjs [--list] [--session <#|prefix|uuid>] [--manifest <path>] [--json] '
  + '[--out <file>] [--html <file>] [--selftest]\n'
  + '  --list                print a numbered table of recent sessions and exit (text-only, ignores --json)\n'
  + '  --session <#|prefix|uuid>  row number from --list, a unique sessionId prefix, or a full uuid\n'
  + '  --html <file>         write a self-contained HTML report to <file>\n'
  + '  (no --session, interactive terminal) prints the list and prompts for a pick\n'
  + '  run with --list to see sessions';

function writeHtmlReport(report) {
  writeFileSync(HTML_OUT, renderHtml(report));
  console.log('wrote ' + HTML_OUT);
}

function writeJsonReport(report) {
  const jsonBody = JSON.stringify(report, (key, value) => (value instanceof Map ? [...value.entries()] : value), 2);
  console.log(jsonBody);
  if (OUT) writeFileSync(OUT, jsonBody);
}

function writeMarkdownReport(report) {
  const markdown = renderMarkdown(report);
  console.log(markdown);
  if (OUT) writeFileSync(OUT, markdown);
}

function outputReport(report) {
  if (process.argv.includes('--html') && (!HTML_OUT || HTML_OUT.startsWith('--'))) {
    console.error('--html requires an output file path');
    process.exit(2);
  }
  if (HTML_OUT) {
    writeHtmlReport(report);
    return;
  }
  if (JSON_OUT) {
    writeJsonReport(report);
  } else {
    writeMarkdownReport(report);
  }
}

if (SELFTEST) {
  runSelftest();
} else if (LIST) {
  console.log(renderSessionList(listRootSessions(PROJECT_DIR)));
  process.exit(0);
} else if (SESSION) {
  let uuid;
  try {
    uuid = resolveSession(SESSION, listRootSessions(PROJECT_DIR));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  outputReport(buildReport(uuid, MANIFEST));
  process.exit(0);
} else if (process.stdin.isTTY) {
  const uuid = await pickSessionInteractive(listRootSessions(PROJECT_DIR));
  outputReport(buildReport(uuid, MANIFEST));
  process.exit(0);
} else {
  console.error(USAGE);
  process.exit(2);
}
