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
//            the block under the caret for "delete", the panel spec for
//            "block-panel-selection", the active file for "canvas-click".
// payload  — gesture-specific extras only the source can supply (the typed
//            text on Enter, the clicked y, the chosen block spec).
export type BlockTrigger =
    | "enter"                   // split a new block below the source
    | "canvas-click"            // drop a fresh block on the clicked row
    | "block-panel-selection"   // insert the panel's chosen block at the bottom
    | "delete"                  // remove an empty block, close the hole

export interface BlockEventPayload {
    value?: string,             // enter: the source block's current text
    tag?: TextElement['Tag'],   // enter: the source's tag (inherited by the new block)
    y?: number,                 // canvas-click: workspace-local row the user clicked
    spec?: BlockSpec,           // block-panel-selection: which block to insert
}

export interface BlockEvent {
    trigger: BlockTrigger,
    callerId: string,
    payload?: BlockEventPayload,
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
