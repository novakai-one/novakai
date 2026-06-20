// ── highlightRenderer.ts ──────────────────────────────────────────────────────
// Paints the selection using the CSS Custom Highlight API.
//
// IMPORTANT — why this does NOT cause a re-render:
//   CSS.highlights is a browser-level paint registry, not React state. Writing
//   to it changes pixels, not the component tree. No setter is called, no shape
//   is emitted, no stateful value changes. Blocks are never told they are
//   highlighted — they render their content and stay dumb. So this module is the
//   one place allowed to "draw" without touching the React/shape contract.
//
// Contract: read selection state + the block order, build a Range, paint it.
// Returns void. Never returns a shape. Never calls a setter.

import type { SelectionState, SelectionPoint } from "./selectionState";

// Name registered with CSS.highlights — the matching ::highlight(name) lives in CSS.
const HIGHLIGHT_NAME = "doc-selection";

// Entry point. Called after every selection-changing event.
// blockOrder is the ordered block-id list (shape.file.content), the single
// source of truth for document order — no DOM order reads.
export function renderSelectionHighlight(
    state: SelectionState,
    blockOrder: string[],
    wsaEl: HTMLElement | null,
): void {
    if (!wsaEl) return;

    // Nothing meaningful selected -> clear any existing paint and stop.
    if (state.anchor === null || state.focus === null || state.mode === "caret") {
        clearHighlight();
        return;
    }

    const range = buildResolvedRange(state.anchor, state.focus, blockOrder, wsaEl);
    if (range === null) {
        clearHighlight();
        return;
    }

    paintRange(range);
}

// Flattens a possibly cross-block anchor->focus pair into one DOM Range.
// Placeholder: real version walks blockOrder between anchor.blockId and
// focus.blockId, resolves each block's text node, and spans start->end.
export function buildResolvedRange(
    anchor: SelectionPoint,
    focus: SelectionPoint,
    blockOrder: string[],
    wsaEl: HTMLElement,
): Range | null {
    console.log("placeholder - trigger", anchor, focus, blockOrder, wsaEl);
    // Placeholder — returns null until DOM resolution is implemented.
    return null;
}

// Registers the range under the highlight name. The actual colour comes from
// the ::highlight(doc-selection) rule in CSS, not from here.
function paintRange(range: Range): void {
    console.log("placeholder - trigger", range);
    // Placeholder for the highlight registration:
    //   const highlight = new Highlight(range);
    //   CSS.highlights.set(HIGHLIGHT_NAME, highlight);
}

// Removes this module's highlight only. Does not stomp other highlights.
export function clearHighlight(): void {
    CSS.highlights.delete(HIGHLIGHT_NAME);
}
