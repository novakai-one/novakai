/* =====================================================================
   audit-report.mjs — the report builder for audit-run.mjs: known-tool
   index (live from package.json), Bash classification, agent wrapping,
   buildReport, and the report-reading timeline-note helpers shared by
   both renderers.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverTranscripts, slugify, firstModel, tokensOf, toolUsesOf, toolResultsOf,
  timelineEventsOf, PROJECT_DIR,
} from './audit-transcripts.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT_REPO = join(HERE, '..', '..', '..');

export const NONE_FOUND = '(none found)';

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

export { wrapAgent, timelineNotes, buildReport };
