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
  const m = {};
  for (const mem of skel.members) m[mem.name] = mem;
  return m;
}

export function diffSkeletons(specMap, codeMap, opts = {}) {
  const errors = [];
  const warns = [];
  let proseSkips = 0;   // params/returns left ungated because the spec type is prose
  const specIds = Object.keys(specMap);
  const codeIds = new Set(Object.keys(codeMap));

  for (const id of specIds) {
    const s = specMap[id];
    const c = codeMap[id];
    if (!c) { errors.push(`unbuilt: spec node "${id}" (kind ${s.kind}) has no symbol in the code`); continue; }
    if (s.kind !== c.kind) errors.push(`kind mismatch: "${id}" spec=${s.kind} code=${c.kind}`);
    if ((s.parent ?? null) !== (c.parent ?? null)) {
      errors.push(`parent mismatch: "${id}" spec=${s.parent ?? '<none>'} code=${c.parent ?? '<none>'}`);
    }
    // members only where both sides agree the kind is gated
    if (MEMBER_GATED.has(s.kind) && MEMBER_GATED.has(c.kind)) {
      const sm = memberMap(s);
      const cm = memberMap(c);
      for (const name in sm) {
        if (!(name in cm)) { errors.push(`missing member: "${id}.${name}" declared in spec, absent in code`); continue; }
        if (ARITY_GATED_KINDS.has(s.kind) && sm[name].arity !== cm[name].arity) {
          errors.push(`arity mismatch: "${id}.${name}" spec=${sm[name].arity} code=${cm[name].arity}`);
        }
        if (sm[name].returnsValue !== cm[name].returnsValue) {
          errors.push(`return mismatch: "${id}.${name}" spec ${sm[name].returnsValue ? 'returns a value' : 'returns void'}, code ${cm[name].returnsValue ? 'returns a value' : 'returns void'}`);
        }
        // full TYPE gate (arity-gated kinds, only when arity already agrees):
        // compare each clean param type and the return type. Prose types (null)
        // are a documented hole — skipped and counted, never a false mismatch.
        if (ARITY_GATED_KINDS.has(s.kind) && sm[name].arity === cm[name].arity) {
          const sp = sm[name].paramTypes || [];
          const cp = cm[name].paramTypes || [];
          for (let i = 0; i < sp.length; i++) {
            if (sp[i] == null || cp[i] == null) { proseSkips++; continue; }
            if (sp[i] !== cp[i]) errors.push(`param type mismatch: "${id}.${name}" arg ${i} spec=${sp[i]} code=${cp[i]}`);
          }
          const sr = sm[name].returnType, cr = cm[name].returnType;
          if (sr == null || cr == null) proseSkips++;
          else if (sr !== 'void' && sr !== cr) errors.push(`return type mismatch: "${id}.${name}" spec=${sr} code=${cr}`);
        }
      }
      for (const name in cm) if (!(name in sm)) warns.push(`extra member: "${id}.${name}" in code, not in spec`);
    }
  }

  for (const id of codeIds) {
    if (!specMap[id]) (opts.unplannedAsWarning ? warns : errors).push(`unplanned: symbol "${id}" (kind ${codeMap[id].kind}) has no spec node`);
  }

  // edges — informational only
  if (opts.specEdges && opts.codeEdges) {
    const key = (e) => `${e.from}->${e.to}`;
    const specSet = new Set(opts.specEdges.map(key));
    const codeSet = new Set(opts.codeEdges.map(key));
    for (const e of opts.codeEdges) if (!specSet.has(key(e))) warns.push(`undocumented dependency: import ${key(e)} not in spec`);
    for (const e of opts.specEdges) if (!codeSet.has(key(e))) warns.push(`spec edge not realized as import: ${key(e)}`);
  }

  if (proseSkips) warns.push(`type gate: ${proseSkips} param/return type(s) not gated (prose type in spec — documented hole, not drift)`);

  return { errors, warns };
}
