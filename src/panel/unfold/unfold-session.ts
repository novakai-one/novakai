/* =====================================================================
   unfold-session.ts — reading mode: the ONE view-mutation entry (commit),
   the per-action repaint (paint), the top-level repaint orchestrator
   (render), and the mode-boundary lifecycle (open/close/selectSync/
   persistView), split out of unfold.ts in place. Every symbol here used
   to be a closure over initUnfold's locals; those locals now live on the
   shared `E: UEnv` object unfold.ts constructs and passes to every
   sibling factory, and this factory attaches its own functions back onto
   `E` so the other siblings (and unfold.ts itself) can call them.
   ===================================================================== */

import { emptyViewSpec, normalizeViewSpec, reduceView } from '../../core/viewspec/viewspec';
import type { ViewAction, ViewModelIndex } from '../../core/viewspec/viewspec';
import type { UEnv } from './unfold';

/** plain-data containment slice for the reducer (reads only) */
function modelIndexOf(env: UEnv): ViewModelIndex {
  const parents: Record<string, string | null> = {};
  const children: Record<string, string[]> = {};
  for (const [id, entry] of env.U) {
    parents[id] = entry.parent;
    children[id] = entry.children;
  }
  return { parents, children, roots: env.ROOTS };
}

/** reduce one or more actions into a new frozen spec WITHOUT painting —
    for boundary choreography (open-seeding, travel) that repaints itself */
function applyActions(env: UEnv, ...actions: ViewAction[]): void {
  let next = env.spec;
  const modelIdx = modelIndexOf(env);
  for (const action of actions) next = reduceView(next, action, modelIdx);
  env.spec = env.deepFreeze(next);
}

/** per-action repaint handlers: today's hand-tuned render subsets (stagger,
    staged pill stability, focus flow) transcribed BEHIND the commit
    boundary — an internal optimization; every pixel change is downstream
    of a spec transition. Keyed by ViewAction.type so paintAction stays a
    single dispatch with no branching of its own. */
const PAINT_HANDLERS: Record<string, (env: UEnv, action: ViewAction) => void> = {
  toggleExpand: (env, action) => env.render(true, action.type),
  reveal: (env, action) => env.render(true, action.type),
  hide: (env, action) => env.render(true, action.type),
  foldAll: (env, action) => {
    env.overlay.classList.remove('staged');
    env.renderStageGroup(undefined);
    env.render(true, action.type);
  },
  select: (env) => {
    env.actionsMenuOpen = false; // a selection change starts the actions menu closed
    env.renderSliceTab();
    if (!env.spec.stage && env.spec.layers.blast) {
      env.render(false);
      return;
    }
    // U3/U6: selection only re-lights cards and wires — no rebuild, pills stay stable
    env.focusDim();
    env.renderTree();
    env.renderInspector();
    setTimeout(env.spec.stage ? env.drawStageWires : env.drawWires, 0);
  },
  selectPeek: (env) => {
    // C7: secondary peek re-lights canvas + tree only — no render/reframe/camera,
    // no pill rebuild. The primary sel and viewport are untouched.
    env.focusDim();
    env.renderTree();
  },
  selectWire: (env) => {
    env.actionsMenuOpen = false;
    env.renderSliceTab();
    env.focusDim();
    env.renderInspector();
    setTimeout(env.spec.stage ? env.drawStageWires : env.drawWires, 0);
  },
  focusType: (env) => {
    env.actionsMenuOpen = false;
    env.focusDim();
    env.renderInspector();
    setTimeout(env.spec.stage ? env.drawStageWires : env.drawWires, 0);
  },
  setStage: (env) => {
    env.overlay.classList.toggle('staged', !!env.spec.stage);
    env.renderStageGroup(undefined);
    env.focusDim();
  },
  toggleLayer: (env) => {
    env.applyLayerClasses();
    env.renderLayers();
    env.render(false);
  },
  setQuery: (env) => env.renderTree(),
  setFmOpen: (env) => env.renderInspector(),
};
/** the ONLY view-mutation entry's paint half: pure reduction (applyActions)
    already installed, this is strictly the per-action repaint dispatch. */
function paintAction(env: UEnv, action: ViewAction): void {
  PAINT_HANDLERS[action.type]?.(env, action);
}

/** clear-or-set selection without toggle semantics (boundary sites) */
function setSelection(env: UEnv, id: string | null): void {
  if (env.spec.sel !== id) applyActions(env, { type: 'select', id });
}
/** reveal + select + full repaint — the shared "go to" path (tree label,
    inspector connections) */
function goToId(env: UEnv, id: string): void {
  applyActions(env, { type: 'reveal', id });
  setSelection(env, id);
  env.render(true);
}

/** open half of selectSync: seed the spec from the editor selection */
function selectSyncOpen(env: UEnv): void {
  const first = [...env.ctx.state.sel].find((id) => env.U.has(id));
  if (!first) return;
  applyActions(env, { type: 'reveal', id: first });
  setSelection(env, first);
}
/** close half of selectSync: hand the reading selection back to the editor */
function selectSyncClose(env: UEnv): void {
  if (!env.spec.sel || !env.ctx.state.nodes[env.spec.sel]) return;
  env.deps.selection.selectOnly(env.spec.sel);
  env.deps.camera.zoomToNode(env.spec.sel);
}
/** selection survives the mode boundary: seed the spec from the editor on
    open; hand the reading selection back (selectOnly + zoomToNode) on
    close. No new state — the two surfaces share one selection. */
function selectSyncImpl(env: UEnv, dir: 'open' | 'close'): void {
  if (dir === 'open') selectSyncOpen(env);
  else selectSyncClose(env);
}

/** persistView 'save' half: write the current spec under this diagram's
    fingerprint key, capped to the 24 most-recently-touched diagrams */
function persistViewSave(env: UEnv, key: string, all: Record<string, unknown>, fingerprint: string): void {
  all[fingerprint] = env.spec;
  const keys = Object.keys(all);
  while (keys.length > 24) delete all[keys.shift() as string];
  localStorage.setItem(key, JSON.stringify(all));
}
/** persistView 'load' half: normalizeViewSpec is the schema boundary — a
    pre-M3 {expanded,hidden,layers} entry is a valid subset, migration is
    branch-free — then apply the durable trio. sel/stage/query are carried
    by the format but selectSync owns selection at the mode boundary. */
function persistViewLoad(env: UEnv, all: Record<string, unknown>, fingerprint: string): void {
  const loaded = normalizeViewSpec(all[fingerprint], [...env.U.keys()]);
  env.spec = env.deepFreeze({
    ...emptyViewSpec(),
    expanded: loaded.expanded,
    hidden: loaded.hidden,
    // stored layer prefs win; trust is gated on a live advisory source (runtime capability, not schema)
    layers: { ...loaded.layers, trust: loaded.layers.trust && env.TRUST_SRC },
  });
}
/** reading session per diagram (sorted containment roots as identity),
    stored as the full v1 ViewSpec. */
function persistViewImpl(env: UEnv, dir: 'save' | 'load'): void {
  try {
    const key = 'unfold.view';
    const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    const fingerprint = [...env.ROOTS].sort().join('|');
    if (!fingerprint) return;
    if (dir === 'save') {
      persistViewSave(env, key, all, fingerprint);
      return;
    }
    persistViewLoad(env, all, fingerprint);
  } catch { /* storage unavailable — the session just doesn't persist */ }
}

function isRenderedId(env: UEnv, id: string): boolean {
  let cur = env.U.get(id);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return false;
    seen.add(cur.id);
    if (env.spec.hidden.includes(cur.id)) return false;
    if (!cur.parent) return true;
    if (!env.spec.expanded.includes(cur.parent)) return false;
    cur = env.U.get(cur.parent);
  }
  return true;
}
function visibleRepOf(env: UEnv, id: string): string | null {
  let cur = env.U.get(id);
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    if (isRenderedId(env, cur.id)) return cur.id;
    cur = cur.parent ? env.U.get(cur.parent) : undefined;
  }
  return null;
}

/* ================= ORCHESTRATION ================= */
/** the settle/refit tail of render(): plain timers, never rAF — rAF freezes
    in occluded windows and the redraw silently stalls */
function scheduleWireSettle(env: UEnv, refit: boolean): void {
  if (refit) {
    if (env.firstFit) env.fitView(false);
    else env.reframeToFit();
  }
  env.firstFit = false;
  env.drawWires();
  const settle = Math.max(refit ? 960 : 80, env.wireEnterAt - performance.now() + 950);
  setTimeout(env.drawWires, settle);
}
/** the folded/shown footer counters */
function updateShownHint(env: UEnv): void {
  const shown = [...env.U.keys()].filter((id) => isRenderedId(env, id)).length
    - env.ROOTS.filter((root) => isRenderedId(env, root)).length;
  const total = env.U.size - env.ROOTS.length;
  env.q('ufCount').textContent = shown + ' shown';
  env.q('ufHint').innerHTML = shown === 0 || total <= 0 ? ''
    : `<b>${Math.round((1 - shown / total) * 100)}%</b> still folded · ${shown} of ${total} shown`;
}
function renderView(env: UEnv, refit: boolean, actionType: string = 'reveal'): void {
  env.repaintAction = actionType;
  // (the U2 wire-dies-with-its-reps rule moved into reduceView — render is a
  // pure CONSUMER of the spec; its only other inputs are animation/camera infra)
  env.computeBlast();
  env.renderCanvas();
  env.enterStagger();
  env.focusDim();
  env.renderTree();
  env.renderInspector();
  env.refreshStage();   // U4: the stage projection subscribes to the same view state as the canvas
  updateShownHint(env);
  persistViewImpl(env, 'save'); // every view mutation lands here — a reload mid-session loses nothing
  setTimeout(() => scheduleWireSettle(env, refit), 0);
}
function toggleExpandId(env: UEnv, id: string): void {
  if (!env.isContainer(env.U.get(id))) return;
  applyActions(env, { type: 'toggleExpand', id });
  paintAction(env, { type: 'toggleExpand', id });
}
function foldAllSession(env: UEnv): void {
  (env.q('ufSearch') as HTMLInputElement).value = '';
  applyActions(env, { type: 'foldAll' });
  paintAction(env, { type: 'foldAll' });
}

/* ================= API ================= */
/** the durable-trio reset shared by every fresh open */
function resetSessionMarks(env: UEnv): void {
  env.prevShown.clear();
  env.wiresEverDrawn.clear();
  env.wireEnterAt = 0;
}
function openSession(env: UEnv): void {
  env.applyDark(localStorage.getItem('unfold.theme') === 'dark');
  env.build();
  persistViewImpl(env, 'load');   // resets sel/stage/focusType/fmOpen; restores the durable trio
  selectSyncImpl(env, 'open');
  resetSessionMarks(env);
  env.overlay.classList.remove('staged');
  env.renderStageGroup(undefined);   // clears any stage-layer remnants from the last session
  env.applyLayerClasses();
  env.renderLayers();
  env.overlay.classList.add('show');
  env.firstFit = true;
  renderView(env, true);
}
function closeSession(env: UEnv): void {
  if (!env.overlay.classList.contains('show')) return;
  persistViewImpl(env, 'save');
  selectSyncImpl(env, 'close');
  env.overlay.classList.remove('show');
}

/** attach every non-mode-boundary member onto `env`; the 5 mode-boundary
    members (commit/selectSync/persistView/open/close) stay declared inside
    initUnfoldSession and are passed in already-bound to it. */
type MappedSessionMembers = Pick<UEnv, 'commit' | 'selectSync' | 'persistView' | 'open' | 'close'>;
function wireSessionEnv(env: UEnv, mapped: MappedSessionMembers): void {
  Object.assign(env, {
    modelIndex: () => modelIndexOf(env),
    apply: (...actions: ViewAction[]) => applyActions(env, ...actions),
    setSel: (id: string | null) => setSelection(env, id),
    goTo: (id: string) => goToId(env, id),
    isRendered: (id: string) => isRenderedId(env, id),
    visibleRep: (id: string) => visibleRepOf(env, id),
    render: (refit: boolean, actionType?: string) => renderView(env, refit, actionType),
    toggleExpand: (id: string) => toggleExpandId(env, id),
    foldAll: () => foldAllSession(env),
    ...mapped,
  });
}

export function initUnfoldSession(env: UEnv): void {
  /** the ONLY view-mutation entry: pure reduction, frozen install, then the
      per-action repaint. No handler touches view state or the DOM directly. */
  function commit(action: ViewAction): void {
    applyActions(env, action);
    paintAction(env, action);
  }
  /** selection survives the mode boundary — see selectSyncImpl */
  function selectSync(dir: 'open' | 'close'): void {
    selectSyncImpl(env, dir);
  }
  /** reading session per diagram — see persistViewImpl */
  function persistView(dir: 'save' | 'load'): void {
    persistViewImpl(env, dir);
  }
  function open(): void {
    openSession(env);
  }
  function close(): void {
    closeSession(env);
  }

  wireSessionEnv(env, { commit, selectSync, persistView, open, close });
}
