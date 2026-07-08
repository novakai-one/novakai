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

export function initUnfoldSession(E: UEnv): void {
  /** plain-data containment slice for the reducer (reads only) */
  function modelIndex(): ViewModelIndex {
    const parents: Record<string, string | null> = {}, children: Record<string, string[]> = {};
    for (const [id, entry] of E.U) { parents[id] = entry.parent; children[id] = entry.children; }
    return { parents, children, roots: E.ROOTS };
  }
  /** reduce one or more actions into a new frozen spec WITHOUT painting —
      for boundary choreography (open-seeding, travel) that repaints itself */
  function apply(...actions: ViewAction[]): void {
    let next = E.spec;
    const modelIdx = modelIndex();
    for (const action of actions) next = reduceView(next, action, modelIdx);
    E.spec = E.deepFreeze(next);
  }
  /** the ONLY view-mutation entry: pure reduction, frozen install, then the
      per-action repaint. No handler touches view state or the DOM directly. */
  function commit(action: ViewAction): void {
    apply(action);
    paint(action);
  }
  /** per-action repaint: today's hand-tuned render subsets (stagger, staged
      pill stability, focus flow) transcribed BEHIND the commit boundary —
      an internal optimization; every pixel change is downstream of a spec
      transition. */
  function paint(action: ViewAction): void {
    switch (action.type) {
      case 'toggleExpand': case 'reveal': case 'hide':
        render(true, action.type);
        return;
      case 'foldAll':
        E.overlay.classList.remove('staged');
        E.renderStageGroup(undefined);
        render(true, action.type);
        return;
      case 'select':
        E.actionsMenuOpen = false; // a selection change starts the actions menu closed
        E.renderSliceTab();
        if (!E.spec.stage && E.spec.layers.blast) { render(false); return; }
        // U3/U6: selection only re-lights cards and wires — no rebuild, pills stay stable
        E.focusDim();
        E.renderTree();
        E.renderInspector();
        setTimeout(E.spec.stage ? E.drawStageWires : E.drawWires, 0);
        return;
      case 'selectPeek':
        // C7: secondary peek re-lights canvas + tree only — no render/reframe/camera,
        // no pill rebuild. The primary sel and viewport are untouched.
        E.focusDim();
        E.renderTree();
        return;
      case 'selectWire': case 'focusType':
        E.actionsMenuOpen = false;
        if (action.type === 'selectWire') E.renderSliceTab();
        E.focusDim();
        E.renderInspector();
        setTimeout(E.spec.stage ? E.drawStageWires : E.drawWires, 0);
        return;
      case 'setStage':
        E.overlay.classList.toggle('staged', !!E.spec.stage);
        E.renderStageGroup(undefined);
        E.focusDim();
        return;
      case 'toggleLayer':
        E.applyLayerClasses();
        E.renderLayers();
        render(false);
        return;
      case 'setQuery':
        E.renderTree();
        return;
      case 'setFmOpen':
        E.renderInspector();
        return;
    }
  }
  /** clear-or-set selection without toggle semantics (boundary sites) */
  function setSel(id: string | null): void {
    if (E.spec.sel !== id) apply({ type: 'select', id });
  }
  /** reveal + select + full repaint — the shared "go to" path (tree label,
      inspector connections) */
  function goTo(id: string): void {
    apply({ type: 'reveal', id });
    setSel(id);
    render(true);
  }

  /** selection survives the mode boundary: seed the spec from the editor on
      open; hand the reading selection back (selectOnly + zoomToNode) on
      close. No new state — the two surfaces share one selection. */
  function selectSync(dir: 'open' | 'close'): void {
    if (dir === 'open') {
      const first = [...E.ctx.state.sel].find((id) => E.U.has(id));
      if (first) { apply({ type: 'reveal', id: first }); setSel(first); }
      return;
    }
    if (E.spec.sel && E.ctx.state.nodes[E.spec.sel]) {
      E.deps.selection.selectOnly(E.spec.sel);
      E.deps.camera.zoomToNode(E.spec.sel);
    }
  }

  /** reading session per diagram (sorted containment roots as identity),
      stored as the full v1 ViewSpec; load goes through normalizeViewSpec
      (the schema boundary — a pre-M3 {expanded,hidden,layers} entry is a
      valid subset, migration is branch-free) and applies the durable trio.
      sel/stage/query are carried by the format but selectSync owns
      selection at the mode boundary. */
  function persistView(dir: 'save' | 'load'): void {
    try {
      const key = 'unfold.view';
      const all = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      const fp = [...E.ROOTS].sort().join('|');
      if (!fp) return;
      if (dir === 'save') {
        all[fp] = E.spec;
        const keys = Object.keys(all);
        while (keys.length > 24) delete all[keys.shift() as string];
        localStorage.setItem(key, JSON.stringify(all));
        return;
      }
      const loaded = normalizeViewSpec(all[fp], [...E.U.keys()]);
      E.spec = E.deepFreeze({
        ...emptyViewSpec(),
        expanded: loaded.expanded,
        hidden: loaded.hidden,
        // stored layer prefs win; trust is gated on a live advisory source (runtime capability, not schema)
        layers: { ...loaded.layers, trust: loaded.layers.trust && E.TRUST_SRC },
      });
    } catch { /* storage unavailable — the session just doesn't persist */ }
  }

  function isRendered(id: string): boolean {
    let cur = E.U.get(id);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id)) return false;
      seen.add(cur.id);
      if (E.spec.hidden.includes(cur.id)) return false;
      if (!cur.parent) return true;
      if (!E.spec.expanded.includes(cur.parent)) return false;
      cur = E.U.get(cur.parent);
    }
    return true;
  }
  function visibleRep(id: string): string | null {
    let cur = E.U.get(id);
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur.id)) return null;
      seen.add(cur.id);
      if (isRendered(cur.id)) return cur.id;
      cur = cur.parent ? E.U.get(cur.parent) : undefined;
    }
    return null;
  }

  /* ================= ORCHESTRATION ================= */
  function render(refit: boolean, actionType: string = 'reveal'): void {
    E.repaintAction = actionType;
    // (the U2 wire-dies-with-its-reps rule moved into reduceView — render is a
    // pure CONSUMER of the spec; its only other inputs are animation/camera infra)
    E.computeBlast();
    E.renderCanvas();
    E.enterStagger();
    E.focusDim();
    E.renderTree();
    E.renderInspector();
    E.refreshStage();   // U4: the stage projection subscribes to the same view state as the canvas
    const shown = [...E.U.keys()].filter((id) => isRendered(id)).length - E.ROOTS.filter((r) => isRendered(r)).length;
    const total = E.U.size - E.ROOTS.length;
    E.q('ufCount').textContent = shown + ' shown';
    E.q('ufHint').innerHTML = shown === 0 || total <= 0 ? ''
      : `<b>${Math.round((1 - shown / total) * 100)}%</b> still folded · ${shown} of ${total} shown`;
    persistView('save'); // every view mutation lands here — a reload mid-session loses nothing
    // plain timers, never rAF: rAF freezes in occluded windows and the redraw silently stalls
    setTimeout(() => {
      if (refit) { if (E.firstFit) E.fitView(false); else E.reframeToFit(); }
      E.firstFit = false;
      E.drawWires();
      const settle = Math.max(refit ? 960 : 80, E.wireEnterAt - performance.now() + 950);
      setTimeout(E.drawWires, settle);
    }, 0);
  }
  function toggleExpand(id: string): void {
    if (!E.isContainer(E.U.get(id))) return;
    commit({ type: 'toggleExpand', id });
  }
  function foldAll(): void {
    (E.q('ufSearch') as HTMLInputElement).value = '';
    commit({ type: 'foldAll' });
  }

  /* ================= API ================= */
  function open(): void {
    E.applyDark(localStorage.getItem('unfold.theme') === 'dark');
    E.build();
    persistView('load');   // resets sel/stage/focusType/fmOpen; restores the durable trio
    selectSync('open');
    E.prevShown.clear();
    E.wiresEverDrawn.clear();
    E.wireEnterAt = 0;
    E.overlay.classList.remove('staged');
    E.renderStageGroup(undefined);   // clears any stage-layer remnants from the last session
    E.applyLayerClasses();
    E.renderLayers();
    E.overlay.classList.add('show');
    E.firstFit = true;
    render(true);
  }
  function close(): void {
    if (!E.overlay.classList.contains('show')) return;
    persistView('save');
    selectSync('close');
    E.overlay.classList.remove('show');
  }

  E.modelIndex = modelIndex;
  E.apply = apply;
  E.commit = commit;
  E.setSel = setSel;
  E.goTo = goTo;
  E.selectSync = selectSync;
  E.persistView = persistView;
  E.isRendered = isRendered;
  E.visibleRep = visibleRep;
  E.render = render;
  E.toggleExpand = toggleExpand;
  E.foldAll = foldAll;
  E.open = open;
  E.close = close;
}
