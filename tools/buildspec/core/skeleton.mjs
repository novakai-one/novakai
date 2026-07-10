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

/** Bracket-depth helpers shared by the split/colonAt0 family below. */
function isOpenBracket(char) {
  return char === '<' || char === '(' || char === '[';
}
function isCloseBracket(char) {
  return char === '>' || char === ')' || char === ']';
}
function isOpenBracketAll(char) {
  return isOpenBracket(char) || char === '{';
}
function isCloseBracketAll(char) {
  return isCloseBracket(char) || char === '}';
}

/** Split on a separator at bracket depth 0 (respects <> () []). */
export function splitTopLevel(str, sep = ',') {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const char of str) {
    if (isOpenBracket(char)) depth++;
    else if (isCloseBracket(char)) depth = Math.max(0, depth - 1);
    if (char === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += char;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((segment) => segment.trim()).filter(Boolean);
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

/** Push `value.trim()` onto `out` unless it trims to empty. */
function pushIfNonEmpty(out, value) {
  const trimmed = value.trim();
  if (trimmed) out.push(trimmed);
}

/**
 * Split `str` on `sep` at bracket depth 0, tracking ALL bracket pairs including
 * `{}`. Trailing/empty segments are dropped.  Used for object members (`;`)
 * and function params (`,`) where values may contain nested `{}` or `<>`.
 */
function splitDeep(str, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const char of str) {
    if (isOpenBracketAll(char)) depth++;
    else if (isCloseBracketAll(char)) depth = Math.max(0, depth - 1);
    if (char === sep && depth === 0) {
      pushIfNonEmpty(out, cur);
      cur = '';
    } else {
      cur += char;
    }
  }
  pushIfNonEmpty(out, cur);
  return out;
}

/**
 * Index of the first `:` at all-brackets depth 0 in `str`.
 * Returns -1 when not found.  Used to split `key: Type` members where the
 * type part may contain `:` inside generics or function types.
 */
function colonAt0(str) {
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (isOpenBracketAll(char)) depth++;
    else if (isCloseBracketAll(char)) depth--;
    else if (char === ':' && depth === 0) return i;
  }
  return -1;
}

/**
 * Split a union type string on `|` at all-brackets depth 0.
 * Same bracket tracking as splitDeep (including `{}`), so that
 * `{ color: string | null }` is NOT split at the `|` inside the braces.
 */
function splitUnion(str) {
  return splitDeep(str, '|');
}

/** Normalize one `key: Type` member of an object-literal type, or null if invalid. */
function normObjMember(member) {
  const colonIdx = colonAt0(member);
  if (colonIdx < 0) return null;                    // no colon → not a valid k:T member
  const key = member.slice(0, colonIdx).trim();
  const valueRaw = member.slice(colonIdx + 1).trim();
  // key must be a plain identifier, optionally ending with `?` (optional prop)
  if (!/^[A-Za-z_$][\w$]*\??$/.test(key)) return null;
  const valueNorm = normType(valueRaw);              // recursive — handles nested unions
  if (valueNorm === null) return null;
  return { sort: key.replace('?', ''), key, val: valueNorm };
}

/**
 * Normalize an object-literal type `{ k1: T1; k2: T2; ... }`.
 * Members are sorted by key name so `{ y: number; x: number }` and
 * `{ x: number; y: number }` canonicalize to the same string.
 * Property names are identifiers — they are NOT rejected as prose.
 * Value types are normalized recursively via normType (handles unions, etc.).
 * Returns null if any member is not normalizable.
 */
function normObjLit(str) {
  const inner = str.slice(1, -1).trim();
  if (!inner) return '{}';
  const out = [];
  for (const member of splitDeep(inner, ';')) {
    const normalized = normObjMember(member);
    if (normalized === null) return null;
    out.push(normalized);
  }
  out.sort((left, right) => left.sort.localeCompare(right.sort));
  return '{ ' + out.map((entry) => `${entry.key}: ${entry.val}`).join('; ') + ' }';
}

/** Normalize one parameter piece `name: Type` (or a bare `Type`) of a function type. */
function normFnParam(piece) {
  const colonIdx = colonAt0(piece);
  if (colonIdx < 0) return normType(piece.trim()); // unnamed param — just normalize the type
  const name = piece.slice(0, colonIdx).trim();
  const typeStr = piece.slice(colonIdx + 1).trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null; // invalid param name
  const typeNorm = normType(typeStr);
  return typeNorm === null ? null : `${name}: ${typeNorm}`;
}

/**
 * Normalize a function type `(p1: T1, p2: T2) => R`.
 * Param names are kept (they are identifiers, not prose — do not reject).
 * Their types and the return type are normalized recursively via normType.
 * `closeIdx` is the already-located index of the `)` that closes the param
 * list — pre-computed by normTypePart so we do not re-scan.
 * Returns null if any sub-type is not normalizable.
 */
function normFnType(str, closeIdx) {
  const paramsStr = str.slice(1, closeIdx);
  const retStr = str.slice(closeIdx + 1).trimStart().slice(2).trim(); // strip '=>'
  let paramsPart = '';
  if (paramsStr.trim()) {
    const parts = splitDeep(paramsStr, ',').map(normFnParam);
    if (parts.some((part) => part === null)) return null;
    paramsPart = parts.join(', ');
  }
  const retNorm = normType(retStr);
  if (retNorm === null) return null;
  return `(${paramsPart}) => ${retNorm}`;
}

/** Array-suffix candidate `T[]` for normTypePart. undefined = not this shape. */
function normArraySuffix(str) {
  if (!str.endsWith('[]')) return undefined;
  const elem = normTypePart(str.slice(0, -2).trim());
  return elem === null ? null : `${elem}[]`;
}

/** Function-type candidate `(params) => R` for normTypePart. undefined = not this shape. */
function normFunctionTypeCandidate(str) {
  if (str[0] !== '(') return undefined;
  let depth = 0;
  let closeIdx = -1;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '(') {
      depth++;
    } else if (str[i] === ')') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  const hasArrow = closeIdx >= 0 && str.slice(closeIdx + 1).trimStart().startsWith('=>');
  return hasArrow ? normFnType(str, closeIdx) : undefined;
}

/**
 * Named-generic candidate `Foo<T, U>` for normTypePart. undefined = not this
 * shape. Args may themselves be complex types — each is normalized via
 * normType (which sorts unions, handles obj-lits, etc.).
 */
function normGenericCandidate(str) {
  const ltIdx = str.indexOf('<');
  if (ltIdx <= 0 || str[str.length - 1] !== '>') return undefined;
  const name = str.slice(0, ltIdx);
  const validName = /^[A-Za-z_$][\w$]*$/.test(name) && (LIB_TYPES.has(name) || /^[A-Z]/.test(name));
  if (!validName) return undefined;
  const args = splitDeep(str.slice(ltIdx + 1, -1), ',');
  const normArgs = args.map((arg) => normType(arg.trim()));
  if (normArgs.some((arg) => arg === null)) return null;
  return `${name}<${normArgs.join(', ')}>`;
}

/**
 * String-literal candidate `'value'` for normTypePart (single-quoted, no
 * inner single quotes). Unions of string literals (e.g. `'v' | 'h'`) are
 * handled at the normType level via splitUnion; here we just canonicalize
 * each individual member. Terminal: a leading `'` never falls through.
 */
function normStringLiteral(str) {
  if (str[0] !== "'") return undefined;
  const closesCleanly = str[str.length - 1] === "'" && str.length >= 2 && !str.slice(1, -1).includes("'");
  return closesCleanly ? str : null; // canonical as-is, or malformed → prose
}

/** Simple / keyword type — char-level + word-level validation. */
function normSimpleType(str) {
  if (!/^[A-Za-z0-9_$ ,.<>\[\]|&]+$/.test(str)) return null;
  const words = str.match(WORD_RE) || [];
  for (const word of words) {
    if (PRIMITIVES.has(word) || LIB_TYPES.has(word)) continue;
    if (/^[A-Z]/.test(word)) continue; // PascalCase → a real (possibly app) type
    return null;                       // lowercase non-primitive word → prose
  }
  return str.replace(/\s+/g, ' ');
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
function normTypePart(raw) {
  const str = (raw || '').trim();
  if (!str) return null;

  const array = normArraySuffix(str);
  if (array !== undefined) return array;

  // Object-literal type `{ k: T; ... }`
  if (str[0] === '{' && str[str.length - 1] === '}') return normObjLit(str);

  const fnType = normFunctionTypeCandidate(str);
  if (fnType !== undefined) return fnType;

  const generic = normGenericCandidate(str);
  if (generic !== undefined) return generic;

  const literal = normStringLiteral(str);
  if (literal !== undefined) return literal;

  return normSimpleType(str);
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
  const trimmed = (raw || '').trim();
  return Boolean(trimmed) && normType(trimmed) !== null;
}

/** PascalCase identifier heads in a clean type that need a declaration. */
export function appTypeNames(raw) {
  const out = [];
  for (const word of (raw.match(WORD_RE) || [])) {
    if (PRIMITIVES.has(word) || LIB_TYPES.has(word)) continue;
    if (/^[A-Z]/.test(word)) out.push(word);
  }
  return out;
}

/** Parse one "name: Type" piece. name is '' when absent/invalid. */
export function parseParamPiece(piece) {
  const trimmed = piece.trim();
  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    // whole thing is the type; no explicit name
    return { name: '', type: trimmed };
  }
  const name = trimmed.slice(0, colon).trim();
  const type = trimmed.slice(colon + 1).trim();
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
  const cleaned = (returns || []).map((entry) => entry.trim()).filter(Boolean);
  if (!cleaned.length) return false;
  return !cleaned.every((x) => x === 'void');
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
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  // Split on union `|` at all-brackets depth 0.  splitUnion (unlike the old
  // splitTopLevel) also tracks `{}`, so `|` inside `{ color: string | null }`
  // is NOT treated as a top-level union separator.
  const parts = splitUnion(trimmed);
  if (parts.length > 1) {
    const normParts = parts.map((part) => normTypePart(part));
    if (normParts.some((part) => part === null)) return null;
    // optionality: `T | undefined` === bare `T` (spec inconsistency)
    let filtered = normParts.filter((part) => part !== 'undefined');
    if (filtered.length === 0) return 'undefined';
    if (filtered.length === 1) return filtered[0];
    return [...new Set(filtered)].sort().join(' | ');
  }

  // Single (non-union) type — delegate to the structural normalizer
  return normTypePart(trimmed);
}

/** The gatable return type of a returns[]: 'void', a clean type, or null (prose). */
export function returnTypeOf(returns) {
  const arr = (returns || []).map((entry) => entry.trim()).filter(Boolean);
  if (!arr.length || arr.every((x) => x === 'void')) return 'void';
  if (arr.length === 1) return normType(arr[0]);
  return null; // a union spread across entries — treat as prose, do not gate
}

const _isIdent = (value) => typeof value === 'string' && /^[A-Za-z_$][\w$]*$/.test(value);

/** True when `kind` is one of the "callable" kinds (fn/hook/module). */
function isCallableKind(kind) {
  return kind === 'function' || kind === 'hook' || kind === 'module';
}

/** Build one skeleton member from a fm interface entry, or null to skip it. */
function buildSkeletonMember(iface, node, primary) {
  const name = (iface.name || '').trim();
  const params = ifaceParams(iface.accepts);
  const returns = returnsValue(iface.returns);
  const paramTypes = params.map((param) => normType(param.type)); // per-param clean type or null
  const returnType = returnTypeOf(iface.returns);                 // clean return type, 'void', or null
  const base = { arity: params.length, returnsValue: returns, paramTypes, returnType };
  if (name) return { name, ...base };
  const hasSignature = iface.accepts?.length || iface.returns?.length;
  if (!hasSignature) return null;
  // a nameless interface = the unit's primary callable; the extractor
  // sees it as the exported function named after the node.
  const fnKinds = isCallableKind(node?.kind);
  return { name: fnKinds ? primary : '__call', ...base };
}

/** Spec-side skeleton for one node id. */
export function specSkeleton(model, id) {
  const node = model.nodes[id];
  const frontmatter = model.fm?.[id] || { interfaces: [], state: [] };
  const primary = _isIdent(frontmatter.name) ? frontmatter.name : id;
  const members = [];
  for (const iface of frontmatter.interfaces || []) {
    const member = buildSkeletonMember(iface, node, primary);
    if (member) members.push(member);
  }
  members.sort((left, right) => left.name.localeCompare(right.name));
  return { id, kind: node?.kind ?? null, parent: gateParent(model, id), members };
}

/** The immediate parent id of `id`, or null. */
function parentOf(model, id) {
  return model.nodes?.[id]?.parent ?? null;
}

/**
 * The parent that is gated: a drill-in parent (%% parent -> real code
 * containment) only. Subgraph/group membership is a same-level layout
 * concept with no code counterpart, so it is NOT a gated parent.
 *
 * Walks through group (subgraph) parents to find the first non-group
 * ancestor — mirroring containerOf in novakai-lint.mjs. This ensures
 * leaves nested inside section subgraphs resolve to their real container
 * instead of returning null (which caused false parent-mismatch drift).
 */
export function gateParent(model, id) {
  let cur = parentOf(model, id);
  const seen = new Set();
  while (cur && model.nodes?.[cur] && !seen.has(cur)) {
    seen.add(cur);
    if (!model.groups?.has(cur)) return cur;
    cur = parentOf(model, cur);
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
