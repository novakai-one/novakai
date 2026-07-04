/* =====================================================================
   unfold-dock.ts — the pure dock-state decision for the primary surface
   ---------------------------------------------------------------------
   The panel chrome (which tab's body shows, collapsed or not, how wide)
   advances ONLY through this reducer, so the load-bearing chrome claims
   — a tab click always reveals, width never escapes its clamps, a
   corrupt persisted value can never wedge the panel shut — are
   acceptance-provable (E2/H1; ufEscAction / ufLiftWires precedent:
   dependency-free file inside the unfold module, unfold.ts consumes it).
   ===================================================================== */

export type DockState = { tab: string; collapsed: boolean; width: number };

export type DockAction =
  | { type: 'setTab'; tab: string }
  | { type: 'toggleCollapse' }
  | { type: 'resize'; width: number }
  | { type: 'load'; raw: unknown };

export const UF_DOCK_MIN = 240;
export const UF_DOCK_MAX = 580;
export const UF_DOCK_WIDTH = 330;

const clampW = (w: number): number => Math.min(UF_DOCK_MAX, Math.max(UF_DOCK_MIN, Math.round(w)));

export function ufDockReduce(state: DockState, action: DockAction, tabs: string[]): DockState {
  if (!tabs.length) return state;
  switch (action.type) {
    case 'setTab': {
      if (!tabs.includes(action.tab)) return state;
      if (action.tab === state.tab && !state.collapsed) return state;
      return { tab: action.tab, collapsed: false, width: state.width };
    }
    case 'toggleCollapse':
      return { tab: state.tab, collapsed: !state.collapsed, width: state.width };
    case 'resize': {
      if (state.collapsed) return state;
      return { tab: state.tab, collapsed: false, width: clampW(action.width) };
    }
    case 'load': {
      const def: DockState = { tab: tabs[0], collapsed: false, width: UF_DOCK_WIDTH };
      const raw = action.raw;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return def;
      const o = raw as Record<string, unknown>;
      return {
        tab: typeof o.tab === 'string' && tabs.includes(o.tab) ? o.tab : def.tab,
        collapsed: o.collapsed === true,
        width: typeof o.width === 'number' && Number.isFinite(o.width) ? clampW(o.width) : def.width,
      };
    }
  }
}
