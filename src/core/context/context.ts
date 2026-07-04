/* =====================================================================
   context.ts — the wiring seam
   ---------------------------------------------------------------------
   Responsibility: define AppContext, the single object passed to every
   module's init(). It carries:
     • resolved DOM element references,
     • mutable runtime singletons (camera, prefs, history, clipboard),
     • cross-module callback hooks (render, sync, renderInspector, ...).

   Why this exists: the original single file relied on hoisted function
   names referencing each other freely. Splitting into ES modules would
   create import cycles (render → inspector → render). The context object
   breaks every cycle: modules read/write `ctx`, and during boot main.ts
   assigns the real implementations onto the hook fields. No module
   imports another module's runtime function directly.

   Rule of thumb: shared *data* lives here; shared *behaviour* is wired
   here as hooks but defined in the owning module.
   ===================================================================== */

import type { Camera, Prefs, Point } from '../types/types';
import type { StateStore } from '../state/state';
import type { Plan } from '../plan/plan';
import type { History } from '../history/history';
import type { Runtime } from '../runtime/runtime';
import type { Clipboard } from '../../interaction/clipboard';

/** Resolved DOM references used across modules. */
export interface DomRefs {
  stage: HTMLElement;
  world: HTMLElement;
  wires: SVGSVGElement;
  mmd: HTMLTextAreaElement;
  main: HTMLElement;
}

/**
 * Cross-module behaviour hooks. main.ts assigns these during boot once
 * every module's init() has run. Calling a hook before boot finishes is
 * a programming error, hence the assertive defaults.
 */
export interface Hooks {
  render: () => void;
  sync: () => void;
  renderInspector: () => void;
  drawMinimap: () => void;
  applyCam: () => void;
  persist: () => void;
  pushHistory: () => void;
  updateUndoButtons: () => void;
  toast: (msg: string) => void;
  showTab: (which: 'insp' | 'style' | 'mmd' | 'source' | 'nav' | 'slice') => void;
  /** refresh the navigator pane list */
  renderNavigator: () => void;
  /** refresh the slice pane (neighbourhood mmd) */
  renderSlice: () => void;
  /** recompute obstacle-avoiding wire routes, then re-render */
  reroute: () => void;
  /** re-route ONLY these edge ids (incremental), then re-render */
  rerouteEdges: (ids: Set<string>) => void;
  /** redraw wires + edge labels only; does NOT rebuild node DOM */
  redrawWires: () => void;
  /** live-drag: re-path only edges incident to these moved nodes, in place */
  redrawWiresFor: (ids: Set<string>) => void;
  /** drill into a node: show only its internal level */
  enterContainer: (id: string) => void;
  /** open the build-plan review overlay (planner surface) above the current surface */
  plannerOpen: () => void;
  /** the planner overlay just closed; lets the surface underneath (unfold) refresh
      if ctx.state changed while it was hidden (e.g. planner's loadBaseFromText) */
  plannerClosed: () => void;
}

export interface AppContext {
  dom: DomRefs;
  state: StateStore;
  cam: Camera;
  prefs: Prefs;
  history: History;
  clipboard: Clipboard;
  runtime: Runtime;

  /** Snap toggle (mirrors prefs.snap but mutated live by hotkey/toolbar). */
  snap: boolean;
  /** Whether the minimap is currently shown. */
  mmShow: boolean;
  /** Last known mouse position in world coords (for paste / quick-add). */
  lastMouseWorld: Point | null;

  /** Drill-in view: which container's internals are shown (null = top level). */
  view: { container: string | null };

  /** Source bodies fetched from bodies.json (id -> { kind, body, signature }). Null when absent. */
  bodies: Map<string, { kind: string; body: string; accepts?: string[]; returns?: string | null }> | null;

  /**
   * Optional build-plan overlay (status/intent/phase on real nodes/edges).
   * Sidecar, never serialised into the .mmd. Null until a plan is loaded.
   * Read by the planner surface (panel/planner.ts); the base model is
   * untouched, so closing the planner shows raw current architecture.
   */
  plan: Plan | null;

  hooks: Hooks;
}

function notWired(name: string): never {
  throw new Error(`Hook "${name}" called before boot wiring completed`);
}

/** Build a context with placeholder hooks; main.ts fills them in. */
export function createHooks(): Hooks {
  return {
    render: () => notWired('render'),
    sync: () => notWired('sync'),
    renderInspector: () => notWired('renderInspector'),
    drawMinimap: () => notWired('drawMinimap'),
    applyCam: () => notWired('applyCam'),
    persist: () => notWired('persist'),
    pushHistory: () => notWired('pushHistory'),
    updateUndoButtons: () => notWired('updateUndoButtons'),
    toast: () => notWired('toast'),
    showTab: () => notWired('showTab'),
    renderNavigator: () => notWired('renderNavigator'),
    renderSlice: () => notWired('renderSlice'),
    reroute: () => notWired('reroute'),
    rerouteEdges: () => notWired('rerouteEdges'),
    redrawWires: () => notWired('redrawWires'),
    redrawWiresFor: () => notWired('redrawWiresFor'),
    enterContainer: () => notWired('enterContainer'),
    plannerOpen: () => notWired('plannerOpen'),
    plannerClosed: () => notWired('plannerClosed'),
  };
}
