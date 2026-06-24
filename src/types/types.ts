import type { ReactNode } from "react";
import type { TriggerWord } from "./trigger-words";

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
  clientX: number;
  clientY: number;
  // Click position converted into content space (viewport minus the canvas
  // rect + scroll). The conduit fills these for canvas-level gestures so a
  // manager can place a block without touching the DOM. Absent for events that
  // carry no canvas position.
  contentX?: number;
  contentY?: number;
  blockId: string; // simpler to make this an extension of Lifecycle and send these two up each time.
  blockType: string; //this should be updated to actual type for component_registry
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  button: number;
  buttons: number;
  nativeEvent: React.MouseEvent | MouseEvent | null; // MouseEvent for native addEventListener
};

export type KeyEventData = {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  blockId: string;
  blockType: string;
  offset: number; // caret offset inside the block's text at the time the key fired (-1 when unknown)
  nativeEvent: React.KeyboardEvent;
};

export type LifecycleEventData = {
  blockId: string;
  blockType: string;
  // The block's live editable text at the moment the event fired. The component
  // captures it so BlockManager commits what the user sees from the Payload,
  // without reaching into the DOM. Absent on non-editable lifecycle events.
  text?: string;
};

// ── Clipboard payload ──────────────────────────────────────────────────────
// One entry per block in a structured clipboard payload. Lives here (not in
// SelectionManager) so it's part of the shared event vocabulary BlockManager
// reads — the same reason the mouse/key payloads sit in this file.
//   html:   innerHTML fragment for that block (may be "" for empty blocks).
//   tag:    the contentEditable element's tag name (p, h1, h2, …).
//   layout: optional saved geometry snapshot (preserved on internal paste).
export type ClipboardBlockData = {
  html: string;
  tag: string;
  layout?: LayoutData;
};

// What LayoutManager does with the proposed layout: push overlaps down after an
// add, or pull blocks up to close the hole after a delete.
export type LayoutChangeMode = "add" | "delete";

// ── Layout preferences ───────────────────────────────────────────────────
// How wide the workspace canvas may grow. "full" removes the cap. Used by the
// layout store and the right-panel Layout control.
export type PageWidth = "narrow" | "normal" | "full";

// ── Document model ───────────────────────────────────────────────────────

export interface MetaData {
  dateCreated: string;
  author?: string;
  lastEdited?: string;
}

// The set of React components a block may render as. Single source of truth for
// the name set: COMPONENT_REGISTRY (types/registry.ts) is checked against this
// union via `satisfies`, so the two cannot drift. Defined here (not derived from
// the registry) because the registry imports the components, which import this
// file — deriving it would close a forbidden import cycle.
export type ComponentName = "ContentArea" | "CanvasArea" | "DatabaseArea";

// One renderable block in the document — content only.
// component selects the React component to render (see workspace-blocks/).
// Tag selects the HTML element for ContentArea blocks.
// children: a flat list of child block ids — supports future nesting; currently null.
// Position/size now live in LayoutItem (see Layout section), not on the block.
export interface TextElement {
  id: string; // a.k.a. blockId
  component: ComponentName;
  Tag:
    | "h1"
    | "h2"
    | "h3"
    | "h4"
    | "h5"
    | "p"
    | "span"
    | "ol"
    | "ul"
    | "li"
    | "div"
    | "blockquote";
  styles: string;
  classNames: string;
  innerContent: string;
  parentId: string | null;
  children: string[] | null;
  files: string[];
}

// The one canonical fresh block. Every new TextElement — a typed paragraph, a
// database renderer, a database cell — starts from this single default shape, so
// a block's baseline (and any field added to TextElement later) lives in exactly
// one place. Callers override only what differs (tag, component, parentId, …).
export function makeTextElement(
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id: crypto.randomUUID(),
    component: "ContentArea",
    Tag: "p",
    styles: "",
    classNames: "",
    innerContent: "",
    parentId: null,
    children: null,
    files: [],
    ...overrides,
  };
}

// ── Panel tile shapes ────────────────────────────────────────────────────

export type PanelTile = FilePanelTile | BlockPanelTile;

export interface FilePanelTile {
  type: "files";
  tileName: "Files";
  panelBody: FileData[];
}

// A Blocks-tile entry. Clicking one inserts a real TextElement into the active
// file, rendered by `component` (currently ContentArea) using the semantic `Tag`.
export interface BlockSpec {
  id: string;
  block: string; // label shown in the panel
  component: ComponentName;
  Tag: TextElement["Tag"];
  classNames?: string;
}

export interface BlockPanelTile {
  type: "blocks";
  tileName: "Blocks";
  panelBody: BlockSpec[];
}

// ── Document containers ──────────────────────────────────────────────────

export type ContentDataSet = Record<string, TextElement>;
export type FilesDataSet = Record<string, FileData>;

export type FileData = {
  id: string;
  metaData: MetaData;
  tags: string[];
  fileName: string;
  content: string[]; // ordered list of block ids — looked up in ContentDataSet
};

export type DataSet = {
  files: FilesDataSet;
  content: ContentDataSet;
  layouts: LayoutDataSet;
  databases: DatabaseDataSet;
};

// ── Layout / placement ───────────────────────────────────────────────────
// The "where". Split out of TextElement so one block can sit in many places.

// Pure geometry — handed to DragContainer at render time. PIXELS, so a block can
// sit at any position (canvas-ready). The grid is a snapping policy applied by
// LayoutManager, not a property of this shape.
export interface LayoutData {
  x: number;
  y: number;
  w: number;
  h: number;
}

// A LayoutItem is ONE placement of ONE block on ONE file's canvas — its own
// database item. Because placement is separate from the block, the same
// blockId can have many LayoutItems → the block renders in many files.
// Stored in LayoutDataSet keyed by layoutKey(fileId, blockId).
export interface LayoutItem extends LayoutData {
  blockId: string; // the TextElement this placement renders
  fileId: string; // the file/canvas this placement lives on
  // Container behaviour overrides — DragContainer defaults all to true.
  // Geometry (x/y/w/h, inherited above) was the only thing ever persisted
  // before; these let you save per-placement drag/resize/lock state later.
  resizable?: boolean;
  draggable?: boolean;
  locked?: boolean;
}

export type LayoutDataSet = Record<string, LayoutItem>;

// ── Selection snapshot ─────────────────────────────────────────────────
// The selection result carried INSIDE the shape, so every conduit helper and
// WSA read it from one place instead of a separate store/subscription. SM is
// the writer; BM may seed `caret` when it creates a block; WSA reads it on the
// render that the commit already triggers.
//
//   selectedBlockIds — whole blocks highlighted (multi-block selection only).
//   caret            — where the caret should sit: a block id + text offset.
//                      null when there is no caret to place (e.g. pure range).
export interface CaretTarget {
  blockId: string;
  offset: number;
}

export interface SelectionSnapshot {
  selectedBlockIds: string[];
  caret: CaretTarget | null;
}

export function emptySelectionSnapshot(): SelectionSnapshot {
  return { selectedBlockIds: [], caret: null };
}

// ── Conduit shape ──────────────────────────────────────────────────────
// The uniform document slices WSA threads through every conduit helper. WSA
// seeds it from its rendered store state and hands it to each helper in turn;
// each returns the (possibly mutated) shape; WSA commits the final one and React
// diffs. `file` is the active file so a helper can place/order within it without
// reaching into the store. `selection` rides along so selected blocks + caret
// travel with the document instead of through a separate store.
export interface DocShape {
  file: FileData | null;
  contentData: ContentDataSet;
  layoutData: LayoutDataSet;
  databaseData: DatabaseDataSet;
  selection: SelectionSnapshot;
}

// ── Conduit draft shape (current / proposed) ─────────────────────────────
// Replaces DocShape as the shape WSA threads through the managers. Each slice
// has a read-only committed value and a proposed replacement. A manager reads
// proposed ?? currentReadOnly, builds a new value locally, and writes it to
// proposed. currentReadOnly is never mutated. proposed === null means no change.

export type ConduitEvent =
  | React.MouseEvent
  | MouseEvent
  | React.KeyboardEvent
  | null;

export interface DraftChannel<T> {
  currentReadOnly: T;
  proposed: T | null;
}

export interface CaretChannel {
  currentBlockId: string | null;
  proposedBlockId: string | null;
  currentOffset: number | null;
  proposedOffset: number | null;
}

export interface DocDraft {
  event: {
    event: ConduitEvent;
    data: MouseEventData | KeyEventData | LifecycleEventData;
    targetId: string;
    triggerWord: TriggerWord;
  };
  dataSet: {
    fileData: DraftChannel<FileData | null>;
    contentData: DraftChannel<ContentDataSet>;
    layoutData: DraftChannel<LayoutDataSet>;
    databaseData: DraftChannel<DatabaseDataSet>;
  };
  selection: {
    currentBlocks: string[];
    proposedBlocks: string[] | null;
    caret: CaretChannel;
  };
  created: {
    newBlockIds: string[] | null;
  };
}

// Seed a fresh draft from the committed store slices. All proposed start null.
export function buildDraft(
  file: FileData | null,
  content: ContentDataSet,
  layout: LayoutDataSet,
  database: DatabaseDataSet,
  selection: SelectionSnapshot,
  event: DocDraft["event"],
): DocDraft {
  return {
    event,
    dataSet: {
      fileData: { currentReadOnly: file, proposed: null },
      contentData: { currentReadOnly: content, proposed: null },
      layoutData: { currentReadOnly: layout, proposed: null },
      databaseData: { currentReadOnly: database, proposed: null },
    },
    selection: {
      currentBlocks: selection.selectedBlockIds,
      proposedBlocks: null,
      caret: {
        currentBlockId: selection.caret?.blockId ?? null,
        proposedBlockId: null,
        currentOffset: selection.caret?.offset ?? null,
        proposedOffset: null,
      },
    },
    created: { newBlockIds: null },
  };
}

// The effective flat view a manager reads: proposed where a prior manager
// proposed, else the committed current. This is what makes the bm->sm->dm->lm
// chain see each other's work while currentReadOnly stays untouched.
export function draftToFlat(draft: DocDraft): DocShape {
  const ds = draft.dataSet;
  return {
    file: ds.fileData.proposed ?? ds.fileData.currentReadOnly,
    contentData: ds.contentData.proposed ?? ds.contentData.currentReadOnly,
    layoutData: ds.layoutData.proposed ?? ds.layoutData.currentReadOnly,
    databaseData: ds.databaseData.proposed ?? ds.databaseData.currentReadOnly,
    selection: snapshotOf(draft.selection),
  };
}

// Fold a manager's freshly-built flat shape back onto the draft's proposed
// slots. A slice changed only when the manager returned a new reference for it,
// so an untouched slice keeps whatever a prior manager proposed (or null). The
// managers are already immutable (they spread {...shape} and replace only the
// slice they changed), which is what makes the reference check reliable.
export function foldIntoDraft(
  draft: DocDraft,
  before: DocShape,
  next: DocShape,
): DocDraft {
  if (next === before) return draft;
  const ds = draft.dataSet;

  const fileProposed =
    next.file !== before.file ? next.file : ds.fileData.proposed;
  const contentProposed =
    next.contentData !== before.contentData
      ? next.contentData
      : ds.contentData.proposed;
  const layoutProposed =
    next.layoutData !== before.layoutData
      ? next.layoutData
      : ds.layoutData.proposed;
  const databaseProposed =
    next.databaseData !== before.databaseData
      ? next.databaseData
      : ds.databaseData.proposed;

  return {
    ...draft,
    dataSet: {
      fileData: { ...ds.fileData, proposed: fileProposed },
      contentData: { ...ds.contentData, proposed: contentProposed },
      layoutData: { ...ds.layoutData, proposed: layoutProposed },
      databaseData: { ...ds.databaseData, proposed: databaseProposed },
    },
    selection: foldSelection(draft, before.selection, next.selection),
    created: collectCreated(draft, contentProposed),
  };
}

// The committed SelectionSnapshot the managers + commit read from the channel.
function snapshotOf(sel: DocDraft["selection"]): SelectionSnapshot {
  const ids = sel.proposedBlocks ?? sel.currentBlocks;
  const blockId = sel.caret.proposedBlockId ?? sel.caret.currentBlockId;
  const offset = sel.caret.proposedOffset ?? sel.caret.currentOffset;
  const caret = blockId !== null ? { blockId, offset: offset ?? 0 } : null;
  return { selectedBlockIds: ids, caret };
}

// Write selection onto proposed only when this manager actually changed it.
// Value comparison, because buildShape() hands back a fresh snapshot object
// every event even on a no-op.
function foldSelection(
  draft: DocDraft,
  before: SelectionSnapshot,
  next: SelectionSnapshot,
): DocDraft["selection"] {
  const cur = draft.selection;
  if (sameSnapshot(next, before)) return cur;
  return {
    currentBlocks: cur.currentBlocks,
    proposedBlocks: next.selectedBlockIds,
    caret: {
      currentBlockId: cur.caret.currentBlockId,
      currentOffset: cur.caret.currentOffset,
      proposedBlockId: next.caret ? next.caret.blockId : null,
      proposedOffset: next.caret ? next.caret.offset : null,
    },
  };
}

// Ids present in the proposed content but absent from the committed content.
function collectCreated(
  draft: DocDraft,
  contentProposed: ContentDataSet | null,
): DocDraft["created"] {
  if (contentProposed === null) return draft.created;
  const current = draft.dataSet.contentData.currentReadOnly;
  const ids = Object.keys(contentProposed).filter((id) => !(id in current));
  return { newBlockIds: ids.length > 0 ? ids : null };
}

function sameSnapshot(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  if (!sameCaret(a.caret, b.caret)) return false;
  if (a.selectedBlockIds.length !== b.selectedBlockIds.length) return false;
  for (let i = 0; i < a.selectedBlockIds.length; i++) {
    if (a.selectedBlockIds[i] !== b.selectedBlockIds[i]) return false;
  }
  return true;
}

function sameCaret(a: CaretTarget | null, b: CaretTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.blockId === b.blockId && a.offset === b.offset;
}

// Composite key so one block can be placed in many files without collisions.
// (Same block twice in the SAME file would need a unique placement id instead —
//  a later step, since selection + the DOM currently key off blockId.)
export const layoutKey = (fileId: string, blockId: string): string =>
  `${fileId}:${blockId}`;

// ── Database model ───────────────────────────────────────────────────────
// A database block is the same kind of dumb renderer as a text block: a
// TextElement with component "DatabaseArea". It holds NO rows and NO schema.
// Its schema, layout and row order live here, in a parallel dataset keyed by
// the block id — the same split that pulled placement out of TextElement into
// LayoutItem. The block points; this data is pointed at.
//
//   TextElement (component "DatabaseArea")
//        └─ id ──▶ DatabaseConfiguration   schema + identity (the "file")
//                      ├─ layout ─▶ DbLayoutData   width / position (extends LayoutData)
//                      └─ rows   ─▶ RowData[]      order + sort + filter
//                                       └─ cells ─▶ TextElement ids (existing content store)
//
// Three objects, one job each. No object holds raw cell text — cells are
// ordinary TextElement records in ContentDataSet, reached by id.

// One column in a database's schema. `key` is the stable id a RowData cell map
// is keyed by; `name` is the human label shown in the header. `type` is the
// cell's value kind — drives rendering/validation later; "text" for now.
export type DbColumnType = "text" | "number" | "date" | "select" | "checkbox";

export interface DbColumn {
  key: string; // stable id — RowData.cells is keyed by this
  name: string; // header label
  type: DbColumnType; // value kind (rendering/validation come later)
}

// Per-database geometry. Extends the same pure-geometry shape a block placement
// uses, so the column-width strip is the only addition. Width/position of the
// database block ITSELF still lives in the file's LayoutDataSet (the block is a
// normal placement); this is the database's INTERNAL layout — column widths and
// any future per-database view geometry.
export interface DbLayoutData extends LayoutData {
  columnWidths: Record<string, number>; // keyed by DbColumn.key — px width
}

// One row. Holds NO raw content — `cells` maps a column key to the TextElement
// id that renders that cell. So a cell is an ordinary block in ContentDataSet,
// editable by the same SM/contentEditable path every other block uses. `id` is
// the row's own id (a row is independently draggable, so it needs identity).
export interface RowData {
  id: string; // the row's own id (draggable target)
  cells: Record<string, string>; // column key → TextElement id (the cell)
}

// The "file" of a database: its schema + identity, plus pointers to its layout
// and its rows. Was going to be called rowData/databaseData; named
// DatabaseConfiguration because it also carries the active sort/filter — it's
// the whole configured view, not just the row list.
//
// rowOrder is the source of truth for vertical order (a row can be dragged up,
// down, or out). sort/filter are the CONFIGURED view state — recomputed over
// rowOrder at render. Both are optional: a database with neither shows rows in
// rowOrder as-is.
export interface DatabaseConfiguration {
  id: string; // matches the DatabaseArea block id
  name: string; // database label
  columns: DbColumn[]; // the schema
  rows: Record<string, RowData>; // row id → row (cells point to content)
  rowOrder: string[]; // the vertical order of row ids (drag reorders this)
  layout: DbLayoutData; // internal geometry (column widths)
  sort?: DbSort; // configured sort (recomputed over rowOrder)
  filters?: DbFilter[]; // configured filters (recomputed over rowOrder)
}

// Configured sort: which column, which direction. Applied over rowOrder at
// render — rowOrder itself is never mutated by a sort, only by an explicit drag.
export interface DbSort {
  columnKey: string;
  direction: "asc" | "desc";
}

// One configured filter clause. `op` is the comparison; `value` the operand.
// Kept deliberately small — extend the op set as real filtering lands.
export interface DbFilter {
  columnKey: string;
  op: "equals" | "contains" | "empty" | "not-empty";
  value?: string;
}

// All databases in the document, keyed by the DatabaseArea block id (NOT by a
// separate database id — one database block == one configuration, so the block
// id is the key, mirroring how LayoutDataSet keys by placement).
export type DatabaseDataSet = Record<string, DatabaseConfiguration>;

// Composite key helper kept for symmetry with layoutKey. A database is keyed by
// its block id alone today; this exists so call sites read the same way and a
// future per-file database instance can slot in without churn.
export const databaseKey = (blockId: string): string => blockId;

// ── Cell renderer contract ───────────────────────────────────────────────
// The uniform prop shape every typed cell renderer receives. A renderer is
// chosen by column type via CELL_REGISTRY; keeping these props uniform is what
// lets DatabaseArea fan out to ANY renderer without branching on the type
// (rule 1.2) — the same role MouseEventData plays for the mouse conduit.
//   cell — the TextElement backing this cell; its innerContent is the value.
// The three callbacks are the same conduit every block forwards through, so a
// cell decides nothing: it shapes a payload + trigger and hands it off.
export interface CellProps {
  cell: TextElement;
  contentDataSet: ContentDataSet;
  cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void;
  cbKeyboardEvent: (keyData: KeyEventData, trigger: TriggerWord) => void;
  cbLifecycleEvent: (
    lifecycleData: LifecycleEventData,
    trigger: TriggerWord,
  ) => void;
}

// A checkbox cell stores its boolean as the cell block's innerContent: this
// literal when checked, "" when unchecked. Lives here as the shared encoding
// contract so the renderer (reads it) and BlockManager (writes it on toggle)
// agree without one importing the other.
export const CHECKBOX_CHECKED = "true";

// ── Drag-container ───────────────────────────────────────────────────────

// The only DragManager capability DragContainer needs at render: "is this block
// the active drag target?". Declared structurally here so types.ts depends on
// nothing (DragManager satisfies this shape without types importing it).
export interface DragTargetQuery {
  isDragging: (blockId: string) => boolean;
}

export interface DragContainerProps {
  id: string;
  children: ReactNode;
  // The conduit — DragContainer forwards raw mouse data + trigger, never decides.
  cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void;
  // Block-selection flag — WSA reads it off the committed shape's selection.
  isSelected?: boolean;
  // The placement's geometry for this block in the active file. Optional only
  // while a block is first being placed (before its LayoutItem exists).
  layoutData?: LayoutData;
  // Lets the container yield `top` ownership to DM during an active drag.
  dm?: DragTargetQuery;
}
