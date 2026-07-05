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
                         [--json] [--out <file>] [--selftest]
   Exit: 0 = normal report (always — manifest mismatches never flip this);
         1 = --selftest assertion failure; 2 = bad invocation.
   ===================================================================== */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import assert from 'node:assert';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SESSION = arg('--session');
const MANIFEST = arg('--manifest');
const JSON_OUT = process.argv.includes('--json');
const OUT = arg('--out');
const SELFTEST = process.argv.includes('--selftest');

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
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  }
  walk(rootDir);
  return out;
}

function readJsonlLines(file) {
  const lines = [];
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return lines; }
  for (const raw of text.split('\n')) {
    const s = raw.trim();
    if (!s) continue;
    try { lines.push(JSON.parse(s)); } catch { /* skip unparseable line */ }
  }
  return lines;
}

// Discover every .jsonl transcript belonging to targetSession, grouped by
// IN-FILE .sessionId (never by directory name — a subagent can be filed
// under a foreign session's directory on resume/fork).
function discoverTranscripts(rootDir, targetSession) {
  const files = listJsonlFiles(rootDir);
  const kept = [];
  for (const file of files) {
    const lines = readJsonlLines(file);
    if (lines.some((l) => l && l.sessionId === targetSession)) kept.push({ file, lines });
  }

  // Dedupe by .agentId (root bucket = lines with no agentId).
  const byKey = new Map();
  for (const entry of kept) {
    const agentIdLine = entry.lines.find((l) => l && l.agentId);
    const agentId = agentIdLine ? agentIdLine.agentId : null;
    entry.agentId = agentId;
    const key = agentId || '__root__';
    if (!byKey.has(key)) { byKey.set(key, entry); continue; }
    // Prefer the file whose own basename equals the target session uuid as root.
    if (key === '__root__' && basename(entry.file, '.jsonl') === targetSession) byKey.set(key, entry);
  }

  const root = byKey.get('__root__') || null;
  if (root) root.isRoot = true;
  const subagents = [...byKey.entries()].filter(([k]) => k !== '__root__').map(([, v]) => v);
  for (const sub of subagents) sub.isRoot = false;

  const notes = [];
  for (const sub of subagents) {
    const rel = relative(rootDir, sub.file);
    const firstSeg = rel.split(sep)[0];
    if (firstSeg !== targetSession) {
      notes.push(`NOTE: ${basename(sub.file)} has sessionId=${targetSession} but lives under foreign dir ${firstSeg}/`);
    }
  }

  // Sibling meta.json for each subagent.
  for (const sub of subagents) {
    const metaPath = sub.file.replace(/\.jsonl$/, '.meta.json');
    if (existsSync(metaPath)) {
      try { sub.meta = JSON.parse(readFileSync(metaPath, 'utf8')); sub.metaPath = metaPath; }
      catch { sub.meta = null; sub.metaPath = metaPath; }
    } else { sub.meta = null; sub.metaPath = null; }
  }

  return { root, subagents, notes };
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function firstModel(lines) {
  for (const l of lines) {
    if (l && l.type === 'assistant' && l.message && l.message.model) return l.message.model;
  }
  return null;
}

// Sum ONE .message.usage per distinct .message.id (usage repeats identically
// across streamed partial lines of the same message — dedupe or you inflate).
function tokensOf(lines) {
  const seen = new Map();
  for (const l of lines) {
    if (l && l.type === 'assistant' && l.message && l.message.id && l.message.usage && !seen.has(l.message.id)) {
      seen.set(l.message.id, l.message.usage);
    }
  }
  let input = 0, output = 0, cacheCreation = 0, cacheRead = 0;
  for (const u of seen.values()) {
    input += u.input_tokens || 0;
    output += u.output_tokens || 0;
    cacheCreation += u.cache_creation_input_tokens || 0;
    cacheRead += u.cache_read_input_tokens || 0;
  }
  return { input, output, cacheCreation, cacheRead, bill: input + output + cacheCreation, messages: seen.size };
}

// Distinct tool_use.id -> {name, input, timestamp} (a block can be echoed
// across streamed lines the same way usage is — dedupe by id).
function toolUsesOf(lines) {
  const map = new Map();
  for (const l of lines) {
    if (l && l.type === 'assistant' && l.message && Array.isArray(l.message.content)) {
      for (const b of l.message.content) {
        if (b && b.type === 'tool_use' && b.id && !map.has(b.id)) {
          map.set(b.id, { id: b.id, name: b.name, input: b.input || {}, timestamp: l.timestamp || null });
        }
      }
    }
  }
  return map;
}

// tool_use_id -> {is_error, stdout, timestamp}. is_error is true/false only
// for Bash; null/absent for every other tool — NEVER treat that as a pass.
function toolResultsOf(lines) {
  const map = new Map();
  for (const l of lines) {
    if (l && l.type === 'user' && l.message && Array.isArray(l.message.content)) {
      for (const b of l.message.content) {
        if (b && b.type === 'tool_result' && b.tool_use_id) {
          const isError = (b.is_error === true || b.is_error === false) ? b.is_error : null;
          const stdout = (l.toolUseResult && typeof l.toolUseResult.stdout === 'string') ? l.toolUseResult.stdout : null;
          map.set(b.tool_use_id, { isError, stdout, timestamp: l.timestamp || null });
        }
      }
    }
  }
  return map;
}

function timelineEventsOf(lines) {
  return lines.filter((l) => l && typeof l.timestamp === 'string');
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
    if (!key.startsWith('flowmap:') && !key.startsWith('spec:')) continue;
    scriptKeys.add(key);
    for (const m of String(value).match(mjsRe) || []) mjsPaths.add(m);
  }
  return { scriptKeys, mjsPaths };
}

// Split a Bash .input.command on &&, ;, |, newlines; for each sub-command,
// strip a trailing "-- --flag..." tail, then check for a known script/path.
function classifyBash(command, known) {
  const subs = String(command || '').split(/&&|;|\||\n/).map((s) => s.trim()).filter(Boolean);
  const hits = [];
  for (const rawSub of subs) {
    const sub = rawSub.replace(/\s+--\s+.*$/, '');
    const npmMatch = sub.match(/npm run ((?:flowmap|spec):[\w:-]+)/);
    let matched = null;
    if (npmMatch && known.scriptKeys.has(npmMatch[1])) matched = npmMatch[1];
    if (!matched) {
      for (const p of known.mjsPaths) { if (sub.includes(p)) { matched = p; break; } }
    }
    if (matched) hits.push({ sub: rawSub, matched });
  }
  return hits;
}

function mmdRefsOf(toolUses) {
  const refs = [];
  for (const [id, tu] of toolUses) {
    if (tu.name === 'Read' && typeof tu.input.file_path === 'string' && tu.input.file_path.endsWith('.mmd')) {
      refs.push({ toolUseId: id, tool: 'Read', path: tu.input.file_path });
    }
    if (tu.name === 'Bash' && typeof tu.input.command === 'string') {
      for (const m of tu.input.command.match(/[\w./-]+\.mmd/g) || []) {
        refs.push({ toolUseId: id, tool: 'Bash', path: m });
      }
    }
  }
  return refs;
}

function selfMutationFlagsOf(toolUses) {
  const flags = [];
  const writePattern = /node -e|sed -i|cat\s*>>?/;
  const targetPattern = /plan[^"'\s]*\.json|verdict|approved|m10-run\.json/;
  for (const [, tu] of toolUses) {
    if (tu.name !== 'Bash') continue;
    const cmd = String(tu.input.command || '');
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
  for (const a of agents) {
    for (const [id, tu] of a.toolUses) {
      if (tu.name === 'Agent' && id === toolUseId) return a;
    }
  }
  return null;
}

/* =====================================================================
   Report builder
   ===================================================================== */

function buildReport(targetSession, manifestPath) {
  const { root, subagents, notes } = discoverTranscripts(PROJECT_DIR, targetSession);
  if (!root) throw new Error(`no root transcript found for session ${targetSession} under ${PROJECT_DIR}`);

  const rootAgent = wrapAgent(root, 'lead');
  const subAgents = subagents
    .map((s) => wrapAgent(s, slugify((s.meta && s.meta.description) || s.agentId)))
    .sort((a, b) => (a.meta?.spawnDepth ?? 1) - (b.meta?.spawnDepth ?? 1)); // ordered by spawnDepth

  const allAgents = [rootAgent, ...subAgents];

  // Resolve parent for each subagent by matching meta.toolUseId to an Agent tool_use.
  for (const s of subAgents) {
    const toolUseId = s.meta && s.meta.toolUseId;
    s.parent = toolUseId ? findSpawner(allAgents, toolUseId) : null;
  }

  const depth = subAgents.length ? Math.max(...subAgents.map((s) => s.meta?.spawnDepth ?? 1)) : 0;
  const completeness = `${allAgents.length} transcripts found (1 root + ${allAgents.length - 1} subagent(s)), spawn tree depth ${depth}`;

  // Time range across ALL discovered transcripts.
  const allTimestamps = allAgents.flatMap((a) => a.events.map((e) => e.timestamp));
  const timeRange = allTimestamps.length ? { min: allTimestamps.reduce((a, b) => (a < b ? a : b)), max: allTimestamps.reduce((a, b) => (a > b ? a : b)) } : { min: null, max: null };
  const gitBranch = (() => {
    for (const a of allAgents) { const l = a.events.find((e) => e.gitBranch); if (l) return l.gitBranch; }
    return null;
  })();

  // Unified timeline.
  const timeline = allAgents
    .flatMap((a) => a.events.map((e) => ({ agent: a.label, event: e })))
    .sort((x, y) => (x.event.timestamp < y.event.timestamp ? -1 : x.event.timestamp > y.event.timestamp ? 1 : 0));

  // Known-tool inventory.
  const known = buildKnownTools(join(ROOT_REPO, 'package.json'));
  const toolRuns = new Map(); // key -> [{agent, hits, blocks}]
  for (const a of allAgents) {
    for (const [id, tu] of a.toolUses) {
      if (tu.name !== 'Bash') continue;
      const hits = classifyBash(tu.input.command, known);
      if (!hits.length) continue;
      const result = a.toolResults.get(id);
      for (const h of hits) {
        if (!toolRuns.has(h.matched)) toolRuns.set(h.matched, []);
        toolRuns.get(h.matched).push({ agent: a.label, toolUseId: id, sub: h.sub, isError: result ? result.isError : null });
      }
    }
  }
  const invokedKeys = new Set(toolRuns.keys());
  const allKnown = [...known.scriptKeys, ...known.mjsPaths];
  const notInvoked = allKnown.filter((k) => !invokedKeys.has(k));

  // .mmd routing proof.
  const mmdRouting = allAgents
    .map((a) => ({ agent: a.label, refs: a.mmdRefs }))
    .filter((r) => r.refs.length);

  // Tokens table.
  const tokensTable = allAgents.map((a) => ({ agent: a.label, ...a.tokens }));
  const combined = tokensTable.reduce((acc, r) => ({
    input: acc.input + r.input, output: acc.output + r.output,
    cacheCreation: acc.cacheCreation + r.cacheCreation, cacheRead: acc.cacheRead + r.cacheRead,
    bill: acc.bill + r.bill, messages: acc.messages + r.messages,
  }), { input: 0, output: 0, cacheCreation: 0, cacheRead: 0, bill: 0, messages: 0 });
  const zeroOutputAgents = tokensTable.filter((r) => r.agent !== 'lead' && r.output === 0).map((r) => r.agent);

  // Pass/fail across ALL discovered transcripts.
  let isErrorTrueTotal = 0, isErrorFalseTotal = 0, isErrorNA = 0;
  const isErrorByAgent = allAgents.map((a) => {
    let t = 0, f = 0, na = 0;
    for (const [, r] of a.toolResults) { if (r.isError === true) t++; else if (r.isError === false) f++; else na++; }
    isErrorTrueTotal += t; isErrorFalseTotal += f; isErrorNA += na;
    return { agent: a.label, true: t, false: f, na };
  });

  // Self-mutation flags (root/lead only, per spec).
  const selfMutation = selfMutationFlagsOf(rootAgent.toolUses);

  // Manifest reconciliation (report-only).
  let manifest = null;
  if (manifestPath) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const rows = [];
    // spawns[] join by attempts sum vs subagent transcript count.
    const attemptsSum = (m.spawns || []).reduce((a, s) => a + (s.attempts || 0), 0);
    rows.push({
      check: 'spawns[].attempts sum vs subagent transcripts found',
      manifest: attemptsSum, actual: subAgents.length,
      verdict: attemptsSum === subAgents.length ? 'match' : 'MISMATCH',
    });
    const modelFamilies = ['opus', 'sonnet', 'haiku', 'fable'];
    const spawnModelChecks = (m.spawns || []).map((s) => {
      const short = String(s.model || '').toLowerCase();
      const anyAgentWithFamily = subAgents.some((a) => (a.model || '').toLowerCase().includes(short));
      return { role: s.role, model: s.model, verdict: anyAgentWithFamily ? 'match' : 'MISMATCH (no transcript model contains this family)' };
    });
    rows.push({
      check: 'leadToolCalls',
      manifest: m.leadToolCalls, actual: rootAgent.toolUses.size,
      verdict: m.leadToolCalls === rootAgent.toolUses.size ? 'match' : 'MISMATCH',
      note: m.leadToolCalls !== rootAgent.toolUses.size
        ? 'a small under-count vs the live transcript total is consistent with the manifest being written before the session\'s final tool calls were serialized (a post-serialization commit), not necessarily dishonest under-reporting'
        : null,
    });
    const leadSrcReads = [...rootAgent.toolUses.values()].filter((tu) => tu.name === 'Read' && typeof tu.input.file_path === 'string' && tu.input.file_path.startsWith('src/')).length;
    rows.push({
      check: 'leadSrcReads',
      manifest: m.leadSrcReads, actual: leadSrcReads,
      verdict: m.leadSrcReads === leadSrcReads ? 'match' : 'MISMATCH',
    });
    const allCommands = allAgents.flatMap((a) => [...a.toolUses.values()].filter((tu) => tu.name === 'Bash').map((tu) => tu.input.command || ''));
    const stageRows = (m.stages || []).map((st) => {
      const cmdPrefix = String(st.cmd || '').split(/\s+--\s+/)[0].trim();
      const present = allCommands.some((c) => c.includes(cmdPrefix) || c.includes(st.cmd));
      return {
        stage: st.stage, cmd: st.cmd, claimedExit: st.exit,
        verdict: present ? 'match (command present)' : 'MISMATCH (command not found in any Bash tool_use)',
        note: 'claimed exit is NOT independently verifiable against is_error at this granularity (a chained/looped stage does not map 1:1 to a single Bash invocation) — presence-of-command only',
      };
    });
    manifest = { path: manifestPath, rows, spawnModelChecks, stageRows };
  }

  return {
    session: targetSession, gitBranch, timeRange, rootModel: rootAgent.model,
    completeness, notes, depth,
    rootAgent, subAgents, allAgents,
    timeline, known: { scriptKeys: [...known.scriptKeys], mjsPaths: [...known.mjsPaths] },
    toolRuns: [...toolRuns.entries()], notInvoked,
    mmdRouting,
    tokensTable, combined, zeroOutputAgents,
    isErrorByAgent, isErrorTrueTotal, isErrorFalseTotal, isErrorNA,
    selfMutation, manifest,
  };
}

/* =====================================================================
   Markdown rendering
   ===================================================================== */

function fmtNum(n) { return n.toLocaleString('en-US'); }

function renderMarkdown(r) {
  const out = [];
  out.push(`# Audit run — session ${r.session}`);
  out.push('');
  out.push('## 1. Run header');
  out.push(`- sessionId: \`${r.session}\``);
  out.push(`- gitBranch: \`${r.gitBranch ?? '(none found)'}\``);
  out.push(`- time range: ${r.timeRange.min ?? '?'} → ${r.timeRange.max ?? '?'}`);
  out.push(`- root model: \`${r.rootModel ?? '(none found)'}\``);
  out.push(`- ${r.completeness}`);
  for (const n of r.notes) out.push(`- ${n}`);
  out.push('');

  out.push('## 2. Subagent roster + spawn tree');
  out.push('');
  out.push(`- lead (root, depth 0)`);
  for (const s of r.subAgents) {
    const parentLabel = s.parent ? s.parent.label : '(unresolved)';
    out.push(`  - **${s.label}** — agentType: ${s.meta?.agentType ?? '?'}, description: "${s.meta?.description ?? '?'}", model: \`${s.model ?? '?'}\`, spawnDepth: ${s.meta?.spawnDepth ?? '?'}, parent: ${parentLabel}`);
  }
  out.push('');

  out.push('## 3. Unified timeline (event lines with a `.timestamp`, all transcripts interleaved)');
  out.push('');
  out.push('| timestamp | agent | note |');
  out.push('|---|---|---|');
  for (const { agent, event } of r.timeline) {
    const notesFor = [];
    if (event.type === 'assistant' && Array.isArray(event.message?.content)) {
      for (const b of event.message.content) {
        if (b?.type !== 'tool_use') continue;
        if (b.name === 'Agent') {
          const target = r.subAgents.find((s) => s.meta?.toolUseId === b.id);
          notesFor.push(target ? `spawned subagent → ${target.meta?.description} (${target.model})` : 'spawned subagent (Agent tool_use)');
        } else if (b.name === 'Read' && typeof b.input?.file_path === 'string' && b.input.file_path.endsWith('.mmd')) {
          notesFor.push(`Read .mmd → ${b.input.file_path}`);
        } else if (b.name === 'Bash' && typeof b.input?.command === 'string' && /\.mmd/.test(b.input.command)) {
          notesFor.push(`Bash referencing .mmd → ${b.input.command.slice(0, 120)}`);
        } else if (b.name === 'Bash') {
          const result = r.allAgents.find((a) => a.label === agent)?.toolResults.get(b.id);
          if (result?.isError === true) notesFor.push(`Bash block exit non-zero: ${String(b.input?.command || '').slice(0, 100)}`);
        }
      }
    }
    if (notesFor.length) out.push(`| ${event.timestamp} | ${agent} | ${notesFor.join('; ')} |`);
  }
  out.push('');

  out.push('## 4. Flowmap/buildspec tools used');
  out.push('');
  out.push('| known key/path | invocations | agents | block pass/fail |');
  out.push('|---|---|---|---|');
  for (const [key, runs] of r.toolRuns) {
    const agentsList = [...new Set(runs.map((x) => x.agent))].join(', ');
    const verdicts = runs.map((x) => (x.isError === true ? 'FAIL' : x.isError === false ? 'pass' : 'n/a')).join(', ');
    out.push(`| \`${key}\` | ${runs.length} | ${agentsList} | ${verdicts} |`);
  }
  out.push('');
  out.push('Not directly invoked (may still run transitively — this only proves DIRECT invocation):');
  for (const k of r.notInvoked) out.push(`- \`${k}\``);
  out.push('');

  out.push('## 5. .mmd routing proof');
  out.push('');
  for (const { agent, refs } of r.mmdRouting) {
    for (const ref of refs) out.push(`- **${agent}** — ${ref.tool} → \`${ref.path}\``);
  }
  if (!r.mmdRouting.length) out.push('(no agent Read or Bash-referenced a .mmd path)');
  out.push('');

  out.push('## 6. Tokens table (deduped by message.id; bill = input + output + cache_creation)');
  out.push('');
  out.push('| agent | input | output | cache_creation | cache_read | bill |');
  out.push('|---|---|---|---|---|---|');
  for (const row of r.tokensTable) {
    out.push(`| ${row.agent} | ${fmtNum(row.input)} | ${fmtNum(row.output)} | ${fmtNum(row.cacheCreation)} | ${fmtNum(row.cacheRead)} | ${fmtNum(row.bill)} |`);
  }
  out.push(`| **combined** | ${fmtNum(r.combined.input)} | ${fmtNum(r.combined.output)} | ${fmtNum(r.combined.cacheCreation)} | ${fmtNum(r.combined.cacheRead)} | ${fmtNum(r.combined.bill)} |`);
  if (r.zeroOutputAgents.length) out.push(`\nSmell: zero output tokens for: ${r.zeroOutputAgents.join(', ')} (spawned but did no real generation).`);
  out.push('');

  if (r.manifest) {
    out.push('## 7. Manifest reconciliation (REPORT-ONLY — never affects exit code)');
    out.push('');
    out.push(`manifest: \`${r.manifest.path}\``);
    out.push('');
    out.push('| check | manifest | actual | verdict |');
    out.push('|---|---|---|---|');
    for (const row of r.manifest.rows) {
      out.push(`| ${row.check} | ${JSON.stringify(row.manifest)} | ${JSON.stringify(row.actual)} | ${row.verdict}${row.note ? ` (${row.note})` : ''} |`);
    }
    out.push('');
    out.push('spawns[] model-family normalization:');
    for (const c of r.manifest.spawnModelChecks) out.push(`- ${c.role}: manifest says \`${c.model}\` → ${c.verdict}`);
    out.push('');
    out.push('stages[] (presence-of-command only; claimed exit codes are NOT independently verifiable):');
    for (const s of r.manifest.stageRows) out.push(`- **${s.stage}**: ${s.verdict} — \`${s.cmd}\` (claimed exit ${s.claimedExit})`);
    out.push('');
  }

  out.push('## 8. Proof-signal ledger');
  out.push('');
  out.push('PRESENT:');
  out.push('- `is_error` — structured Bash pass/fail, paired to its tool_use by `tool_use_id`.');
  out.push('- `usage` tokens — per-message.id, deduped; structured counters, not narrated.');
  out.push('- `.message.model` per agent — read from the transcript itself, not meta.json.');
  out.push('- `sessionId`/`agentId`/`spawnDepth` — the spawn-tree structure.');
  out.push('- `.timestamp` — total event ordering across all transcripts.');
  out.push('- tool_use ↔ tool_result pairing by id.');
  out.push('- captured stdout in tool results (`toolUseResult.stdout`) — real output, not agent summary.');
  out.push('- git commit hashes / ship-stamp content hashes referenced in the session exist as a class of signal (not deeply parsed here).');
  out.push('');
  out.push('GAP:');
  out.push('- no structured numeric process exit code anywhere — only the boolean `is_error`.');
  out.push('- transcript integrity rests on the local filesystem only, not a cryptographic signature.');
  out.push('- a mutable sidecar log (if present) is not proof of anything, just a log.');
  out.push('');
  out.push(`Self-mutation flags (lead transcript Bash commands touching plan/verdict/approval artifacts inline) — ${r.selfMutation.length} found:`);
  for (const f of r.selfMutation) out.push(`- \`${f}\``);
  if (!r.selfMutation.length) out.push('- none found');
  out.push('');
  out.push(`Total \`is_error === true\` across ALL discovered transcripts: ${r.isErrorTrueTotal} (0 in lead means: ${r.isErrorByAgent.find((a) => a.agent === 'lead')?.true ?? 0})`);
  for (const row of r.isErrorByAgent) out.push(`- ${row.agent}: true=${row.true}, false=${row.false}, n/a=${row.na}`);
  out.push('');

  return out.join('\n');
}

/* =====================================================================
   --selftest
   ===================================================================== */

function runSelftest() {
  const FIXTURES = join(HERE, '__fixtures__');
  const TARGET = '11111111-1111-1111-1111-111111111111';
  let failures = 0;

  function check(name, fn) {
    try { fn(); console.log(`PASS: ${name}`); }
    catch (e) { failures++; console.log(`FAIL: ${name} — ${e.message}`); }
  }

  const { root, subagents } = discoverTranscripts(FIXTURES, TARGET);
  const allEntries = [root, ...subagents];

  check('distinct tool_use.id count across fixture transcripts is 3 (tu_bash1, tu_read1, tu_agent1)', () => {
    const ids = new Set();
    for (const e of allEntries) for (const id of toolUsesOf(e.lines).keys()) ids.add(id);
    assert.strictEqual(ids.size, 3, `got ${ids.size}`);
  });

  check('is_error aggregation: 1 true, 0 false, 1 n/a (null never counted as pass)', () => {
    const results = toolResultsOf(root.lines);
    let t = 0, f = 0, na = 0;
    for (const [, r] of results) { if (r.isError === true) t++; else if (r.isError === false) f++; else na++; }
    assert.strictEqual(t, 1, `true=${t}`);
    assert.strictEqual(f, 0, `false=${f}`);
    assert.strictEqual(na, 1, `na=${na}`);
  });

  check('deduped token sum for a repeated message.id equals ONE copy, not doubled', () => {
    const tok = tokensOf(root.lines);
    // msg_1(output 50) + msg_2(output 8) + msg_3(output 12) = 70; a dedup bug would double msg_1 -> 120.
    assert.strictEqual(tok.output, 70, `output=${tok.output}`);
  });

  check('foreign-dir subagent transcript IS included in the discovered set (sessionId-grouping, not dir-grouping)', () => {
    assert.ok(subagents.some((s) => s.agentId === 'fx2'), 'agent-fx2 (filed under foreign dir 22222222.../subagents/) missing from discovered set');
  });

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

/* =====================================================================
   main
   ===================================================================== */

if (SELFTEST) {
  runSelftest();
} else {
  if (!SESSION) {
    console.error('usage: audit-run.mjs --session <root-session-uuid> [--manifest <path>] [--json] [--out <file>] [--selftest]');
    process.exit(2);
  }
  const report = buildReport(SESSION, MANIFEST);
  if (JSON_OUT) {
    const jsonBody = JSON.stringify(report, (k, v) => (v instanceof Map ? [...v.entries()] : v), 2);
    console.log(jsonBody);
    if (OUT) writeFileSync(OUT, jsonBody);
  } else {
    const md = renderMarkdown(report);
    console.log(md);
    if (OUT) writeFileSync(OUT, md);
  }
  process.exit(0);
}
