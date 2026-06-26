// DragManager.ts
// Owns active drag state and moves the dragged container live.
// Pure receiver: WorkspaceArea is the ONLY conduit. DM attaches NO listeners of
// its own. It receives raw mouse events + a trigger and decides what to do based
// on its OWN state.
//
// Ownership of `top` during a drag:
//   - DM writes style.top straight to the dragged node every mouse-move.
//   - While a block is the active drag target, React must NOT also write top
//     from the saved layout, or a commit mid-drag (e.g. a debounced save landing,
//     a selection change) re-renders the block and yanks it back to the stale
//     stored y — the teleport bug.
//   - DragContainer asks DM `isDragging(id)` at render and omits top when true,
//     so DM is the SINGLE owner of top for the duration of the gesture. No local
//     flag, no listener-order races.
//
// Click vs drag (threshold):
//   - mousedown arms a PENDING drag but does not start it.
//   - the drag becomes ACTIVE only once the pointer moves past DRAG_THRESHOLD_PX.
//   - a mouseup before the threshold is a plain click: nothing committed, no
//     teleport guard ever engaged.

import type {
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
  DocShape,
  DocDraft,
} from "../../../../types/types";
import { draftToFlat, foldIntoDraft } from "../../../../managers/draft";
import { layoutKey } from "../../../../model/model";

type Position = {
  x: number;
  y: number;
};

// Pointer must travel this far from mousedown before it counts as a drag.
const DRAG_THRESHOLD_PX = 4;

// @flowmap-node drag kind=class
export default class DragManager {
  // DM owns all of its state.
  private activeEl: HTMLElement | null = null;
  private activeId: string | null = null;

  // Two-phase: armed on mousedown (pending), promoted to active once the
  // pointer crosses DRAG_THRESHOLD_PX. `isActive` gates the live DOM move and
  // the top-ownership guard; a click that never crosses the threshold leaves
  // isActive false and commits nothing.
  private isArmed: boolean = false;
  private isActive: boolean = false;

  // Where the mousedown landed (viewport), used to measure threshold distance.
  private startClient: Position = { x: 0, y: 0 };

  // offset = distance between mouse and top-left corner of container when the
  // drag goes active. Without it the container snaps its corner to the cursor.
  private mouseOffset: Position = { x: 0, y: 0 };

  // Last workspace-local position written during the active drag -> handed to
  // the drop commit. Seeded from the container's CURRENT position when the drag
  // goes active so a near-zero move preserves the existing placement.
  private lastLocal: Position = { x: 0, y: 0 };

  // Horizontal movement is DISABLED for now — blocks are a single column pinned
  // to PAGE_X (see DragContainer). Dragging only reorders vertically. Flip to
  // false to re-enable free x once the collision manager + resizing exist.
  private lockX: boolean = true;

  // WorkspaceArea hands DM the workspace element ONCE on mount. DM measures it
  // live on every move so scroll/resize never makes it stale.
  private workspaceEl: HTMLElement | null = null;

  // @flowmap-node drag__setWsEl kind=function
  setWorkspaceEl = (el: HTMLElement | null): void => {
    this.workspaceEl = el;
  };

  // Read by DragContainer at render: is THIS block the active drag target?
  // True only once the threshold is crossed, so a pending (not-yet-moved)
  // gesture does not yet take top ownership.
  // @flowmap-node drag__isDragging kind=function
  isDragging = (blockId: string): boolean => {
    return this.isActive && this.activeId === blockId;
  };

  // ── Conduit entry points (the ONLY things WorkspaceArea calls) ───────────
  // @flowmap-node drag__dragMouse kind=function
  receiveMouseEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as MouseEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveMouseFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node drag__dragKey kind=function
  receiveKeyEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as KeyEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveKeyFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node drag__dragLife kind=function
  receiveLifecycleEvent = (draft: DocDraft): DocDraft => {
    const data = draft.event.data as LifecycleEventData;
    const trigger = draft.event.triggerWord;
    const before = draftToFlat(draft);
    const next = this._receiveLifecycleFlat(data, trigger, before);
    return foldIntoDraft(draft, before, next);
  };

  // @flowmap-node drag__mouseFlat kind=function
  private _receiveMouseFlat = (
    mouseData: MouseEventData,
    trigger: string,
    shape: DocShape,
  ): DocShape => {
    if (trigger === "drag-handle-mouse-down") this.armDrag(mouseData);
    if (trigger === "workspace-area-mouse-move") this.moveActive(mouseData);
    if (trigger === "workspace-area-mouse-up") return this.endDrag(shape);
    return shape;
  };

  // @flowmap-node drag__keyFlat kind=function
  private _receiveKeyFlat = (
    _keyData: KeyEventData,
    _trigger: string,
    shape: DocShape,
  ): DocShape => shape;
  // @flowmap-node drag__lifeFlat kind=function
  private _receiveLifecycleFlat = (
    _data: LifecycleEventData,
    _trigger: string,
    shape: DocShape,
  ): DocShape => shape;

  // ── Arm: mousedown on a handle. Records the target + start point, but the
  // drag is not active until the pointer crosses the threshold. ────────────
  // @flowmap-node drag__arm kind=function
  private armDrag = (mouseData: MouseEventData): void => {
    const target = document.elementFromPoint(
      mouseData.clientX,
      mouseData.clientY,
    );
    const el = target?.closest(".drag-container") as HTMLElement | null;
    if (!el) return;

    this.activeEl = el;
    this.activeId = el.id;
    this.startClient = { x: mouseData.clientX, y: mouseData.clientY };
    this.isArmed = true;
    this.isActive = false;
  };

  // ── Promote: first move past the threshold turns the armed gesture into an
  // active drag. Captures the grab offset + seeds lastLocal from the live box.
  // @flowmap-node drag__activate kind=function
  private activateDrag = (mouseData: MouseEventData): void => {
    if (!this.activeEl) return;
    const rect = this.activeEl.getBoundingClientRect();

    this.mouseOffset = {
      x: mouseData.clientX - rect.left,
      y: mouseData.clientY - rect.top,
    };

    if (this.workspaceEl) {
      const ws = this.workspaceEl.getBoundingClientRect();
      this.lastLocal = {
        x: rect.left - ws.left + this.workspaceEl.scrollLeft,
        y: rect.top - ws.top + this.workspaceEl.scrollTop,
      };
    } else {
      this.lastLocal = { x: rect.left, y: rect.top };
    }

    this.isActive = true;
  };

  // ── Move: promote on threshold, then move the active container live. ─────
  // @flowmap-node drag__move kind=function
  private moveActive = (mouseData: MouseEventData): void => {
    if (!this.isArmed || !this.activeEl) return;

    if (!this.isActive) {
      const dx = mouseData.clientX - this.startClient.x;
      const dy = mouseData.clientY - this.startClient.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return; // still a click
      this.activateDrag(mouseData);
    }

    if (!this.workspaceEl) return;
    const ws = this.workspaceEl.getBoundingClientRect();

    // .drag-container is absolute inside the relative, SCROLLABLE workspace.
    // style.top is content-space, so convert the viewport cursor to
    // content-space: subtract ws.top, add scrollTop.
    let localX =
      mouseData.clientX -
      this.mouseOffset.x -
      ws.left +
      this.workspaceEl.scrollLeft;
    let localY =
      mouseData.clientY -
      this.mouseOffset.y -
      ws.top +
      this.workspaceEl.scrollTop;

    // Clamp to the scrollable content bounds (not just the visible window).
    localX = Math.max(
      0,
      Math.min(
        localX,
        this.workspaceEl.scrollWidth - this.activeEl.offsetWidth,
      ),
    );
    localY = Math.max(
      0,
      Math.min(
        localY,
        this.workspaceEl.scrollHeight - this.activeEl.offsetHeight,
      ),
    );

    // X locked → leave style.left to CSS (PAGE_X), keep seeded x in lastLocal.
    if (!this.lockX) {
      this.activeEl.style.left = `${localX}px`;
    } else {
      localX = this.lastLocal.x;
    }
    this.activeEl.style.top = `${localY}px`;

    this.lastLocal = { x: localX, y: localY };
  };

  // ── End: commit the final position only if the drag actually went active.
  // A click (never crossed the threshold) commits nothing. ─────────────────
  // @flowmap-node drag__end_ kind=function
  private endDrag = (shape: DocShape): DocShape => {
    if (!this.isArmed || !this.activeId) {
      this.cleanup();
      return shape;
    }

    const movedId = this.activeId;
    const finalLocal = this.lastLocal;
    const wasActive = this.isActive;

    this.cleanup();

    if (!wasActive || !shape.file) return shape;
    return this.applyPlacement(shape, shape.file.id, movedId, finalLocal);
  };

  // Write one block's new workspace-local point into the shape's layout. Pure:
  // returns a new shape. LayoutManager (next in the fan-out) resolves overlap.
  // @flowmap-node drag__apply kind=function
  private applyPlacement = (
    shape: DocShape,
    fileId: string,
    blockId: string,
    finalLocal: Position,
  ): DocShape => {
    const key = layoutKey(fileId, blockId);
    const existing = shape.layoutData[key];
    if (!existing) return shape;
    const layoutData = {
      ...shape.layoutData,
      [key]: { ...existing, x: finalLocal.x, y: finalLocal.y },
    };
    return { ...shape, layoutData };
  };

  // Reset all gesture state. No listeners to remove -> DM never attached any.
  // @flowmap-node drag__cleanup kind=function
  private cleanup = (): void => {
    this.activeEl = null;
    this.activeId = null;
    this.isArmed = false;
    this.isActive = false;
    this.startClient = { x: 0, y: 0 };
    this.mouseOffset = { x: 0, y: 0 };
    this.lastLocal = { x: 0, y: 0 };
  };
}
