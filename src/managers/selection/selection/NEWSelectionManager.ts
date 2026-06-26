//to be built -> post-block creation needs a way to focus caret.
//to be checked -> Sm should run SM methods first then CM then needs to update range after CM in case it changed.
//-> Need to have a way of identifying selectedBlock
//New SM needs to have uniform shape for events -> It should not be deciding what goes to CM and what does not.
//Needs to follow same pattern as wsa where it routes uniformly regardless of teh event type.

import type {
  DocShape,
  DocDraft,
  SelectionSnapshot,
  CaretTarget,
} from "./core/docShape";
import { draftToFlat, foldIntoDraft } from "./core/docShape";
import type {
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
} from "./event-handlers/eventData";
import type { SelectionState } from "./core/selectionState";
import { emptySelection } from "./core/selectionState";
import { emptySelectionSnapshot } from "./core/docShape";
import { routeMouse, routeKey, routeLifecycle } from "./core/router";
import { renderSelectionHighlight } from "./highlighting/highlightRenderer";
import { ClipboardManager } from "../clipboard/ClipboardManager";
import { buildShape } from "./core/shapeBuilder";
import { orderedSelectionRange } from "./range/range";
import { isDeleteKey } from "./event-handlers/keyHandlers";

// @flowmap-node selection kind=class
export class NewSelectionManager {
  private selection: SelectionState = emptySelection();
  private wsaEl: HTMLElement | null = null;
  private clipboard = new ClipboardManager();

  // Last snapshot handed back, kept so an unchanged selection returns the SAME
  // reference. WSA reads selectedBlockIds off this via a store selector; a fresh
  // object every event would re-render WSA on every keystroke. Stable ref =
  // no re-render when nothing about the selection changed.
  private lastSnapshot: SelectionSnapshot = emptySelectionSnapshot();

  public setWorkspaceEl = (el: HTMLElement | null): void => {
    this.wsaEl = el;
  };
  // ── Public entry points (called only by WSA) ─────────────────────────────
  // Three channels, identical contract: (eventData, trigger, shape) -> shape.
  // Uniform body for all three: build range -> clipboard -> route -> paint ->
  // snapshot -> shape. SM does NOT decide whether an event is a clipboard event;
  // it threads every event through the clipboard, which no-ops when the trigger
  // is not a clipboard keystroke (mirrors how WSA threads every event through
  // every helper). The selection result is written INTO the shape as a
  // SelectionSnapshot — no external store, no subscription.
  // @flowmap-node selection__selMouse kind=function
  public receiveMouseEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as MouseEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveMouseFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node selection__selKey kind=function
  public receiveKeyEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as KeyEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveKeyFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node selection__selLife kind=function
  public receiveLifecycleEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as LifecycleEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveLifecycleFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node selection__mouseFlat kind=function
  private _receiveMouseFlat = (
    mouseData: MouseEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    const order = this.blockOrder(shape);
    const range = orderedSelectionRange(this.selection, order);
    const afterClipboard = this.clipboard.receiveEvent(
      mouseData,
      null,
      trigger,
      shape,
      range,
    );

    this.selection = routeMouse(this.selection, mouseData, trigger, order);
    this.applyHighlights(order);
    return buildShape(
      afterClipboard,
      this.selection,
      this.computeSnapshot(order),
    );
  };

  // @flowmap-node selection__keyFlat kind=function
  private _receiveKeyFlat = (
    keyData: KeyEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    const order = this.blockOrder(shape);
    const range = orderedSelectionRange(this.selection, order);
    const afterClipboard = this.clipboard.receiveEvent(
      keyData,
      null,
      trigger,
      shape,
      range,
    );

    // A delete cuts the span as it stands BEFORE routing collapses it, so the
    // pre-route selection is what shapeBuilder must read to remove text.
    const deleting =
      trigger === "content-area-key-down" && isDeleteKey(keyData);
    const selectionToEdit = this.selection;

    this.selection = routeKey(this.selection, keyData, trigger, order);
    this.applyHighlights(order);
    return buildShape(
      afterClipboard,
      selectionToEdit,
      this.computeSnapshot(order),
      deleting,
    );
  };

  // @flowmap-node selection__lifeFlat kind=function
  private _receiveLifecycleFlat = (
    lifecycleData: LifecycleEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    const order = this.blockOrder(shape);
    const range = orderedSelectionRange(this.selection, order);
    const afterClipboard = this.clipboard.receiveEvent(
      lifecycleData,
      null,
      trigger,
      shape,
      range,
    );

    this.selection = routeLifecycle(this.selection, lifecycleData, trigger);
    this.applyHighlights(order);
    return buildShape(
      afterClipboard,
      this.selection,
      this.computeSnapshot(order),
    );
  };

  // ── Internal glue ────────────────────────────────────────────────────────

  // Single source of truth for document order: the active file's block-id list. //
  // @flowmap-node selection__order kind=function
  private blockOrder(shape: DocShape): string[] {
    return shape.file?.content ?? [];
  }

  // Paint the selection highlight. CSS.highlights only — no state, no re-render.
  // @flowmap-node selection__paint kind=function
  private applyHighlights(order: string[]): void {
    renderSelectionHighlight(this.selection, order, this.wsaEl);
  }

  // The selection result WSA reads off the shape: which whole blocks are
  // selected, and where the caret should sit. Only a multi-block selection
  // marks whole blocks; a collapsed caret carries a caret target. Returns the
  // previous snapshot's reference unchanged when nothing differs, so WSA does
  // not re-render on a no-op selection pass.
  // @flowmap-node selection__snap kind=function
  private computeSnapshot(order: string[]): SelectionSnapshot {
    const next: SelectionSnapshot = {
      selectedBlockIds: this.computeSelectedIds(order),
      caret: this.computeCaret(),
    };
    if (sameSnapshot(next, this.lastSnapshot)) return this.lastSnapshot;
    this.lastSnapshot = next;
    return next;
  }

  // @flowmap-node selection__selIds kind=function
  private computeSelectedIds(order: string[]): string[] {
    if (this.selection.mode !== "multi-block") return [];
    const points = orderedSelectionRange(this.selection, order);
    return points.map((point) => point.blockId);
  }

  // A collapsed caret (focus === anchor) is the position WSA may place. A live
  // text range has no single caret, so it reports none.
  // @flowmap-node selection__caret kind=function
  private computeCaret(): CaretTarget | null {
    const { focus } = this.selection;
    if (!focus) return null;
    if (this.selection.mode !== "caret") return null;
    return { blockId: focus.blockId, offset: focus.offset };
  }
}

// Snapshot equality by value — lets computeSnapshot return a stable reference
// when the selection is unchanged, so WSA's store selector does not re-render.
// @flowmap-node selection__sameSnap kind=function
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
