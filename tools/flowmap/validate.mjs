#!/usr/bin/env node
// flowmap-validate.mjs  — structural validation for any single .mmd (bundle or fragment).
// Checks: exactly one header, at most one %% root, no duplicate node id, every
// edge/parent/kind/fm:meta id resolves to a defined node or subgraph.
// Exit code 1 if any ERROR.  Usage: node flowmap-validate.mjs <file.mmd>

import { readFileSync } from 'node:fs';

const NODE_OPEN = /^(\s*)([A-Za-z0-9_]+)\s*(\[\(|\(\[|\{\{|\(\(|\[|\(|\{|>)"/;
const EDGE = /^(\s*)([A-Za-z0-9_]+)\s*(-\.->|-->|==>)(\|[^|]*\|)?\s*([A-Za-z0-9_]+)\s*$/;
const SUBGRAPH = /^(\s*)subgraph\s+([A-Za-z0-9_]+)(\s.*)?$/;
const HEADER = /^\s*flowchart\s+(\S+)\s*$/;
const D_ROOT = /^%%\s*root\s+([A-Za-z0-9_]+)/;
const D_KIND = /^%%\s*kind\s+([A-Za-z0-9_]+)\s+(\S+)/;
const D_PARENT = /^%%\s*parent\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)/;
const D_FMMETA = /^%%\s*fm:meta\s+([A-Za-z0-9_]+)\s/;
const D_GROUP = /^%%\s*group\s+([A-Za-z0-9_]+)\s+"([^"]*)"(?:\s+parent\s+([A-Za-z0-9_]+))?\s*$/;
const D_GROUPMEMBER = /^%%\s*group-member\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$/;

const path = process.argv[2];
if (!path) { console.error('usage: node flowmap-validate.mjs <file.mmd>'); process.exit(2); }
const lines = readFileSync(path, 'utf8').split('\n');

const errors = [], notes = [];
const nodeDefs = new Map();      // id -> count
const subgraphIds = new Set();
const groupDefs = new Set();     // %% group declarations
let headers = 0, roots = 0;
const kindCount = new Map();

// pass 1: definitions
lines.forEach((ln) => {
  if (HEADER.test(ln)) { headers++; return; }
  if (D_ROOT.test(ln)) { roots++; return; }
  let m;
  if ((m = D_GROUP.exec(ln))) { groupDefs.add(m[1]); return; }
  if ((m = SUBGRAPH.exec(ln))) { subgraphIds.add(m[2]); return; }
  if ((m = NODE_OPEN.exec(ln))) { nodeDefs.set(m[2], (nodeDefs.get(m[2]) || 0) + 1); return; }
});
const defined = new Set([...nodeDefs.keys(), ...subgraphIds]);

// pass 2: references
lines.forEach((ln, i) => {
  let m;
  if ((m = EDGE.exec(ln))) {
    for (const id of [m[2], m[5]])
      if (!defined.has(id)) errors.push(`line ${i + 1}: edge endpoint '${id}' is not defined`);
    return;
  }
  if ((m = D_PARENT.exec(ln))) {
    for (const id of [m[1], m[2]])
      if (!defined.has(id)) errors.push(`line ${i + 1}: %% parent id '${id}' is not defined`);
    return;
  }
  if ((m = D_KIND.exec(ln))) {
    kindCount.set(m[1], (kindCount.get(m[1]) || 0) + 1);
    if (!defined.has(m[1])) errors.push(`line ${i + 1}: %% kind id '${m[1]}' is not defined`);
    return;
  }
  if ((m = D_FMMETA.exec(ln))) {
    if (!defined.has(m[1])) notes.push(`line ${i + 1}: %% fm:meta id '${m[1]}' has no node (frontmatter on a missing node)`);
    return;
  }
  if ((m = D_GROUP.exec(ln))) {
    if (m[3] && !groupDefs.has(m[3])) errors.push(`line ${i + 1}: %% group '${m[1]}' parent '${m[3]}' is not a declared group`);
    if (defined.has(m[1])) errors.push(`line ${i + 1}: %% group id '${m[1]}' collides with a node/subgraph id`);
    return;
  }
  if ((m = D_GROUPMEMBER.exec(ln))) {
    if (!groupDefs.has(m[1])) errors.push(`line ${i + 1}: %% group-member group '${m[1]}' is not declared`);
    if (!defined.has(m[2])) errors.push(`line ${i + 1}: %% group-member node '${m[2]}' is not defined`);
    return;
  }
});

if (headers !== 1) errors.push(`expected exactly 1 \`flowchart\` header, found ${headers}`);
if (roots > 1) errors.push(`expected at most 1 \`%% root\`, found ${roots}`);
for (const [id, c] of nodeDefs) if (c > 1) errors.push(`node id '${id}' defined ${c} times (must be unique)`);
// every defined node should carry exactly one kind (spec: REQUIRED, one per node)
for (const id of nodeDefs.keys()) {
  const c = kindCount.get(id) || 0;
  if (c === 0) notes.push(`node '${id}' has no %% kind`);
  if (c > 1) errors.push(`node '${id}' has ${c} %% kind lines (must be one)`);
}

console.log(`${path}: ${nodeDefs.size} nodes, ${subgraphIds.size} subgraphs, ${headers} header, ${roots} root`);
for (const n of notes) console.log('  note: ' + n);
for (const e of errors) console.log('  ERROR: ' + e);
console.log(errors.length ? `FAIL (${errors.length} error(s))` : 'PASS');
process.exit(errors.length ? 1 : 0);
