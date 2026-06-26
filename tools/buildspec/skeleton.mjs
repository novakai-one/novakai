/* =====================================================================
   skeleton.mjs — the canonical, deterministic "contract skeleton" of a
   node, plus the type-coercion helpers. This is the SINGLE definition
   that spec-to-stubs (#1), extract (#2) and gate (#3) all compute, so a
   skeleton produced from the spec and one produced from the code are
   comparable apples-to-apples.

   A node skeleton:
     { id, kind, parent, members: [{ name, arity, returnsValue }] }
   - member = one named interface / public method / exported function.
   - arity = number of parameters (spec: total params across that
     interface's accepts entries, top-level-comma split; code: real
     parameter count).
   - returnsValue = false iff the return is void/empty; true otherwise.

   Per-kind gate policy (decided, see HANDOVER): arity is only enforced
   for kinds whose fm signatures are real call signatures. For UI / store
   / module / service / event kinds the fm accepts list logical inputs,
   not the literal parameter list, so only member NAMES are gated there.
   ===================================================================== */

/** Kinds whose parameter arity is meaningful enough to gate. */
export const ARITY_GATED_KINDS = new Set(['class', 'function', 'hook']);

/** Split on a separator at bracket depth 0 (respects <> () []). */
export function splitTopLevel(str, sep = ',') {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of str) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    else if (ch === '>' || ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const PRIMITIVES = new Set([
  'string', 'number', 'boolean', 'void', 'unknown', 'any', 'null', 'undefined',
  'object', 'symbol', 'bigint', 'never', 'true', 'false', 'this',
]);

/** Lib/global type heads we must NOT redeclare as placeholders. */
export const LIB_TYPES = new Set([
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract',
  'ReturnType', 'Parameters', 'Promise', 'Array', 'Map', 'Set', 'WeakMap', 'WeakSet',
  'Date', 'RegExp', 'Error', 'Function', 'Iterable', 'Iterator', 'ReadonlyArray',
  'HTMLElement', 'HTMLDivElement', 'HTMLInputElement', 'Element', 'Node', 'Event',
  'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'Document', 'Window',
]);

const IDENT = '[A-Za-z_$][\\w$]*';
const WORD_RE = new RegExp(IDENT, 'g');

/**
 * A "clean" type string can be emitted as a TS type verbatim. Requires:
 *  - only type-grammar chars, and
 *  - every word is a primitive, a lib type, or PascalCase (leading upper).
 * Lowercase non-primitive words (e.g. `mouse`, `refs`, `in`) mark the
 * string as prose -> not clean.
 */
export function isCleanType(raw) {
  const s = (raw || '').trim();
  if (!s) return false;
  if (!/^[A-Za-z0-9_$ ,.<>\[\]|&]+$/.test(s)) return false;
  const words = s.match(WORD_RE) || [];
  for (const w of words) {
    if (PRIMITIVES.has(w) || LIB_TYPES.has(w)) continue;
    if (/^[A-Z]/.test(w)) continue; // PascalCase -> a real (possibly app) type
    return false;
  }
  return true;
}

/** PascalCase identifier heads in a clean type that need a declaration. */
export function appTypeNames(raw) {
  const out = [];
  for (const w of (raw.match(WORD_RE) || [])) {
    if (PRIMITIVES.has(w) || LIB_TYPES.has(w)) continue;
    if (/^[A-Z]/.test(w)) out.push(w);
  }
  return out;
}

/** Parse one "name: Type" piece. name is '' when absent/invalid. */
export function parseParamPiece(piece) {
  const s = piece.trim();
  const colon = s.indexOf(':');
  if (colon === -1) {
    // whole thing is the type; no explicit name
    return { name: '', type: s };
  }
  const name = s.slice(0, colon).trim();
  const type = s.slice(colon + 1).trim();
  return { name: /^[A-Za-z_$][\w$]*$/.test(name) ? name : '', type };
}

/** Flatten an interface's accepts[] into a parameter list. */
export function ifaceParams(accepts) {
  const params = [];
  for (const entry of accepts || []) {
    for (const piece of splitTopLevel(entry, ',')) params.push(parseParamPiece(piece));
  }
  return params;
}

/** True when a returns[] denotes a real value (not void/empty). */
export function returnsValue(returns) {
  const r = (returns || []).map((s) => s.trim()).filter(Boolean);
  if (!r.length) return false;
  return !r.every((x) => x === 'void');
}

const _isIdent = (s) => typeof s === 'string' && /^[A-Za-z_$][\w$]*$/.test(s);

/** Spec-side skeleton for one node id. */
export function specSkeleton(model, id) {
  const node = model.nodes[id];
  const fm = model.fm?.[id] || { interfaces: [], state: [] };
  const primary = _isIdent(fm.name) ? fm.name : id;
  const members = [];
  for (const iface of fm.interfaces || []) {
    const name = (iface.name || '').trim();
    const arity = ifaceParams(iface.accepts).length;
    const rv = returnsValue(iface.returns);
    if (name) members.push({ name, arity, returnsValue: rv });
    else if (iface.accepts?.length || iface.returns?.length) {
      // a nameless interface = the unit's primary callable; the extractor
      // sees it as the exported function named after the node.
      const fnKinds = node?.kind === 'function' || node?.kind === 'hook' || node?.kind === 'module';
      members.push({ name: fnKinds ? primary : '__call', arity, returnsValue: rv });
    }
  }
  members.sort((a, b) => a.name.localeCompare(b.name));
  return { id, kind: node?.kind ?? null, parent: gateParent(model, id), members };
}

/**
 * The parent that is gated: a drill-in parent (%% parent -> real code
 * containment) only. Subgraph/group membership is a same-level layout
 * concept with no code counterpart, so it is NOT a gated parent.
 */
export function gateParent(model, id) {
  const p = model.nodes?.[id]?.parent ?? null;
  if (!p) return null;
  return model.groups?.has(p) ? null : p;
}

/** Build the full spec skeleton map (real nodes only). */
export function specSkeletons(model) {
  const out = {};
  for (const id in model.nodes) {
    if (model.nodes[id].group) continue;
    out[id] = specSkeleton(model, id);
  }
  return out;
}
