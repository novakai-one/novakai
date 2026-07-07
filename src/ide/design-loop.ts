/* =====================================================================
   design-loop.ts — K5 Design tab: contract review loop, pure logic
   ---------------------------------------------------------------------
   Responsibility: RFC 6901 JSON Pointer resolution against a drafted
   contract, the pointer groups a human reviews, the keep/change review
   state machine, carrying kept decisions forward across contract
   re-drafts, and sealing an outcome. No DOM (mirrors design-model.ts:
   data + pure helpers only).
   ===================================================================== */

export type ReviewAction = 'keep' | 'change';

export interface ReviewEntry {
  state: 'kept' | 'change';
  comment?: string;
}

/** key = JSON Pointer (RFC 6901) into the contract. */
export type ReviewState = Record<string, ReviewEntry>;

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function escapeToken(token: string): string {
  return token.replace(/~/g, '~0').replace(/\//g, '~1');
}

function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate);
}

/** RFC 6901 resolution: "" is the whole document; otherwise each `/`
    segment unescapes `~1`→`/` then `~0`→`~` before lookup. Array
    segments must be a valid in-range index. Anything unresolvable
    (missing key, out-of-range index, descending into a scalar) yields
    `undefined` rather than throwing. */
export function resolvePointer(contract: unknown, pointer: string): unknown {
  if (pointer === '') return contract;
  if (!pointer.startsWith('/')) return undefined;
  const tokens = pointer.split('/').slice(1).map(unescapeToken);
  let cursor: unknown = contract;
  for (const token of tokens) {
    if (Array.isArray(cursor)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= cursor.length) return undefined;
      cursor = cursor[index];
    } else if (isPlainObject(cursor)) {
      if (!Object.prototype.hasOwnProperty.call(cursor, token)) return undefined;
      cursor = cursor[token];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/** The subset of `pointers` (original order) that do not resolve. */
export function lintPointers(pointers: readonly string[], contract: unknown): string[] {
  return pointers.filter((pointer) => resolvePointer(contract, pointer) === undefined);
}

/** Second-level review pointers: one per top-level key, expanded one
    level deeper when that key's value is a plain object (one pointer
    per child key), left as the section pointer itself when it is an
    array or scalar. Key order follows the contract's own order. */
export function reviewGroups(contract: unknown): string[] {
  if (!isPlainObject(contract)) return [];
  const groups: string[] = [];
  for (const sectionKey of Object.keys(contract)) {
    const sectionValue = contract[sectionKey];
    const sectionPointer = `/${escapeToken(sectionKey)}`;
    if (isPlainObject(sectionValue)) {
      for (const childKey of Object.keys(sectionValue)) {
        groups.push(`${sectionPointer}/${escapeToken(childKey)}`);
      }
    } else {
      groups.push(sectionPointer);
    }
  }
  return groups;
}

/** The longest entry in `groups` that is a whole-segment prefix of
    `pointer` (an exact match counts); `null` when none match. Segment
    comparison rejects same-string-prefix-but-different-segment cases
    such as "/tokens/color" vs "/tokens/colorX". */
export function groupOf(pointer: string, groups: readonly string[]): string | null {
  const pointerTokens = pointer.split('/');
  let best: string | null = null;
  let bestLength = -1;
  for (const group of groups) {
    const groupTokens = group.split('/');
    if (groupTokens.length > pointerTokens.length) continue;
    const isPrefix = groupTokens.every((token, idx) => token === pointerTokens[idx]);
    if (isPrefix && groupTokens.length > bestLength) {
      best = group;
      bestLength = groupTokens.length;
    }
  }
  return best;
}

const KEPT: ReviewEntry['state'] = 'kept';
const CHANGED: ReviewEntry['state'] = 'change';

/** 'keep' always records `{ state: 'kept' }` (no comment field).
    'change' with a non-empty comment records `{ state: 'change',
    comment }`; an empty comment on 'change' is a no-op — the input
    state is returned unchanged. */
export function reviewMark(state: ReviewState, pointer: string, action: ReviewAction, comment: string): ReviewState {
  if (action === 'keep') return { ...state, [pointer]: { state: KEPT } };
  if (comment === '') return state;
  return { ...state, [pointer]: { state: CHANGED, comment } };
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, idx) => deepEqual(item, right[idx]));
  }
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

/** Keeps an entry only when it was 'kept' AND its pointer still
    resolves in `nextContract` AND the resolved value is unchanged
    (deep-equal) between the previous and next contract. Everything
    else — 'change' entries, changed values, vanished pointers — is
    dropped. */
export function carryForward(prev: ReviewState, prevContract: unknown, nextContract: unknown): ReviewState {
  const next: ReviewState = {};
  for (const [pointer, entry] of Object.entries(prev)) {
    if (entry.state !== KEPT) continue;
    const nextValue = resolvePointer(nextContract, pointer);
    if (nextValue === undefined) continue;
    const prevValue = resolvePointer(prevContract, pointer);
    if (deepEqual(prevValue, nextValue)) next[pointer] = { state: KEPT };
  }
  return next;
}

/** `{ pointer, comment }` for every 'change' entry, insertion order. */
export function changesPayload(state: ReviewState): { pointer: string; comment: string }[] {
  return Object.entries(state)
    .filter(([, entry]) => entry.state === CHANGED)
    .map(([pointer, entry]) => ({ pointer, comment: entry.comment ?? '' }));
}

function pathIntersectsKept(pathTokens: readonly string[], keptTokenLists: readonly string[][]): boolean {
  return keptTokenLists.some((keptTokens) => {
    const shorter = keptTokens.length <= pathTokens.length ? keptTokens : pathTokens;
    const longer = keptTokens.length <= pathTokens.length ? pathTokens : keptTokens;
    return shorter.every((token, idx) => token === longer[idx]);
  });
}

/** Reorders one object level: keys whose subtree intersects a kept
    pointer come first (original relative order), then untouched keys
    (original relative order); recurses into nested plain objects only
    — arrays are returned as-is, never reordered or descended into. */
function reorderLevel(value: unknown, pathTokens: readonly string[], keptTokenLists: readonly string[][]): unknown {
  if (!isPlainObject(value)) return value;
  const keys = Object.keys(value);
  const intersecting = keys.filter((key) => pathIntersectsKept([...pathTokens, escapeToken(key)], keptTokenLists));
  const untouched = keys.filter((key) => !intersecting.includes(key));
  const result: Record<string, unknown> = {};
  for (const key of [...intersecting, ...untouched]) {
    result[key] = reorderLevel(value[key], [...pathTokens, escapeToken(key)], keptTokenLists);
  }
  return result;
}

/** Serializes `{ attested: kept, ...contract }` where `attested` is the
    kept pointers in the given order, and every object level of the
    contract is reordered so subtrees touched by a kept pointer sort
    first. Byte-exact `JSON.stringify` — no added spacing. */
export function sealOutcome(contract: unknown, kept: readonly string[]): string {
  const keptTokenLists = kept.map((pointer) => (pointer === '' ? [] : pointer.split('/').slice(1)));
  const reordered = reorderLevel(contract, [], keptTokenLists);
  const sealed: Record<string, unknown> = { attested: [...kept] };
  if (isPlainObject(reordered)) {
    for (const key of Object.keys(reordered)) sealed[key] = reordered[key];
  }
  return JSON.stringify(sealed);
}
