// @flowmap-node draft kind=module
// ── draft.ts ──────────────────────────────────────────────────────────────
// The conduit functions that build and thread a DocDraft through the
// bm -> sm -> dm -> lm manager chain. Moved out of types/types.ts so that file
// holds types only (the law). These are VALUES, not types, so they live in a
// shared module under managers/ — the one place every manager and WSA may reach
// for the uniform draft plumbing. Imports below are type-only; this module adds
// no value dependency back into types, so no cycle is introduced.
import type {
  DocDraft,
  DocShape,
  FileData,
  ContentDataSet,
  LayoutDataSet,
  DatabaseDataSet,
  SelectionSnapshot,
  CaretTarget,
} from "../types/types";

// @flowmap-node draft__emptysnap kind=function
export function emptySelectionSnapshot(): SelectionSnapshot {
  return { selectedBlockIds: [], caret: null };
}

// Seed a fresh draft from the committed store slices. All proposed start null.
// @flowmap-node draft__buildDraft kind=function
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
// @flowmap-node draft__draftToFlat kind=function
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
// @flowmap-node draft__foldIntoDraft kind=function
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
// @flowmap-node draft__snapshotOf kind=function
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
// @flowmap-node draft__foldSelection kind=function
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
// @flowmap-node draft__collectCreated kind=function
function collectCreated(
  draft: DocDraft,
  contentProposed: ContentDataSet | null,
): DocDraft["created"] {
  if (contentProposed === null) return draft.created;
  const current = draft.dataSet.contentData.currentReadOnly;
  const ids = Object.keys(contentProposed).filter((id) => !(id in current));
  return { newBlockIds: ids.length > 0 ? ids : null };
}

// @flowmap-node draft__sameSnapshot kind=function
function sameSnapshot(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
  if (!sameCaret(a.caret, b.caret)) return false;
  if (a.selectedBlockIds.length !== b.selectedBlockIds.length) return false;
  for (let i = 0; i < a.selectedBlockIds.length; i++) {
    if (a.selectedBlockIds[i] !== b.selectedBlockIds[i]) return false;
  }
  return true;
}

// @flowmap-node draft__sameCaret kind=function
function sameCaret(a: CaretTarget | null, b: CaretTarget | null): boolean {
  if (a === null || b === null) return a === b;
  return a.blockId === b.blockId && a.offset === b.offset;
}
