// ── Block-event store ───────────────────────────────────────────────────────
// A thin dispatch channel so ANY component can fire a structural gesture
// (create / delete) without prop-drilling. LeftPanel is a sibling of
// WorkspaceArea — they share no parent that could thread a callback down — so a
// store is how a panel click reaches WSA's commit logic. Same way SM and DM are
// shared, but those go through props from App; a button in a sibling panel can't.
//
// Flow: WSA registers ONE handler on mount (setHandler). Every source calls
// dispatch(event), which forwards to that handler. The handler runs the whole
// pipeline (BlockManager -> merge -> LayoutManager -> commit) inside WSA, where
// the store setters, the save hook and the focus refs live.
//
// Render-safety (the reason a store works here):
//   - Sources call dispatch via getState() — NO selector, so firing a gesture
//     never re-renders the caller.
//   - dispatch does not call set(); it just runs the handler. So calling it
//     triggers no render on its own.
//   - Nobody subscribes to `handler`, so re-registering it renders nothing.
// The only renders that happen are the ones WSA's commit explicitly causes by
// writing document slices to useWorkspaceStore.

import { create } from 'zustand'
import type { BlockEvent } from '../../types/types'


type BlockEventHandler = (event: BlockEvent) => void

interface BlockEventStore {
    // Set by WorkspaceArea once it has mounted and can commit. null until then.
    handler: BlockEventHandler | null
    setHandler: (handler: BlockEventHandler | null) => void
    // The public entry every source calls. No-op until WSA registers a handler
    // (e.g. a panel click before the workspace is on screen).
    dispatch: (event: BlockEvent) => void
}

export const useBlockEventStore = create<BlockEventStore>((set, get) => ({
    handler: null,
    setHandler: (handler) => set({ handler }),
    dispatch: (event) => {
        const handler = get().handler
        if (!handler) return
        handler(event)
    },
}))
