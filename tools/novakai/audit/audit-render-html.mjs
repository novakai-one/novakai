import { timelineNotes, NONE_FOUND } from './audit-report.mjs';

const SECTION_CLOSE = '</section>';
const TBODY_CLOSE = '</tbody></table>';

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

export { renderHtml };
