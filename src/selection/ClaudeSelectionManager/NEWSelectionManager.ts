// ── Module layout ────────────────────────────────────────────────────────────
//   docShape          — re-exports canonical DocShape + member types
//   eventData         — re-exports canonical MouseEventData / KeyEventData / LifecycleEventData
//   selectionState    — SelectionPoint / SelectionState / SelectionMode + transforms
//   domHelpers        — the ONLY place that reads/writes the DOM
//   mouseHandlers     — pure mouse gesture logic
//   caretNavigation   — plain Arrow caret movement (pure)
//   selectionExtend   — Shift / Cmd+Shift extends + Select All (pure)
//   keyHandlers       — full keyboard command map (owns preventDefault)
//   lifecycleHandlers — pure lifecycle logic (blur; future focus / input)
//   highlightRenderer — paints selection via CSS.highlights (no re-render)
//   router            — trigger -> one handler (mouse / key / lifecycle)
//   shapeBuilder      — builds the new DocShape returned to WSA
//   NewSelectionManager — state + delegation (this file)
//
// Design boundary:
//   No module triggers a re-render. CSS.highlights paints pixels, not state.
//   SM: shape in -> new shape out, 100% of the time.
//   Selection state lives here, never inside DocShape.
//   Block order is read from shape.file.content — one source of truth, no DOM order.
//
// Event channels (canonical contract): three families, one entry point each.
// The full event reaches SM (KeyEventData carries nativeEvent) so SM owns every
// preventDefault. WSA threads the event in; SM stays the only conduit consumer.

import type { DocShape } from "./docShape";
import type { MouseEventData, KeyEventData, LifecycleEventData } from "./eventData";
import type { SelectionState, SelectionPoint } from "./selectionState";
import { emptySelection } from "./selectionState";
import { routeMouse, routeKey, routeLifecycle } from "./router";
import { renderSelectionHighlight } from "./highlightRenderer";
import { ClipboardManager } from "../ClaudeClipboardManager/ClipboardManager";
import { buildShape } from "./shapeBuilder";


// ─────────────────────────────────────────────────────────────────────────────
// NewSelectionManager
// Holds selection state. Delegates routing, handling, painting, and shape
// building to modules. Selection state lives here, never inside DocShape.
// ─────────────────────────────────────────────────────────────────────────────

export class NewSelectionManager {

    // ── Private selection state ──────────────────────────────────────────────
    private selection: SelectionState = emptySelection();

    // ── DOM root, set once by WSA on mount (scoping root for paint/reads) ─────
    private wsaEl: HTMLElement | null = null;

    // ── Clipboard helper (owns copy / cut / paste decisions + buffer) ────────
    private clipboard = new ClipboardManager();


    // ── Lifecycle wiring (called by WSA) ─────────────────────────────────────
    public setWorkspaceEl = (el: HTMLElement | null): void => {
        this.wsaEl = el;
    };


    // ── Public entry points (called only by WSA) ─────────────────────────────
    // Three channels, identical contract: (eventData, trigger, shape) -> shape.
    // Each: route -> update selection -> paint highlight -> return new shape.

    public receiveMouseEvent = (
        mouseData: MouseEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);
        this.selection = routeMouse(this.selection, mouseData, trigger, order);
        this.paint(order);
        return buildShape(shape, this.selection);
    };

    public receiveKeyEvent = (
        keyData: KeyEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);

        // Clipboard first: CM reads the event, decides copy/cut/paste, and returns
        // a (possibly) new shape. Non-clipboard keystrokes return the shape unchanged.
        const range = this.selectionRange(order);
        const afterClipboard = this.clipboard.receiveEvent(keyData, null, trigger, shape, range);

        // Then SM's own key routing: arrows / extend / Tab / Escape. Selection only.
        this.selection = routeKey(this.selection, keyData, trigger, order);
        this.paint(order);
        return buildShape(afterClipboard, this.selection);
    };

    public receiveLifecycleEvent = (
        lifecycleData: LifecycleEventData,
        trigger: string,
        shape: DocShape,
    ): DocShape => {
        const order = this.blockOrder(shape);
        this.selection = routeLifecycle(this.selection, lifecycleData, trigger);
        this.paint(order);
        return buildShape(shape, this.selection);
    };


    // ── Internal glue ────────────────────────────────────────────────────────

    // Single source of truth for document order: the active file's block-id list.
    private blockOrder(shape: DocShape): string[] {
        return shape.file?.content ?? [];
    }

    // Paint the selection highlight. CSS.highlights only — no state, no re-render.
    private paint(order: string[]): void {
        renderSelectionHighlight(this.selection, order, this.wsaEl);
    }

    // Selection as the range CM consumes: every block id the selection covers,
    // as SelectionPoint[]. Anchor and focus are the two ends; file.content (a
    // trusted, DOM-ordered id list) fills in the blocks between them.
    //
    // Single block -> one point. Cross-block -> one point per covered block, in
    // document order. CM still dedupes/sorts (selectionRange.ts), so emitting the
    // span here is the only thing SM owns.
    private selectionRange(order: string[]): SelectionPoint[] {
        const { anchor, focus } = this.selection;
        if (!anchor) return [];
        if (!focus) return [anchor];

        const anchorIdx = order.indexOf(anchor.elementId);
        const focusIdx  = order.indexOf(focus.elementId);

        // Either end missing from the order list: fall back to the raw two points.
        if (anchorIdx === -1 || focusIdx === -1) return [anchor, focus];

        const startIdx = Math.min(anchorIdx, focusIdx);
        const endIdx   = Math.max(anchorIdx, focusIdx);

        const points: SelectionPoint[] = [];
        for (let i = startIdx; i <= endIdx; i++) {
            const elementId = order[i];
            // Ends carry their real offset. Middle blocks are whole-block: offset
            // -1 marks "no partial offset, take the entire block".
            if (elementId === anchor.elementId)      points.push(anchor);
            else if (elementId === focus.elementId)  points.push(focus);
            else                                     points.push({ elementId, offset: -1 });
        }
        return points;
    }
}
