import type { ReactNode } from "react"


// ── Event family payloads ────────────────────────────────────────────────
// Co-located here (not in SelectionManager.ts) so components and DragManager
// can fill the shapes without importing SM. Keeps the "no helper imports
// another helper" invariant clean: DM and components depend only on types.
//
// Three channels, one shape per family:
//   - MouseEventData      — clicks, drag, hover, rubber-band
//   - KeyEventData        — keydown / keyup; modifiers included; nativeEvent for preventDefault
//   - LifecycleEventData  — blur (and future focus / input)
//
// SM owns every preventDefault. The Component → WSA → SM chain MUST stay
// synchronous (React 19 removed event pooling, but setTimeout / Promise.then
// would still break preventDefault).

export type MouseEventData = {
    clientX: number,
    clientY: number,
    blockId: string,
    blockType: string,
    shiftKey: boolean,
    metaKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    button: number,
    buttons: number,
}

export type KeyEventData = {
    key: string,
    shiftKey: boolean,
    metaKey: boolean,
    ctrlKey: boolean,
    altKey: boolean,
    blockId: string,
    blockType: string,
    nativeEvent: React.KeyboardEvent,
}

export type LifecycleEventData = {
    blockId: string,
    blockType: string,
}


// ── Block events ─────────────────────────────────────────────────────────
// The ONE object passed around for structural gestures (create / delete).
// Same shape goes to BlockManager and LayoutManager so the message never
// changes hands mid-chain (no "broken telephone"): every consumer reads the
// trigger + the caller's id, never a reshaped copy.
//
// trigger  — the human-readable gesture name (see BlockTrigger).
// callerId — the id of the thing that fired it: the source block for "enter",
//            the block under the caret for "delete"/"content-refresh", the
//            dragged block for "drop", the panel spec for "block-panel-selection".
// payload  — gesture-specific extras only the source can supply (the typed text,
//            the clicked/dropped coordinates, the chosen spec, the pasted blocks).
export type BlockTrigger =
    | "enter"                   // split a new block below the source
    | "canvas-click"            // drop a fresh block on the clicked row
    | "block-panel-selection"   // insert the panel's chosen block at the bottom
    | "delete"                  // remove an empty block, close the hole
    | "content-refresh"         // persist a block's edited text (no layout change)
    | "clipboard-paste"         // insert the pasted blocks below the anchor
    | "drop"                    // a drag ended — move the block's placement

export interface BlockEventPayload {
    value?: string,                  // enter / content-refresh: the block's current text
    tag?: TextElement['Tag'],        // enter / content-refresh: the block's tag
    x?: number,                      // drop: workspace-local x the block landed at
    y?: number,                      // canvas-click / drop: workspace-local row
    spec?: BlockSpec,                // block-panel-selection: which block to insert
    blocks?: ClipboardBlockData[],   // clipboard-paste: the blocks being pasted
}

export interface BlockEvent {
    trigger: BlockTrigger,
    callerId: string,
    payload?: BlockEventPayload,
}

// One entry per block in a structured clipboard payload. Lives here (not in
// SelectionManager) so it's part of the shared event vocabulary BlockManager
// reads — the same reason the mouse/key payloads sit in this file.
//   html:   innerHTML fragment for that block (may be "" for empty blocks).
//   tag:    the contentEditable element's tag name (p, h1, h2, …).
//   layout: optional saved geometry snapshot (preserved on internal paste).
export type ClipboardBlockData = {
    html: string,
    tag: string,
    layout?: LayoutData,
}

// What LayoutManager does with the proposed layout: push overlaps down after an
// add, or pull blocks up to close the hole after a delete.
export type LayoutChangeMode = "add" | "delete"


// ── Layout preferences ───────────────────────────────────────────────────
// How wide the workspace canvas may grow. "full" removes the cap. Used by the
// layout store and the right-panel Layout control.
export type PageWidth = "narrow" | "normal" | "full"


// ── Document model ───────────────────────────────────────────────────────

export interface MetaData {
    dateCreated: string,
    author?: string,
    lastEdited?: string,
}

// One renderable block in the document — content only.
// component selects the React component to render (see workspace-blocks/).
// Tag selects the HTML element for ContentArea blocks.
// children: a flat list of child block ids — supports future nesting; currently null.
// Position/size now live in LayoutItem (see Layout section), not on the block.
export interface TextElement {
    id: string,
    component: "ContentArea" | "CanvasArea",
    Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "p" | "span" | "ol" | "ul" | "li" | "div" | "blockquote",
    styles: string,
    classNames: string,
    innerContent: string,
    parentId: string | null,
    children: string[] | null,
    files: string[],
}


// ── Panel tile shapes ────────────────────────────────────────────────────

export type PanelTile = FilePanelTile | BlockPanelTile

export interface FilePanelTile {
    type: "files",
    tileName: "Files",
    panelBody: FileData[],
}

// A Blocks-tile entry. Clicking one inserts a real TextElement into the active
// file, rendered by `component` (currently ContentArea) using the semantic `Tag`.
export interface BlockSpec {
    id: string,
    block: string,                              // label shown in the panel
    component: "ContentArea" | "CanvasArea",
    Tag: TextElement['Tag'],
    classNames?: string,
}

export interface BlockPanelTile {
    type: "blocks",
    tileName: "Blocks",
    panelBody: BlockSpec[],
}


// ── Document containers ──────────────────────────────────────────────────

export type ContentDataSet = Record<string, TextElement>
export type FilesDataSet   = Record<string, FileData>

export type FileData = {
    id: string,
    metaData: MetaData,
    tags: string[],
    fileName: string,
    content: string[],   // ordered list of block ids — looked up in ContentDataSet
}

export type DataSet = {
    files: FilesDataSet,
    content: ContentDataSet,
    layouts: LayoutDataSet,
}


// ── Layout / placement ───────────────────────────────────────────────────
// The "where". Split out of TextElement so one block can sit in many places.

// Pure geometry — handed to DragContainer at render time. PIXELS, so a block can
// sit at any position (canvas-ready). The grid is a snapping policy applied by
// LayoutManager, not a property of this shape.
export interface LayoutData {
    x: number,
    y: number,
    w: number,
    h: number,
}

// A LayoutItem is ONE placement of ONE block on ONE file's canvas — its own
// database item. Because placement is separate from the block, the same
// blockId can have many LayoutItems → the block renders in many files.
// Stored in LayoutDataSet keyed by layoutKey(fileId, blockId).
export interface LayoutItem extends LayoutData {
    blockId: string,          // the TextElement this placement renders
    fileId: string,           // the file/canvas this placement lives on
    // Container behaviour overrides — DragContainer defaults all to true.
    // Geometry (x/y/w/h, inherited above) was the only thing ever persisted
    // before; these let you save per-placement drag/resize/lock state later.
    resizable?: boolean,
    draggable?: boolean,
    locked?: boolean,
}

export type LayoutDataSet = Record<string, LayoutItem>

// ── Conduit shape ──────────────────────────────────────────────────────
// The uniform document slices WSA threads through every conduit helper. WSA
// seeds it from its rendered store state and hands it to each helper in turn;
// each returns the (possibly mutated) shape; WSA commits the final one and React
// diffs. `file` is the active file so a helper can place/order within it without
// reaching into the store.
export interface DocShape {
    file:        FileData | null,
    contentData: ContentDataSet,
    layoutData:  LayoutDataSet,
}

// Composite key so one block can be placed in many files without collisions.
// (Same block twice in the SAME file would need a unique placement id instead —
//  a later step, since selection + the DOM currently key off blockId.)
export const layoutKey = (fileId: string, blockId: string): string =>
    `${fileId}:${blockId}`


// ── Drag-container ───────────────────────────────────────────────────────

export interface DragContainerProps {
    id: string,
    children: ReactNode,
    // The conduit — DragContainer forwards raw mouse data + trigger, never decides.
    cbMouseEvent: (mouseData: MouseEventData, trigger: string) => void,
    // SM-owned block-selection flag — WSA passes the value off useSyncExternalStore.
    isSelected?: boolean,
    // The placement's geometry for this block in the active file. Optional only
    // while a block is first being placed (before its LayoutItem exists).
    layoutData?: LayoutData,
}
