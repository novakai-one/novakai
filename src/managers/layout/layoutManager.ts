// ── LayoutManager ───────────────────────────────────────────────────────────
// Keeps the document tidy after structural changes: pulls blocks up to fill the
// hole a deleted block left behind. WSA is the only caller (it measures the
// deleted rect and persists the result).
//
// NOTE (layout-layer review pending): _tidy delegates to workspaceLayout helpers
// that read the live DOM (measuredBlockHeight). So this layer is NOT DOM-free as
// originally stated — flagged for the later layout/ boundary review.
//
// Single-column assumption (same as CollisionManager): a full-width delete pulls
// EVERYTHING below up by the vacated height. When x unlocks, restrict the pull
// to blocks whose x-range overlaps the deleted column.

import type {
  LayoutItem,
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
  DocShape,
  DocDraft,
} from "../../types/types";
import { draftToFlat, foldIntoDraft } from "../draft";
import {
  resolveFileCollisions,
  orderByPosition,
} from "./module/workspaceLayout";

// ── LayoutManager (class) ────────────────────────────────────────────────
// The last helper in WSA's conduit. Receives the shape AFTER BlockManager has
// added or removed a block, tidies the layout (resolve overlaps, re-order the
// file's block ids top-left), and returns the shape for WSA to commit. Triggers
// with no layout consequence return the shape untouched.
//
// It tidies whenever the layout could have changed (a structural key or click).
// Resolving an already-tidy layout is a no-op that returns equal data, so an
// over-eager pass costs nothing — React diffs by reference at commit.
// @flowmap-node layout kind=class
export default class LayoutManager {
  // @flowmap-node layout__layMouse kind=function
  receiveMouseEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as MouseEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveMouseFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node layout__layKey kind=function
  receiveKeyEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as KeyEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveKeyFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node layout__layLife kind=function
  receiveLifecycleEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as LifecycleEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveLifecycleFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node layout__mouseFlat kind=function
  private _receiveMouseFlat = (
    _mouseData: MouseEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    // "workspace-area-mouse-click" = a create on the canvas.
    // "workspace-area-mouse-up" = a drag ended (DragManager wrote the moved
    // placement just before us in the fan-out). Both can change layout, so both
    // tidy. A tidy on an unchanged layout is a referential no-op, so an
    // over-eager mouse-up costs nothing.
    if (trigger === "workspace-area-mouse-click") return this._tidy(shape);
    if (trigger === "workspace-area-mouse-up") return this._tidy(shape);
    // A panel insert (BlockManager just dropped the block at the bottom) tidies
    // too, so document order tracks the new placement.
    if (trigger === "left-panel-block-mouse-click") return this._tidy(shape);
    return shape;
  };

  // @flowmap-node layout__keyFlat kind=function
  private _receiveKeyFlat = (
    keyData: KeyEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    if (trigger !== "content-area-key-down") return shape;
    if (keyData.key === "Enter" || keyData.key === "Backspace")
      return this._tidy(shape);
    return shape;
  };

  // @flowmap-node layout__lifeFlat kind=function
  private _receiveLifecycleFlat = (
    _data: LifecycleEventData,
    _trigger: string,
    shape: DocShape,
  ): DocShape => {
    return shape;
  };

  // ── Tidy the active file: resolve overlaps, re-order ids top-left ────────
  // Works off the shape's own file + layout (BlockManager already applied the
  // create/delete). Pushes any overlap down, then sorts the file's block ids
  // by placement so document order tracks the layout.
  // @flowmap-node layout__tidy kind=function
  private _tidy = (shape: DocShape): DocShape => {
    if (!shape.file) return shape;
    const fileId = shape.file.id;

    const fileItems = Object.values(shape.layoutData).filter(
      (item) => item.fileId === fileId,
    );
    if (fileItems.length === 0) return shape;

    // Top-left order, and the lowest placement is the freshest mover.
    const orderedIds = [...fileItems]
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((item) => item.blockId);
    const movedId = this._lowestPlacedId(fileItems);

    const layoutData = resolveFileCollisions(
      fileId,
      orderedIds,
      shape.layoutData,
      movedId,
    );
    const content = orderByPosition(orderedIds, fileId, layoutData, 0);
    return { ...shape, file: { ...shape.file, content }, layoutData };
  };

  // The block at the greatest y — the one BlockManager most likely just placed.
  // @flowmap-node layout__lowest kind=function
  private _lowestPlacedId = (items: LayoutItem[]): string => {
    let pick = items[0];
    for (const item of items) if (item.y >= pick.y) pick = item;
    return pick.blockId;
  };
}
