//to be built -> post-block creation needs a way to focus caret. 
//to be checked -> Sm should run SM methods first then CM then needs to update range after CM in case it changed.
//-> Need to have a way of identifying selectedBlock
//New SM needs to have uniform shape for events -> It should not be deciding what goes to CM and what does not.
//Needs to follow same pattern as wsa where it routes uniformly regardless of teh event type.

import type { DocShape } from "./docShape";
import type { MouseEventData, KeyEventData, LifecycleEventData } from "./eventData";
import type { SelectionState } from "./selectionState";
import { emptySelection } from "./selectionState";
import { routeMouse, routeKey, routeLifecycle } from "./router";
import { renderSelectionHighlight } from "./highlightRenderer";
import { ClipboardManager } from "../ClaudeClipboardManager/ClipboardManager";
import { buildShape } from "./shapeBuilder";
import { orderedSelectionRange } from "./range";
import { isDeleteKey } from "./keyHandlers";


export class NewSelectionManager {

    private selection: SelectionState = emptySelection();   
    private wsaEl: HTMLElement | null = null;
    private clipboard = new ClipboardManager();

    // ── Block-selection store (read by WSA via useSyncExternalStore) ─────────
    // WSA needs to know which blocks are selected to pass `isSelected` to each
    // DragContainer. Selection lives here, so SM owns that fact. We cache the
    // id set and only swap the reference when it actually changes, so
    // getSelectedIds() is a stable snapshot (required by useSyncExternalStore).
    private selectedIds: Set<string> = new Set();
    private listeners = new Set<() => void>();

    public setWorkspaceEl = (el: HTMLElement | null): void => {
        this.wsaEl = el;
    };
    // ── Public entry points (called only by WSA) ─────────────────────────────
    // Three channels, identical contract: (eventData, trigger, shape) -> shape.
    // Uniform body for all three: build range -> clipboard -> route -> paint ->
    // shape. SM does NOT decide whether an event is a clipboard event; it threads
    // every event through the clipboard, which no-ops when the trigger is not a
    // clipboard keystroke (mirrors how WSA threads every event through every
    // helper).
    public receiveMouseEvent = (
        mouseData: MouseEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);
        const range = orderedSelectionRange(this.selection, order);
        const afterClipboard = this.clipboard.receiveEvent(mouseData, null, trigger, shape, range);

        this.selection = routeMouse(this.selection, mouseData, trigger, order);
        this.applyHighlights(order);
        this.syncSelectedIds(order);
        return buildShape(afterClipboard, this.selection);
    };

    public receiveKeyEvent = (
        keyData: KeyEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);
        const range = orderedSelectionRange(this.selection, order);
        const afterClipboard = this.clipboard.receiveEvent(keyData, null, trigger, shape, range);

        // A delete cuts the span as it stands BEFORE routing collapses it, so the
        // pre-route selection is what shapeBuilder must read to remove text.
        const deleting = trigger === "keydown" && isDeleteKey(keyData);
        const selectionToEdit = this.selection;

        this.selection = routeKey(this.selection, keyData, trigger, order);
        this.applyHighlights(order);
        this.syncSelectedIds(order);
        return buildShape(afterClipboard, selectionToEdit, deleting);
    };

    public receiveLifecycleEvent = (
        lifecycleData: LifecycleEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);
        const range = orderedSelectionRange(this.selection, order);
        const afterClipboard = this.clipboard.receiveEvent(lifecycleData, null, trigger, shape, range);

        this.selection = routeLifecycle(this.selection, lifecycleData, trigger);
        this.applyHighlights(order);
        this.syncSelectedIds(order);
        return buildShape(afterClipboard, this.selection);
    };


    // ── Block-selection subscription (WSA reads this) ────────────────────────
    // useSyncExternalStore contract: subscribe registers a listener and returns
    // an unsubscribe; getSelectedIds returns the current snapshot (same ref
    // until the set changes).
    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    public getSelectedIds = (): Set<string> => this.selectedIds;


    // ── Internal glue ────────────────────────────────────────────────────────

    // Single source of truth for document order: the active file's block-id list. //
    private blockOrder(shape: DocShape): string[] {
        return shape.file?.content ?? [];
    }

    // Paint the selection highlight. CSS.highlights only — no state, no re-render.
    private applyHighlights(order: string[]): void {
        renderSelectionHighlight(this.selection, order, this.wsaEl);
    }

    // Recompute which whole blocks are selected and notify WSA if it changed.
    // Only a multi-block selection marks blocks as selected; a caret or an
    // in-block text range is text selection, not block selection.
    private syncSelectedIds(order: string[]): void {
        const next = this.computeSelectedIds(order);
        if (sameSet(next, this.selectedIds)) return;
        this.selectedIds = next;
        for (const listener of this.listeners) listener();
    }

    private computeSelectedIds(order: string[]): Set<string> {
        if (this.selection.mode !== "multi-block") return new Set();
        const points = orderedSelectionRange(this.selection, order);
        return new Set(points.map((point) => point.blockId));
    }
}


// Set equality by membership — lets syncSelectedIds keep a stable reference when
// the selected blocks are unchanged (two empty sets compare equal).
function sameSet(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
}
