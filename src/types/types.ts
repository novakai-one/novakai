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
    Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "p" | "span" | "ol" | "ul" | "li" | "div",
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

export interface BlockPanelTile {
    type: "blocks",
    tileName: "Blocks",
    panelBody: { id: string, block: string }[],
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

// Pure geometry — handed to DragContainer at render time.
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
