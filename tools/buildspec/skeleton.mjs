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

// =====================================================================
// A6: structural type helpers — object-literal and function-type gating.
//
// Previously `isCleanType` / `normType` only handled simple/generic types
// (char-level check).  These helpers extend recognition to:
//   • Object-literal types  { k: T; ... }   (members sorted for order-independence)
//   • Function types        (p: T) => R     (whitespace canonicalized)
// The helpers are mutually recursive through normType (always terminates because
// TypeScript types are finite and acyclic).
// =====================================================================

/**
 * Split `s` on `sep` at bracket depth 0, tracking ALL bracket pairs including
 * `{}`. Trailing/empty segments are dropped.  Used for object members (`;`)
 * and function params (`,`) where values may contain nested `{}` or `<>`.
 */
function splitDeep(s, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}')
      depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out;
}

/**
 * Index of the first `:` at all-brackets depth 0 in `s`.
 * Returns -1 when not found.  Used to split `key: Type` members where the
 * type part may contain `:` inside generics or function types.
 */
function colonAt0(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Split a union type string on `|` at all-brackets depth 0.
 * Extends the existing splitTopLevel to also track `{}`, so that
 * `{ color: string | null }` is NOT split at the `|` inside the braces.
 */
function splitUnion(s) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}')
      depth = Math.max(0, depth - 1);
    if (ch === '|' && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = '';
    } else {
      cur += ch;
    }
  }
  const t = cur.trim();
  if (t) out.push(t);
  return out.filter(Boolean);
}

/**
 * Normalize an object-literal type `{ k1: T1; k2: T2; ... }`.
 * Members are sorted by key name so `{ y: number; x: number }` and
 * `{ x: number; y: number }` canonicalize to the same string.
 * Property names are identifiers — they are NOT rejected as prose.
 * Value types are normalized recursively via normType (handles unions, etc.).
 * Returns null if any member is not normalizable.
 */
function normObjLit(s) {
  const inner = s.slice(1, -1).trim();
  if (!inner) return '{}';
  const members = splitDeep(inner, ';');
  const out = [];
  for (const member of members) {
    const ci = colonAt0(member);
    if (ci < 0) return null;                    // no colon → not a valid k:T member
    const key    = member.slice(0, ci).trim();
    const valRaw = member.slice(ci + 1).trim();
    // key must be a plain identifier, optionally ending with `?` (optional prop)
    if (!/^[A-Za-z_$][\w$]*\??$/.test(key)) return null;
    const valNorm = normType(valRaw);           // recursive — handles nested unions
    if (valNorm === null) return null;
    out.push({ sort: key.replace('?', ''), key, val: valNorm });
  }
  out.sort((a, b) => a.sort.localeCompare(b.sort));
  return '{ ' + out.map((m) => `${m.key}: ${m.val}`).join('; ') + ' }';
}

/**
 * Normalize a function type `(p1: T1, p2: T2) => R`.
 * Param names are kept (they are identifiers, not prose — do not reject).
 * Their types and the return type are normalized recursively via normType.
 * `closeIdx` is the already-located index of the `)` that closes the param
 * list — pre-computed by normTypePart so we do not re-scan.
 * Returns null if any sub-type is not normalizable.
 */
function normFnType(s, closeIdx) {
  const paramsStr = s.slice(1, closeIdx);
  const retStr    = s.slice(closeIdx + 1).trimStart().slice(2).trim(); // strip '=>'
  let paramsPart  = '';
  if (paramsStr.trim()) {
    const parts = splitDeep(paramsStr, ',').map((p) => {
      const ci = colonAt0(p);
      if (ci >= 0) {
        const name    = p.slice(0, ci).trim();
        const typeStr = p.slice(ci + 1).trim();
        if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null; // invalid param name
        const tn = normType(typeStr);
        return tn === null ? null : `${name}: ${tn}`;
      }
      return normType(p.trim()); // unnamed param — just normalize the type
    });
    if (parts.some((p) => p === null)) return null;
    paramsPart = parts.join(', ');
  }
  const retNorm = normType(retStr);
  if (retNorm === null) return null;
  return `(${paramsPart}) => ${retNorm}`;
}

/**
 * Normalize a single (non-union) type fragment.  Handles:
 *   T[]          array suffix — recurse on element type
 *   { k: T }     object-literal — normObjLit (members sorted)
 *   (p: T) => R  function type  — normFnType
 *   Foo<T, U>    named generic  — recurse on each arg via normType
 *   simple       existing char + word check; collapse whitespace
 * Returns null when the fragment is prose (not safely comparable).
 */
function normTypePart(s) {
  s = (s || '').trim();
  if (!s) return null;

  // Array suffix — normalize the element type and re-attach `[]`
  if (s.endsWith('[]')) {
    const elem = normTypePart(s.slice(0, -2).trim());
    return elem === null ? null : `${elem}[]`;
  }

  // Object-literal type `{ k: T; ... }`
  if (s[0] === '{' && s[s.length - 1] === '}') return normObjLit(s);

  // Function type `(params) => ReturnType` — locate the closing `)` then check for `=>`
  if (s[0] === '(') {
    let depth = 0, closeIdx = -1;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '(') depth++;
      else if (s[i] === ')') { if (--depth === 0) { closeIdx = i; break; } }
    }
    if (closeIdx >= 0 && s.slice(closeIdx + 1).trimStart().startsWith('=>'))
      return normFnType(s, closeIdx);
    // parenthesized type — fall through to simple check
  }

  // Named generic `Foo<T, U>` — args may themselves be complex types.
  // Each arg is normalized via normType (which sorts unions, handles obj-lits, etc.)
  const ltIdx = s.indexOf('<');
  if (ltIdx > 0 && s[s.length - 1] === '>') {
    const name = s.slice(0, ltIdx);
    if (/^[A-Za-z_$][\w$]*$/.test(name) &&
        (LIB_TYPES.has(name) || /^[A-Z]/.test(name))) {
      const argsStr  = s.slice(ltIdx + 1, -1);
      const args     = splitDeep(argsStr, ',');
      const normArgs = args.map((a) => normType(a.trim()));
      if (normArgs.some((a) => a === null)) return null;
      return `${name}<${normArgs.join(', ')}>`;
    }
  }

  // String-literal type `'value'` (single-quoted, no inner single quotes).
  // Unions of string literals (e.g. `'v' | 'h'`) are handled at the normType
  // level via splitUnion; here we just canonicalize each individual member.
  if (s[0] === "'") {
    if (s[s.length - 1] === "'" && s.length >= 2 && !s.slice(1, -1).includes("'"))
      return s; // canonical as-is — both spec and extractor use the TS source text
    return null; // malformed string literal → prose
  }

  // Simple / keyword type — existing char-level + word-level validation
  if (!/^[A-Za-z0-9_$ ,.<>\[\]|&]+$/.test(s)) return null;
  const words = s.match(WORD_RE) || [];
  for (const w of words) {
    if (PRIMITIVES.has(w) || LIB_TYPES.has(w)) continue;
    if (/^[A-Z]/.test(w)) continue; // PascalCase → a real (possibly app) type
    return null;                     // lowercase non-primitive word → prose
  }
  return s.replace(/\s+/g, ' ');
}
// =====================================================================
// end A6 structural type helpers
// =====================================================================

/**
 * A "clean" type string can be emitted as a TS type verbatim and is safely
 * comparable.  Now delegates to normType: any type that normalizes to a
 * non-null value is clean — this covers simple types, object-literals,
 * function types, generics, and unions thereof.
 * Lowercase non-primitive words in simple/generic positions are still prose.
 */
export function isCleanType(raw) {
  const s = (raw || '').trim();
  return Boolean(s) && normType(s) !== null;
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

/**
 * Normalized form of a type string if it is "clean" (safely comparable), else
 * null (prose — not gatable). null means "documented hole": the gate skips it
 * and reports a count, never a false-positive mismatch.
 *
 * A6 extension: now handles object-literal types (members sorted by key for
 * order-independence) and function types (whitespace canonicalized, return type
 * recursively normalized), in addition to the previous simple/generic/union
 * support.
 *
 * Canonicalization rules:
 *   • Whitespace collapsed everywhere
 *   • Union members sorted alphabetically (so `B | A` === `A | B`)
 *   • `undefined` stripped from unions (spec writes `T` and `T | undefined`
 *     inconsistently for optional params — both compare equal to `T`)
 *   • Object-literal members sorted by key name
 */
export function normType(raw) {
  const s = (raw || '').trim();
  if (!s) return null;

  // Split on union `|` at all-brackets depth 0.  splitUnion (unlike the old
  // splitTopLevel) also tracks `{}`, so `|` inside `{ color: string | null }`
  // is NOT treated as a top-level union separator.
  const parts = splitUnion(s);
  if (parts.length > 1) {
    const normParts = parts.map((p) => normTypePart(p));
    if (normParts.some((p) => p === null)) return null;
    // optionality: `T | undefined` === bare `T` (spec inconsistency)
    let filtered = normParts.filter((p) => p !== 'undefined');
    if (filtered.length === 0) return 'undefined';
    if (filtered.length === 1) return filtered[0];
    return [...new Set(filtered)].sort().join(' | ');
  }

  // Single (non-union) type — delegate to the structural normalizer
  return normTypePart(s);
}

/** The gatable return type of a returns[]: 'void', a clean type, or null (prose). */
export function returnTypeOf(returns) {
  const arr = (returns || []).map((s) => s.trim()).filter(Boolean);
  if (!arr.length || arr.every((x) => x === 'void')) return 'void';
  if (arr.length === 1) return normType(arr[0]);
  return null; // a union spread across entries — treat as prose, do not gate
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
    const params = ifaceParams(iface.accepts);
    const arity = params.length;
    const rv = returnsValue(iface.returns);
    const paramTypes = params.map((p) => normType(p.type));   // per-param clean type or null
    const returnType = returnTypeOf(iface.returns);            // clean return type, 'void', or null
    if (name) members.push({ name, arity, returnsValue: rv, paramTypes, returnType });
    else if (iface.accepts?.length || iface.returns?.length) {
      // a nameless interface = the unit's primary callable; the extractor
      // sees it as the exported function named after the node.
      const fnKinds = node?.kind === 'function' || node?.kind === 'hook' || node?.kind === 'module';
      members.push({ name: fnKinds ? primary : '__call', arity, returnsValue: rv, paramTypes, returnType });
    }
  }
  members.sort((a, b) => a.name.localeCompare(b.name));
  return { id, kind: node?.kind ?? null, parent: gateParent(model, id), members };
}

/**
 * The parent that is gated: a drill-in parent (%% parent -> real code
 * containment) only. Subgraph/group membership is a same-level layout
 * concept with no code counterpart, so it is NOT a gated parent.
 *
 * Walks through group (subgraph) parents to find the first non-group
 * ancestor — mirroring containerOf in flowmap-lint.mjs. This ensures
 * leaves nested inside section subgraphs resolve to their real container
 * instead of returning null (which caused false parent-mismatch drift).
 */
export function gateParent(model, id) {
  let cur = model.nodes?.[id]?.parent ?? null;
  const seen = new Set();
  while (cur && model.nodes?.[cur] && !seen.has(cur)) {
    seen.add(cur);
    if (!model.groups?.has(cur)) return cur;
    cur = model.nodes[cur].parent ?? null;
  }
  return null;
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
