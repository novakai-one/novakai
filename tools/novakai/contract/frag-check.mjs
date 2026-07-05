#!/usr/bin/env node
/* =====================================================================
   frag-check.mjs — the per-fragment CONTRACT instrument.
   ---------------------------------------------------------------------
   A subagent authoring one tooling fragment (tools/path/<name>.novakai.mmd)
   must make THIS exit 0 before its work is accepted. It checks the
   fragment in isolation (no full bundle needed), so it is a self-verifiable
   contract between the orchestrator and the subagent — pass/fail by machine,
   never by prose.

   Checks:
     ROOT      — `%% root <container>` matches --container
     MEMBERS   — the node ids carrying `%% src` == the --expect set exactly
     META      — every expected member has %% kind + fm:meta name + fm:meta desc
     SRC-TRUTH — every member's `%% src <path>[#symbol]` resolves (file + symbol)
     SECTIONED — every member sits inside a `subgraph` section (not bare), and
                 every section is `%% parent <section> <container>` (altitude:
                 dodges novakai-lint LOOSE-BAG / BARE-LEAF)

   Usage:
     node frag-check.mjs <fragment.mmd> --container <id> --expect id1,id2,...
   Exit: 0 = contract met, 1 = violations, 2 = bad invocation.
   ===================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const fragPath = process.argv[2];
const container = arg('--container');
const expect = (arg('--expect') || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!fragPath || !container || !expect.length) {
  console.error('usage: frag-check.mjs <fragment.mmd> --container <id> --expect id1,id2,...');
  process.exit(2);
}
if (!existsSync(fragPath)) { console.error(`no such fragment: ${fragPath}`); process.exit(2); }
const text = readFileSync(fragPath, 'utf8');
const lines = text.split('\n');
const problems = [];

// ---- ROOT ----
const rootLine = lines.find((l) => /^%%\s*root\s+/.test(l));
const rootId = rootLine ? rootLine.replace(/^%%\s*root\s+/, '').trim() : null;
if (rootId !== container) problems.push(`ROOT: expected "%% root ${container}", found ${rootId ? `"%% root ${rootId}"` : 'none'}`);

// ---- collect directives ----
const srcOf = new Map();   // id -> { path, symbol }
const kindOf = new Map();
const fmName = new Set();
const fmDesc = new Set();
for (const l of lines) {
  let m;
  if ((m = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+?)(?:#(\S+))?\s*$/.exec(l))) srcOf.set(m[1], { path: m[2], symbol: m[3] || null });
  else if ((m = /^%%\s*kind\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/.exec(l))) kindOf.set(m[1], m[2]);
  else if ((m = /^%%\s*fm:meta\s+([A-Za-z0-9_]+)\s+name=/.exec(l))) fmName.add(m[1]);
  else if ((m = /^%%\s*fm:meta\s+([A-Za-z0-9_]+)\s+desc=/.exec(l))) fmDesc.add(m[1]);
}

// ---- MEMBERS: %% src ids (into tools/) must equal the expected set exactly ----
const srcIds = [...srcOf.keys()].filter((id) => srcOf.get(id).path.replace(/\\/g, '/').startsWith('tools/'));
const expectSet = new Set(expect);
for (const id of expect) if (!srcOf.has(id)) problems.push(`MEMBERS: expected member "${id}" has no %% src line`);
for (const id of srcIds) if (!expectSet.has(id)) problems.push(`MEMBERS: unexpected mapped member "${id}" (not in --expect)`);

// ---- META + SRC-TRUTH ----
function definesSymbol(body, sym) {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`export\\s+(?:const|let|var|class)\\s+${esc}\\b`),
    new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`\\b(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`\\b(?:const|let|var|class)\\s+${esc}\\b`),
  ];
  if (forms.some((re) => re.test(body))) return true;
  for (const b of body.match(/export\s*\{[^}]*\}/g) || []) {
    const names = b.replace(/export\s*\{|\}/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim());
    if (names.includes(sym)) return true;
  }
  return false;
}
for (const id of expect) {
  if (!kindOf.has(id)) problems.push(`META: member "${id}" has no %% kind`);
  if (!fmName.has(id)) problems.push(`META: member "${id}" has no fm:meta name=`);
  if (!fmDesc.has(id)) problems.push(`META: member "${id}" has no fm:meta desc=`);
  const s = srcOf.get(id);
  if (!s) continue;
  const abs = resolve(s.path);
  if (!existsSync(abs)) { problems.push(`SRC-TRUTH: member "${id}" -> ${s.path} does not exist`); continue; }
  if (s.symbol && !definesSymbol(readFileSync(abs, 'utf8'), s.symbol)) {
    problems.push(`SRC-TRUTH: member "${id}" -> ${s.path}#${s.symbol} but ${s.symbol} is not defined/exported there`);
  }
}

// ---- SECTIONED: members inside subgraph sections; sections parented to container ----
const sections = [];               // subgraph ids opened
const memberEnclosure = new Map(); // memberId -> nearest enclosing subgraph id (or null)
const stack = [];
const NODE = /^\s*([A-Za-z0-9_]+)\s*(\[\(|\(\[|\{\{|\(\(|\[|\(|\{|>)"/;
const SUB = /^\s*subgraph\s+([A-Za-z0-9_]+)/;
for (const l of lines) {
  let m;
  if ((m = SUB.exec(l))) { sections.push(m[1]); stack.push(m[1]); continue; }
  if (/^\s*end\s*$/.test(l)) { stack.pop(); continue; }
  if ((m = NODE.exec(l))) {
    const id = m[1];
    if (srcOf.has(id)) memberEnclosure.set(id, stack.length ? stack[stack.length - 1] : null);
  }
}
const parented = new Set();
for (const l of lines) {
  const m = /^%%\s*parent\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$/.exec(l);
  if (m) parented.add(`${m[1]}>${m[2]}`);
}
for (const id of expect) {
  const enc = memberEnclosure.get(id);
  if (enc === undefined) problems.push(`SECTIONED: member "${id}" has no node line inside the fragment`);
  else if (enc === null) problems.push(`SECTIONED: member "${id}" is not inside a subgraph section (bare leaf)`);
  else if (!parented.has(`${enc}>${container}`)) problems.push(`SECTIONED: section "${enc}" holding "${id}" is not "%% parent ${enc} ${container}"`);
}

if (problems.length === 0) {
  console.log(`frag-check ${fragPath}: PASS — ${expect.length} members, root ${container}, all src resolve, all sectioned.`);
  process.exit(0);
}
console.log(`frag-check ${fragPath}: FAIL — ${problems.length} problem(s):`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
