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

// per-member param TYPE gate: compare each clean param type. Prose types
// (null) are a documented hole — skipped and counted, never a false mismatch.
function diffParamTypes(path, specParams, codeParams, errors) {
  let proseSkips = 0;
  for (let index = 0; index < specParams.length; index++) {
    const specType = specParams[index];
    const codeType = codeParams[index];
    if (specType == null || codeType == null) {
      proseSkips++;
      continue;
    }
    if (specType !== codeType) {
      errors.push(`param type mismatch: "${path}" arg ${index} spec=${specType} code=${codeType}`);
    }
  }
  return proseSkips;
}

// per-member return TYPE gate — same prose-hole rule as diffParamTypes.
function diffReturnType(path, specReturn, codeReturn, errors) {
  if (specReturn == null || codeReturn == null) return 1;
  if (specReturn !== 'void' && specReturn !== codeReturn) {
    errors.push(`return type mismatch: "${path}" spec=${specReturn} code=${codeReturn}`);
  }
  return 0;
}

// per-member TYPE gate (arity-gated kinds, only when arity already agrees).
function diffMemberTypes(path, members, errors) {
  const { spec: sMember, code: cMember } = members;
  const specParams = sMember.paramTypes || [];
  const codeParams = cMember.paramTypes || [];
  const paramSkips = diffParamTypes(path, specParams, codeParams, errors);
  const returnSkips = diffReturnType(path, sMember.returnType, cMember.returnType, errors);
  return paramSkips + returnSkips;
}

// arity + returnsValue checks for one matched member, then hands off to the type gate
function diffMember(path, members, kind, errors) {
  const { spec: sMember, code: cMember } = members;
  if (ARITY_GATED_KINDS.has(kind) && sMember.arity !== cMember.arity) {
    errors.push(`arity mismatch: "${path}" spec=${sMember.arity} code=${cMember.arity}`);
  }
  if (sMember.returnsValue !== cMember.returnsValue) {
    const specReturns = sMember.returnsValue ? 'returns a value' : 'returns void';
    const codeReturns = cMember.returnsValue ? 'returns a value' : 'returns void';
    errors.push(`return mismatch: "${path}" spec ${specReturns}, code ${codeReturns}`);
  }
  if (ARITY_GATED_KINDS.has(kind) && sMember.arity === cMember.arity) {
    return diffMemberTypes(path, members, errors);
  }
  return 0;
}

function extraMemberWarning(id, name) {
  return `extra member: "${id}.${name}" in code, not in spec`;
}

// members only where both sides agree the kind is gated
function diffMembers(id, specNode, codeNode, out) {
  const { errors, warns } = out;
  const specMembers = memberMap(specNode);
  const codeMembers = memberMap(codeNode);
  let proseSkips = 0;
  for (const name in specMembers) {
    if (!(name in codeMembers)) {
      errors.push(`missing member: "${id}.${name}" declared in spec, absent in code`);
      continue;
    }
    proseSkips += diffMember(
      `${id}.${name}`,
      { spec: specMembers[name], code: codeMembers[name] },
      specNode.kind,
      errors,
    );
  }
  for (const name in codeMembers) if (!(name in specMembers)) warns.push(extraMemberWarning(id, name));
  return proseSkips;
}

// one spec id: presence, kind/parent alignment, then member diffing when gated
function diffSpecNode(id, specNode, codeNode, out) {
  const { errors } = out;
  if (!codeNode) {
    errors.push(`unbuilt: spec node "${id}" (kind ${specNode.kind}) has no symbol in the code`);
    return 0;
  }
  if (specNode.kind !== codeNode.kind) {
    errors.push(`kind mismatch: "${id}" spec=${specNode.kind} code=${codeNode.kind}`);
  }
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
    if (specMap[id]) continue;
    const target = opts.unplannedAsWarning ? warns : errors;
    target.push(`unplanned: symbol "${id}" (kind ${codeMap[id].kind}) has no spec node`);
  }
}

function typeGateWarning(proseSkips) {
  return `type gate: ${proseSkips} param/return type(s) not gated (prose type in spec — documented hole, not drift)`;
}

// edges — informational only
function diffEdges(opts, warns) {
  if (!(opts.specEdges && opts.codeEdges)) return;
  const key = (edge) => `${edge.from}->${edge.to}`;
  const specSet = new Set(opts.specEdges.map(key));
  const codeSet = new Set(opts.codeEdges.map(key));
  for (const edge of opts.codeEdges) {
    if (!specSet.has(key(edge))) warns.push(`undocumented dependency: import ${key(edge)} not in spec`);
  }
  for (const edge of opts.specEdges) {
    if (!codeSet.has(key(edge))) warns.push(`spec edge not realized as import: ${key(edge)}`);
  }
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

  if (proseSkips) warns.push(typeGateWarning(proseSkips));

  return { errors, warns };
}
