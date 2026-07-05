import type { Hooks, StateStore } from './__types.generated';

// @flowmap-node context__AppContext kind=type
/** the single shared object passed to every init: dom, model, singletons, view, bodies, hooks */
export interface AppContext {
  state: StateStore;
  hooks: Hooks;
}
