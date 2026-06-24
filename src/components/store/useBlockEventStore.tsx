// ── Block-event store ───────────────────────────────────────────────────────
// A thin transport so a sibling panel can reach WorkspaceArea's mouse router
// without prop-drilling. LeftPanel is a sibling of WorkspaceArea — they share no
// parent that threads a callback down — and a panel click can't bubble to the
// workspace div, so a store is how a panel gesture reaches WSA's conduit.
//
// It carries the SAME (MouseEventData, trigger) pair every other mouse source
// hands the router — no bespoke event shape. A panel click is just a mouse
// gesture that happens to originate outside the workspace element.
//
// Flow: WSA registers its router as the handler (via usePanelEventBridge, so WSA
// never imports this store and the conduit rule holds). LeftPanel calls
// dispatch(data, trigger); the handler forwards into route('mouse', …), and
// BlockManager decides what to create from the trigger + carried block id.
//
// Render-safety (why a store works here):
//   - Sources call dispatch via getState() — NO selector, so firing never
//     re-renders the caller.
//   - dispatch does not call set(); it just runs the handler.
//   - Nobody subscribes to `handler`, so re-registering it renders nothing.
// The only renders are the ones WSA's commit explicitly causes.

import { create } from "zustand";
import type { MouseEventData } from "../../types/types";
import type { TriggerWord } from "../../types/trigger-words";

type MouseEventHandler = (data: MouseEventData, trigger: TriggerWord) => void;

interface BlockEventStore {
  // Set by WorkspaceArea's router bridge once it has mounted. null until then.
  handler: MouseEventHandler | null;
  setHandler: (handler: MouseEventHandler | null) => void;
  // The public entry every source calls. No-op until WSA registers a handler
  // (e.g. a panel click before the workspace is on screen).
  dispatch: (data: MouseEventData, trigger: TriggerWord) => void;
}

export const useBlockEventStore = create<BlockEventStore>((set, get) => ({
  handler: null,
  setHandler: (handler) => set({ handler }),
  dispatch: (data, trigger) => {
    const handler = get().handler;
    if (!handler) return;
    handler(data, trigger);
  },
}));
