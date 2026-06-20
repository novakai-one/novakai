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
//   clipboard         — clipboard scaffolding (placeholders)
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
import type { SelectionState } from "./selectionState";
import { emptySelection } from "./selectionState";
import { routeMouse, routeKey, routeLifecycle } from "./router";
import type { KeyCommandHooks } from "./keyHandlers";
import { renderSelectionHighlight } from "./highlightRenderer";
import { ClipboardController } from "./clipboard";
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

    // ── Clipboard surface (scaffolding) ──────────────────────────────────────
    private clipboard = new ClipboardController();


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
        this.selection = routeKey(this.selection, keyData, trigger, order, this.keyHooks());
        this.paint(order);
        return buildShape(shape, this.selection);
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

    // Impure clipboard / clear actions handed to the keyboard map so keyHandlers
    // stays pure w.r.t. selection state.
    private keyHooks(): KeyCommandHooks {
        return {
            copy:         () => { void this.clipboard.copy(this.selection, [], this.wsaEl); },
            pasteAtCaret: () => { /* placeholder: paste -> BlockManager via BlockEvent */ },
            clearAll:     () => { /* placeholder: clear block-selection store */ },
        };
    }
}
