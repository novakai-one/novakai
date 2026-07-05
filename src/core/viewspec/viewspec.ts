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
    v: 1, expanded: [], hidden: [], layers,
    sel: null, selWire: null, query: '', stage: null, focusType: null, fmOpen: false,
  };
}

const strOrNull = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);
const idList = (x: unknown): string[] =>
  Array.isArray(x) ? [...new Set(x.filter((i): i is string => typeof i === 'string' && !!i))] : [];

/** Tolerant schema boundary. Coerces unknown JSON — a full v1 spec, the
    legacy {expanded,hidden,layers} localStorage shape (a strict subset,
    so migration is branch-free), or garbage — into a valid ViewSpec,
    field by field. When `known` is given the spec is confined to a real
    model: expanded/hidden filtered, sel/stage nulled when unknown,
    selWire nulled when either endpoint is unknown (focusType is a type
    token, not an id — it survives). Stored layer prefs win over the
    fresh-view default. Idempotent on a valid spec. */
export function normalizeViewSpec(raw: unknown, known?: string[] | null): ViewSpec {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = emptyViewSpec();
  out.expanded = idList(f.expanded);
  out.hidden = idList(f.hidden);
  if (f.layers && typeof f.layers === 'object') {
    const stored = f.layers as Record<string, unknown>;
    for (const k of LAYER_KEYS) out.layers[k] = !!stored[k];
  }
  out.sel = strOrNull(f.sel);
  const w = f.selWire as { a?: unknown; b?: unknown } | null | undefined;
  const wa = w && typeof w === 'object' ? strOrNull(w.a) : null;
  const wb = w && typeof w === 'object' ? strOrNull(w.b) : null;
  out.selWire = wa && wb ? { a: wa, b: wb } : null;
  out.query = typeof f.query === 'string' ? f.query : '';
  out.stage = strOrNull(f.stage);
  out.focusType = strOrNull(f.focusType);
  out.fmOpen = !!f.fmOpen;
  if (known) {
    const ok = new Set(known);
    out.expanded = out.expanded.filter((id) => ok.has(id));
    out.hidden = out.hidden.filter((id) => ok.has(id));
    if (out.sel && !ok.has(out.sel)) out.sel = null;
    if (out.stage && !ok.has(out.stage)) out.stage = null;
    if (out.selWire && (!ok.has(out.selWire.a) || !ok.has(out.selWire.b))) out.selWire = null;
  }
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
  for (const c of model.children[id] ?? []) {
    if (acc.includes(c)) continue;
    acc.push(c);
    descendants(c, model, acc);
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
  const { a, b } = spec.selWire;
  if (visibleRep(a, spec, model) !== a || visibleRep(b, spec, model) !== b) spec.selWire = null;
}

const clone = (spec: ViewSpec): ViewSpec => ({
  ...spec,
  expanded: [...spec.expanded],
  hidden: [...spec.hidden],
  layers: { ...spec.layers },
  selWire: spec.selWire ? { ...spec.selWire } : null,
});

/** Pure view reducer: apply one action, return a NEW spec — the input is
    never mutated (it may be frozen). Centralizes the invariants that were
    scattered across unfold's handlers: collapse folds all descendants,
    reveal unhides the chain and expands the ancestors, the last-visible-
    root hide guard, the sel/selWire/focusType/fmOpen mutual exclusions,
    and stage-invalidates-selWire. */
export function reduceView(spec: ViewSpec, action: ViewAction, model: ViewModelIndex): ViewSpec {
  const s = clone(spec);
  switch (action.type) {
    case 'toggleExpand': {
      if (!(model.children[action.id] ?? []).length) break;
      if (s.expanded.includes(action.id)) {
        const fold = new Set([action.id, ...descendants(action.id, model)]);
        s.expanded = s.expanded.filter((id) => !fold.has(id));
      } else s.expanded.push(action.id);
      dropStaleWire(s, model);
      break;
    }
    case 'reveal': {
      const chain = ancestorChain(action.id, model);
      s.hidden = s.hidden.filter((id) => !chain.includes(id));
      for (const anc of chain.slice(1)) if (!s.expanded.includes(anc)) s.expanded.push(anc);
      dropStaleWire(s, model);
      break;
    }
    case 'hide': {
      const visRoots = model.roots.filter((r) => !s.hidden.includes(r));
      if (model.roots.includes(action.id) && visRoots.length <= 1) break;
      if (!s.hidden.includes(action.id)) s.hidden.push(action.id);
      if (s.sel === action.id) s.sel = null;
      dropStaleWire(s, model);
      break;
    }
    case 'select':
      s.sel = action.id !== null && s.sel === action.id ? null : action.id;
      s.selWire = null;
      s.focusType = null;
      s.fmOpen = false;
      break;
    case 'selectWire': {
      const same = !!s.selWire && s.selWire.a === action.a && s.selWire.b === action.b;
      s.selWire = same ? null : { a: action.a, b: action.b };
      s.sel = null;
      s.focusType = null;
      s.fmOpen = false;
      break;
    }
    case 'focusType':
      s.focusType = action.t;
      if (action.t) { s.sel = null; s.selWire = null; }
      break;
    case 'setStage':
      s.stage = action.id && action.id in model.parents ? action.id : null;
      s.selWire = null;   // a wire selection is keyed to one projection's reps
      if (!s.stage) dropStaleWire(s, model);
      break;
    case 'toggleLayer':
      if (action.key in s.layers) s.layers[action.key] = !s.layers[action.key];
      break;
    case 'setQuery':
      s.query = action.q;
      break;
    case 'setFmOpen':
      s.fmOpen = action.open;
      break;
    case 'foldAll':
      s.expanded = [];
      s.hidden = [];
      s.sel = null;
      s.selWire = null;
      s.query = '';
      s.focusType = null;
      s.stage = null;
      break;
  }
  return s;
}
