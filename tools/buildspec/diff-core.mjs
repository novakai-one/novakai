/* =====================================================================
   diff-core.mjs — structural diff between two skeleton maps. Pure; no IO.
   Used by gate (#3) and reusable by an in-app diff view (#5).

   Blocking (errors), per decided policy (see HANDOVER):
     - unbuilt:   spec node with no matching symbol
     - unplanned: symbol with no matching spec node
     - kind mismatch
     - parent mismatch
     - missing member (a gated node's declared interface absent in code)
     - arity mismatch   (only ARITY_GATED kinds)
     - return mismatch  (void vs value, member-gated kinds)
   Non-blocking (warnings):
     - extra member on a gated node (an unplanned public surface)
     - edge differences (spec edges are semantic call-order; extracted
       edges are imports — not 1:1, so never blocking)
   ===================================================================== */

import { ARITY_GATED_KINDS } from './skeleton.mjs';

const MEMBER_GATED = new Set(['class', 'function', 'hook', 'type']);

function memberMap(skel) {
  const map = {};
  for (const mem of skel.members) map[mem.name] = mem;
  return map;
}

// per-member TYPE gate (arity-gated kinds, only when arity already agrees):
// compare each clean param type and the return type. Prose types (null)
// are a documented hole — skipped and counted, never a false mismatch.
function diffMemberTypes(path, members, errors) {
  const { spec: sMember, code: cMember } = members;
  let proseSkips = 0;
  const sp = sMember.paramTypes || [];
  const cp = cMember.paramTypes || [];
  for (let i = 0; i < sp.length; i++) {
    if (sp[i] == null || cp[i] == null) { proseSkips++; continue; }
    if (sp[i] !== cp[i]) errors.push(`param type mismatch: "${path}" arg ${i} spec=${sp[i]} code=${cp[i]}`);
  }
  const sr = sMember.returnType, cr = cMember.returnType;
  if (sr == null || cr == null) proseSkips++;
  else if (sr !== 'void' && sr !== cr) errors.push(`return type mismatch: "${path}" spec=${sr} code=${cr}`);
  return proseSkips;
}

// arity + returnsValue checks for one matched member, then hands off to the type gate
function diffMember(path, members, kind, errors) {
  const { spec: sMember, code: cMember } = members;
  if (ARITY_GATED_KINDS.has(kind) && sMember.arity !== cMember.arity) {
    errors.push(`arity mismatch: "${path}" spec=${sMember.arity} code=${cMember.arity}`);
  }
  if (sMember.returnsValue !== cMember.returnsValue) {
    errors.push(`return mismatch: "${path}" spec ${sMember.returnsValue ? 'returns a value' : 'returns void'}, code ${cMember.returnsValue ? 'returns a value' : 'returns void'}`);
  }
  if (ARITY_GATED_KINDS.has(kind) && sMember.arity === cMember.arity) {
    return diffMemberTypes(path, members, errors);
  }
  return 0;
}

// members only where both sides agree the kind is gated
function diffMembers(id, specNode, codeNode, out) {
  const { errors, warns } = out;
  const sm = memberMap(specNode);
  const cm = memberMap(codeNode);
  let proseSkips = 0;
  for (const name in sm) {
    if (!(name in cm)) { errors.push(`missing member: "${id}.${name}" declared in spec, absent in code`); continue; }
    proseSkips += diffMember(`${id}.${name}`, { spec: sm[name], code: cm[name] }, specNode.kind, errors);
  }
  for (const name in cm) if (!(name in sm)) warns.push(`extra member: "${id}.${name}" in code, not in spec`);
  return proseSkips;
}

// one spec id: presence, kind/parent alignment, then member diffing when gated
function diffSpecNode(id, specNode, codeNode, out) {
  const { errors } = out;
  if (!codeNode) {
    errors.push(`unbuilt: spec node "${id}" (kind ${specNode.kind}) has no symbol in the code`);
    return 0;
  }
  if (specNode.kind !== codeNode.kind) errors.push(`kind mismatch: "${id}" spec=${specNode.kind} code=${codeNode.kind}`);
  if ((specNode.parent ?? null) !== (codeNode.parent ?? null)) {
    errors.push(`parent mismatch: "${id}" spec=${specNode.parent ?? '<none>'} code=${codeNode.parent ?? '<none>'}`);
  }
  if (MEMBER_GATED.has(specNode.kind) && MEMBER_GATED.has(codeNode.kind)) {
    return diffMembers(id, specNode, codeNode, out);
  }
  return 0;
}

// code symbols with no spec node at all — gated by opts to error or warn
function collectUnplanned(codeIds, maps, opts, out) {
  const { specMap, codeMap } = maps;
  const { errors, warns } = out;
  for (const id of codeIds) {
    if (!specMap[id]) (opts.unplannedAsWarning ? warns : errors).push(`unplanned: symbol "${id}" (kind ${codeMap[id].kind}) has no spec node`);
  }
}

// edges — informational only
function diffEdges(opts, warns) {
  if (!(opts.specEdges && opts.codeEdges)) return;
  const key = (edge) => `${edge.from}->${edge.to}`;
  const specSet = new Set(opts.specEdges.map(key));
  const codeSet = new Set(opts.codeEdges.map(key));
  for (const edge of opts.codeEdges) if (!specSet.has(key(edge))) warns.push(`undocumented dependency: import ${key(edge)} not in spec`);
  for (const edge of opts.specEdges) if (!codeSet.has(key(edge))) warns.push(`spec edge not realized as import: ${key(edge)}`);
}

// structural diff between a spec skeleton map and a code skeleton map
export function diffSkeletons(specMap, codeMap, opts = {}) {
  const errors = [];
  const warns = [];
  const out = { errors, warns };
  let proseSkips = 0;   // params/returns left ungated because the spec type is prose
  const specIds = Object.keys(specMap);
  const codeIds = new Set(Object.keys(codeMap));

  for (const id of specIds) {
    proseSkips += diffSpecNode(id, specMap[id], codeMap[id], out);
  }

  collectUnplanned(codeIds, { specMap, codeMap }, opts, out);
  diffEdges(opts, warns);

  if (proseSkips) warns.push(`type gate: ${proseSkips} param/return type(s) not gated (prose type in spec — documented hole, not drift)`);

  return { errors, warns };
}
