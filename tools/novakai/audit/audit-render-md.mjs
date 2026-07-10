/* =====================================================================
   audit-render-md.mjs — Markdown rendering of the audit report (the
   same `report` object audit-render-html.mjs consumes; 1:1 section
   parity between the two renderers).
   ===================================================================== */

import { timelineNotes, NONE_FOUND } from './audit-report.mjs';

/* =====================================================================
   Markdown rendering
   ===================================================================== */

function fmtNum(tokenCount) {
  return tokenCount.toLocaleString('en-US');
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

export { renderMarkdown };
