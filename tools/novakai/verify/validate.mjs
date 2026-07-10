#!/usr/bin/env node
// novakai-validate.mjs  — structural validation for any single .mmd (bundle or fragment).
// Checks: exactly one header, at most one %% root, no duplicate node id, every
// edge/parent/kind/fm:meta id resolves to a defined node or subgraph.
// Exit code 1 if any ERROR.  Usage: node novakai-validate.mjs <file.mmd>

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
if (!path) {
  console.error('usage: node novakai-validate.mjs <file.mmd>');
  process.exit(2);
}
const lines = readFileSync(path, 'utf8').split('\n');

const errors = [], notes = [];
const nodeDefs = new Map();      // id -> count
const subgraphIds = new Set();
const groupDefs = new Set();     // %% group declarations
let headers = 0, roots = 0;
const kindCount = new Map();

// pass 1: definitions
function recordGroupDefinition(match) {
  groupDefs.add(match[1]);
}
function recordSubgraphDefinition(match) {
  subgraphIds.add(match[2]);
}
function recordNodeDefinition(match) {
  nodeDefs.set(match[2], (nodeDefs.get(match[2]) || 0) + 1);
}
function collectDefinition(line) {
  if (HEADER.test(line)) {
    headers++;
    return;
  }
  if (D_ROOT.test(line)) {
    roots++;
    return;
  }
  let match;
  if ((match = D_GROUP.exec(line))) return recordGroupDefinition(match);
  if ((match = SUBGRAPH.exec(line))) return recordSubgraphDefinition(match);
  if ((match = NODE_OPEN.exec(line))) return recordNodeDefinition(match);
}
lines.forEach(collectDefinition);
const defined = new Set([...nodeDefs.keys(), ...subgraphIds]);

// pass 2: references
function checkEdgeReference(match, lineNumber) {
  for (const id of [match[2], match[5]])
    if (!defined.has(id)) errors.push(`line ${lineNumber}: edge endpoint '${id}' is not defined`);
}
function checkParentReference(match, lineNumber) {
  for (const id of [match[1], match[2]])
    if (!defined.has(id)) errors.push(`line ${lineNumber}: %% parent id '${id}' is not defined`);
}
function checkKindReference(match, lineNumber) {
  kindCount.set(match[1], (kindCount.get(match[1]) || 0) + 1);
  if (!defined.has(match[1])) errors.push(`line ${lineNumber}: %% kind id '${match[1]}' is not defined`);
}
function checkFmMetaReference(match, lineNumber) {
  if (!defined.has(match[1])) {
    notes.push(`line ${lineNumber}: %% fm:meta id '${match[1]}' has no node (frontmatter on a missing node)`);
  }
}
function checkGroupReference(match, lineNumber) {
  if (match[3] && !groupDefs.has(match[3])) {
    errors.push(`line ${lineNumber}: %% group '${match[1]}' parent '${match[3]}' is not a declared group`);
  }
  if (defined.has(match[1])) {
    errors.push(`line ${lineNumber}: %% group id '${match[1]}' collides with a node/subgraph id`);
  }
}
function checkGroupMemberReference(match, lineNumber) {
  if (!groupDefs.has(match[1])) errors.push(`line ${lineNumber}: %% group-member group '${match[1]}' is not declared`);
  if (!defined.has(match[2])) errors.push(`line ${lineNumber}: %% group-member node '${match[2]}' is not defined`);
}
function checkReferenceLine(line, index) {
  const lineNumber = index + 1;
  let match;
  if ((match = EDGE.exec(line))) return checkEdgeReference(match, lineNumber);
  if ((match = D_PARENT.exec(line))) return checkParentReference(match, lineNumber);
  if ((match = D_KIND.exec(line))) return checkKindReference(match, lineNumber);
  if ((match = D_FMMETA.exec(line))) return checkFmMetaReference(match, lineNumber);
  if ((match = D_GROUP.exec(line))) return checkGroupReference(match, lineNumber);
  if ((match = D_GROUPMEMBER.exec(line))) return checkGroupMemberReference(match, lineNumber);
}
lines.forEach(checkReferenceLine);

if (headers !== 1) errors.push(`expected exactly 1 \`flowchart\` header, found ${headers}`);
if (roots > 1) errors.push(`expected at most 1 \`%% root\`, found ${roots}`);
for (const [id, count] of nodeDefs) {
  if (count > 1) errors.push(`node id '${id}' defined ${count} times (must be unique)`);
}
// every defined node should carry exactly one kind (spec: REQUIRED, one per node)
for (const id of nodeDefs.keys()) {
  const count = kindCount.get(id) || 0;
  if (count === 0) notes.push(`node '${id}' has no %% kind`);
  if (count > 1) errors.push(`node '${id}' has ${count} %% kind lines (must be one)`);
}

console.log(`${path}: ${nodeDefs.size} nodes, ${subgraphIds.size} subgraphs, ${headers} header, ${roots} root`);
for (const note of notes) console.log('  note: ' + note);
for (const error of errors) console.log('  ERROR: ' + error);
console.log(errors.length ? `FAIL (${errors.length} error(s))` : 'PASS');
process.exit(errors.length ? 1 : 0);
