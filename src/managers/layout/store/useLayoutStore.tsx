// ── Layout store ────────────────────────────────────────────────────────────
// Holds workspace-layout preferences that are purely about presentation (not
// document data). Right now that's just the page width — how wide the canvas is
// allowed to grow before it stops and centres.
//
// Kept separate from the theme store on purpose: theme is about colour/skin,
// layout is about geometry. One small store per concern stays readable and lets
// each grow its own options (sidebar side, focus mode, …) without tangling.
//
// State only — the actual sizing is done in CSS. App reads pageWidth and writes
// a `page-<value>` class onto .app, and workspace.css maps that class to a
// max-width. So switching width is one className swap, no re-layout in JS.

import { create } from "zustand"
import type { PageWidth } from "../../../types/types"

interface LayoutStore {
    pageWidth: PageWidth
    setPageWidth: (pageWidth: PageWidth) => void
    // Sidebar open/closed lives here (not local to each panel) so the header's
    // always-visible toggles can drive the panels — the Obsidian/Claude pattern
    // where the collapse control sits in the top bar, not inside the panel.
    leftPanelOpen: boolean
    rightPanelOpen: boolean
    toggleLeftPanel: () => void
    toggleRightPanel: () => void
}

// @flowmap-node layoutStore kind=store
export const useLayoutStore = create<LayoutStore>((set) => ({
    // "normal" is the comfortable reading default — wide enough for tables, not
    // so wide that prose lines get unreadable.
    pageWidth: "normal",
    setPageWidth: (pageWidth) => set({ pageWidth }),
    leftPanelOpen: true,
    rightPanelOpen: true,
    toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
    toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
}))
