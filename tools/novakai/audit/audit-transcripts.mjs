/* =====================================================================
   audit-transcripts.mjs — transcript-tree discovery + extraction for
   audit-run.mjs: JSONL walking, session browse/pick, and the per-line
   extractors (tokens, tool uses/results, timeline events).
   READ-ONLY under ~/.claude — this module never writes there.
   ===================================================================== */

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import readline from 'node:readline';

export const PROJECT_DIR = join(homedir(), '.claude', 'projects', '-Users-christopherdasca-Programming-novakai');

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

export {
  discoverTranscripts, listRootSessions, renderSessionList, sessionTitle, resolveSession,
  pickSessionInteractive, slugify, firstModel, tokensOf, toolUsesOf, toolResultsOf,
  timelineEventsOf,
};
