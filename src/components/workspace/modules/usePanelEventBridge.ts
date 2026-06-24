// usePanelEventBridge.ts
//
// Wires a sibling panel's mouse gestures into WSA's conduit while WSA is
// mounted. Sister hook to useWorkspacePointerBridge: that one bridges document
// mousemove/up into the router; this one bridges a sibling component (LeftPanel)
// across the sibling gap via the block-event store.
//
// A panel click can't bubble to the workspace div, so LeftPanel dispatches its
// shaped MouseEventData + trigger through useBlockEventStore. This hook registers
// WSA's router as the store's handler, so the panel gesture flows through the
// exact same route('mouse', …) every canvas click uses — WSA stays the sole
// router and makes the same (zero) decisions.
//
// WSA imports THIS hook, not the store, so the depcruise conduit rule
// (no container imports the block-event store) is never violated.

import { useEffect } from "react";
import { useBlockEventStore } from "../../store/useBlockEventStore";
import type { MouseEventData } from "../../types/types";
import type { TriggerWord } from "../../types/trigger-words";

type ForwardMouse = (data: MouseEventData, trigger: TriggerWord) => void;

export function usePanelEventBridge(forward: ForwardMouse): void {
  useEffect(() => {
    useBlockEventStore.getState().setHandler(forward);
    return () => useBlockEventStore.getState().setHandler(null);
  }, [forward]);
}
