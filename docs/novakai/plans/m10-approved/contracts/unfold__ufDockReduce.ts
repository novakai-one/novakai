import type { DockAction, DockState } from './__types.generated';

// @novakai-node unfold__ufDockReduce kind=function
/** pure dock-state reducer for the primary surface's panel: DockState { tab, collapsed, width } advances only through actions — setTab selects a known tab and always expands a collapsed panel (unknown or already-active tabs are no-ops), toggleCollapse flips collapsed preserving tab and width, resize rounds and clamps width to [240, 580] and is a no-op while collapsed, load normalizes a persisted raw value falling back per-field to first-tab / expanded / 330; an empty tabs list makes every action a no-op */
export function ufDockReduce(_state: DockState, _action: DockAction, _tabs: string[]): DockState {
  throw new Error('unimplemented');
}
