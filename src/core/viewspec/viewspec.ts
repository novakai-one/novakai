/* =====================================================================
   viewspec.ts — the M3 ViewSpec contract (pure)
   ---------------------------------------------------------------------
   Responsibility: ONE serializable spec object is the reading view —
   screen = render(spec). Checkboxes today and an LLM in phase 2 write
   the same JSON (the approved v3 "stage" doctrine, decision #6). The
   spec determines WHAT is on screen; animation infrastructure decides
   only HOW it transitions and the viewport transform only WHERE it sits
   — both deliberately live outside this contract
   (docs/novakai/m3-viewspec-design.md §2).

   normalizeViewSpec is the schema boundary (tolerant, field-by-field,
   idempotent on a valid spec); reduceView is the only mutation path —
   a pure reducer over a closed action vocabulary that returns a NEW
   spec and never mutates its (possibly frozen) input.

   Pure module: types + pure helpers only. No DOM, no imports.
   ===================================================================== */

/** The reading-view contract. Plain JSON values only — no Sets, no
    functions — so the object round-trips storage and an LLM can emit it. */
export interface ViewSpec {
  /** schema version; a bump is detectable, never guessed */
  v: 1;
  /** containers unfolded in place */
  expanded: string[];
  /** ids removed from the canvas */
  hidden: string[];
  /** reveal layers: calls/deps/desc/iface/metrics/color/trust/blast */
  layers: Record<string, boolean>;
  /** selected node or group */
  sel: string | null;
  /** secondary peek selection — a lightweight highlight that never displaces sel */
  sel2: string | null;
  /** selected wire, keyed by its rendered rep pair */
  selWire: { a: string; b: string } | null;
  /** browse-tree filter text */
  query: string;
  /** staged container (the second projection) */
  stage: string | null;
  /** type-focus token */
  focusType: string | null;
  /** inspector frontmatter editor open */
  fmOpen: boolean;
}

/** The closed set of view mutations. Every interaction is one of these. */
export type ViewAction =
  | { type: 'toggleExpand'; id: string }
  | { type: 'reveal'; id: string }
  | { type: 'hide'; id: string }
  | { type: 'select'; id: string | null }
  | { type: 'selectPeek'; id: string | null }
  | { type: 'selectWire'; a: string; b: string }
  | { type: 'focusType'; t: string | null }
  | { type: 'setStage'; id: string | null }
  | { type: 'toggleLayer'; key: string }
  | { type: 'setQuery'; q: string }
  | { type: 'setFmOpen'; open: boolean }
  | { type: 'foldAll' };

/** Plain-data containment slice the reducer consults — JSON-expressible
    so acceptance cases can carry a whole model as literal args. */
export interface ViewModelIndex {
  parents: Record<string, string | null>;
  children: Record<string, string[]>;
  roots: string[];
}

const LAYER_KEYS = ['calls', 'deps', 'desc', 'iface', 'metrics', 'color', 'trust', 'blast'];

/** The fresh-view spec: fully folded, nothing hidden or selected, and the
    calls layer ON — wires are the story, never an opt-in (decision #1). */
export function emptyViewSpec(): ViewSpec {
  const layers: Record<string, boolean> = {};
  for (const k of LAYER_KEYS) layers[k] = k === 'calls';
  return {
    'v': 1, expanded: [], hidden: [], layers,
    sel: null, sel2: null, selWire: null, query: '', stage: null, focusType: null, fmOpen: false,
  };
}

const strOrNull = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const idList = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === 'string' && !!i))] : [];

/** Coerces the raw selWire field into a valid pair or null — both
    endpoints must be present strings, else the selection is dropped. */
function coerceSelWire(raw: unknown): { a: string; b: string } | null {
  const wire = raw as { a?: unknown; b?: unknown } | null | undefined;
  const wireA = wire && typeof wire === 'object' ? strOrNull(wire.a) : null;
  const wireB = wire && typeof wire === 'object' ? strOrNull(wire.b) : null;
  return wireA && wireB ? { 'a': wireA, 'b': wireB } : null;
}

/** Merges stored layer prefs over the fresh-view default, in place. */
function applyStoredLayers(layers: Record<string, boolean>, rawLayers: unknown): void {
  if (!rawLayers || typeof rawLayers !== 'object') return;
  const stored = rawLayers as Record<string, unknown>;
  for (const k of LAYER_KEYS) layers[k] = !!stored[k];
}

/** Coerces every scalar/pair field of the spec from the raw JSON, in place. */
function applyScalarFields(out: ViewSpec, fields: Record<string, unknown>): void {
  out.sel = strOrNull(fields.sel);
  out.sel2 = strOrNull(fields.sel2);
  out.selWire = coerceSelWire(fields.selWire);
  out.query = typeof fields.query === 'string' ? fields.query : '';
  out.stage = strOrNull(fields.stage);
  out.focusType = strOrNull(fields.focusType);
  out.fmOpen = !!fields.fmOpen;
}

/** Confines a coerced spec to a real model: expanded/hidden filtered,
    sel/stage nulled when unknown, selWire nulled when either endpoint is
    unknown (focusType is a type token, not an id — it survives). */
function confineToKnown(out: ViewSpec, known: string[]): void {
  const allowed = new Set(known);
  out.expanded = out.expanded.filter((id) => allowed.has(id));
  out.hidden = out.hidden.filter((id) => allowed.has(id));
  if (out.sel && !allowed.has(out.sel)) out.sel = null;
  if (out.sel2 && !allowed.has(out.sel2)) out.sel2 = null;
  if (out.stage && !allowed.has(out.stage)) out.stage = null;
  if (out.selWire && (!allowed.has(out.selWire.a) || !allowed.has(out.selWire.b))) out.selWire = null;
}

/** Tolerant schema boundary. Coerces unknown JSON — a full v1 spec, the
    legacy {expanded,hidden,layers} localStorage shape (a strict subset,
    so migration is branch-free), or garbage — into a valid ViewSpec,
    field by field. When `known` is given the spec is confined to a real
    model (see confineToKnown). Idempotent on a valid spec. */
export function normalizeViewSpec(raw: unknown, known?: string[] | null): ViewSpec {
  const fields = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = emptyViewSpec();
  out.expanded = idList(fields.expanded);
  out.hidden = idList(fields.hidden);
  applyStoredLayers(out.layers, fields.layers);
  applyScalarFields(out, fields);
  if (known) confineToKnown(out, known);
  return out;
}

/* ---- containment walks over the plain model (cycle-safe) ---- */
function ancestorChain(id: string, model: ViewModelIndex): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur != null && !seen.has(cur) && cur in model.parents) {
    seen.add(cur);
    chain.push(cur);
    cur = model.parents[cur];
  }
  return chain;
}
function descendants(id: string, model: ViewModelIndex, acc: string[] = []): string[] {
  for (const child of model.children[id] ?? []) {
    if (acc.includes(child)) continue;
    acc.push(child);
    descendants(child, model, acc);
  }
  return acc;
}
function isRendered(id: string, spec: ViewSpec, model: ViewModelIndex): boolean {
  const chain = ancestorChain(id, model);
  if (!chain.length) return false;
  for (let i = 0; i < chain.length; i++) {
    if (spec.hidden.includes(chain[i])) return false;
    if (i > 0 && !spec.expanded.includes(chain[i])) return false;
  }
  return true;
}
function visibleRep(id: string, spec: ViewSpec, model: ViewModelIndex): string | null {
  for (const anc of ancestorChain(id, model)) if (isRendered(anc, spec, model)) return anc;
  return null;
}
/** A selected wire is keyed to its rendered rep pair — after a structural
    change, a wire whose endpoints are no longer their own visible reps is
    dropped (this rule used to run inside unfold's render(), a render-time
    state write; the reducer owns it now). */
function dropStaleWire(spec: ViewSpec, model: ViewModelIndex): void {
  if (!spec.selWire || spec.stage) return;
  const { 'a': wireA, 'b': wireB } = spec.selWire;
  if (visibleRep(wireA, spec, model) !== wireA || visibleRep(wireB, spec, model) !== wireB) spec.selWire = null;
}

const clone = (spec: ViewSpec): ViewSpec => ({
  ...spec,
  expanded: [...spec.expanded],
  hidden: [...spec.hidden],
  layers: { ...spec.layers },
  selWire: spec.selWire ? { ...spec.selWire } : null,
});

/* ---- one handler per action, so each stays small and independently
   readable; reduceView itself is just a dispatch (see HANDLERS below). ---- */

function handleToggleExpand(next: ViewSpec, action: ViewAction, model: ViewModelIndex): void {
  if (action.type !== 'toggleExpand') return;
  if (!(model.children[action.id] ?? []).length) return;
  if (next.expanded.includes(action.id)) {
    const fold = new Set([action.id, ...descendants(action.id, model)]);
    next.expanded = next.expanded.filter((id) => !fold.has(id));
  } else next.expanded.push(action.id);
  dropStaleWire(next, model);
}

function handleReveal(next: ViewSpec, action: ViewAction, model: ViewModelIndex): void {
  if (action.type !== 'reveal') return;
  const chain = ancestorChain(action.id, model);
  next.hidden = next.hidden.filter((id) => !chain.includes(id));
  for (const anc of chain.slice(1)) if (!next.expanded.includes(anc)) next.expanded.push(anc);
  dropStaleWire(next, model);
}

function handleHide(next: ViewSpec, action: ViewAction, model: ViewModelIndex): void {
  if (action.type !== 'hide') return;
  const visRoots = model.roots.filter((root) => !next.hidden.includes(root));
  if (model.roots.includes(action.id) && visRoots.length <= 1) return;
  if (!next.hidden.includes(action.id)) next.hidden.push(action.id);
  if (next.sel === action.id) next.sel = null;
  if (next.sel2 === action.id) next.sel2 = null;
  dropStaleWire(next, model);
}

function handleSelect(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'select') return;
  next.sel = action.id !== null && next.sel === action.id ? null : action.id;
  next.sel2 = null;
  next.selWire = null;
  next.focusType = null;
  next.fmOpen = false;
}

function handleSelectPeek(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'selectPeek') return;
  next.sel2 = action.id !== null && next.sel2 === action.id ? null : action.id;
}

function handleSelectWire(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'selectWire') return;
  const same = !!next.selWire && next.selWire.a === action.a && next.selWire.b === action.b;
  next.selWire = same ? null : { 'a': action.a, 'b': action.b };
  next.sel = null;
  next.focusType = null;
  next.fmOpen = false;
}

function handleFocusType(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'focusType') return;
  next.focusType = action.t;
  if (action.t) {
    next.sel = null;
    next.selWire = null;
  }
}

function handleSetStage(next: ViewSpec, action: ViewAction, model: ViewModelIndex): void {
  if (action.type !== 'setStage') return;
  next.stage = action.id && action.id in model.parents ? action.id : null;
  next.selWire = null; // a wire selection is keyed to one projection's reps
  if (!next.stage) dropStaleWire(next, model);
}

function handleToggleLayer(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'toggleLayer') return;
  if (action.key in next.layers) next.layers[action.key] = !next.layers[action.key];
}

function handleSetQuery(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'setQuery') return;
  next.query = action.q;
}

function handleSetFmOpen(next: ViewSpec, action: ViewAction): void {
  if (action.type !== 'setFmOpen') return;
  next.fmOpen = action.open;
}

function handleFoldAll(next: ViewSpec): void {
  next.expanded = [];
  next.hidden = [];
  next.sel = null;
  next.sel2 = null;
  next.selWire = null;
  next.query = '';
  next.focusType = null;
  next.stage = null;
}

const HANDLERS: Record<ViewAction['type'], (next: ViewSpec, action: ViewAction, model: ViewModelIndex) => void> = {
  toggleExpand: handleToggleExpand,
  reveal: handleReveal,
  hide: handleHide,
  select: handleSelect,
  selectPeek: handleSelectPeek,
  selectWire: handleSelectWire,
  focusType: handleFocusType,
  setStage: handleSetStage,
  toggleLayer: handleToggleLayer,
  setQuery: handleSetQuery,
  setFmOpen: handleSetFmOpen,
  foldAll: handleFoldAll,
};

/** Pure view reducer: apply one action, return a NEW spec — the input is
    never mutated (it may be frozen). Centralizes the invariants that were
    scattered across unfold's handlers: collapse folds all descendants,
    reveal unhides the chain and expands the ancestors, the last-visible-
    root hide guard, the sel/selWire/focusType/fmOpen mutual exclusions,
    and stage-invalidates-selWire (see the handle* functions above). */
export function reduceView(spec: ViewSpec, action: ViewAction, model: ViewModelIndex): ViewSpec {
  const next = clone(spec);
  HANDLERS[action.type](next, action, model);
  return next;
}
