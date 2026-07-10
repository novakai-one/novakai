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

import { writeFileSync } from 'node:fs';
import {
  listRootSessions, renderSessionList, resolveSession, pickSessionInteractive, PROJECT_DIR,
} from './audit-transcripts.mjs';
import { buildReport } from './audit-report.mjs';
import { renderMarkdown } from './audit-render-md.mjs';
import { renderHtml } from './audit-render-html.mjs';
import { runSelftest } from './audit-selftest.mjs';

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
