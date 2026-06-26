// @flowmap-node dom kind=service
// ── domHelpers.ts ─────────────────────────────────────────────────────────────
// The ONLY module that reads/writes the DOM.
// Reads return plain values. Writes paint directly (e.g. CSS Highlights API).
// Never calls a setter. Never returns a shape. Never triggers re-render.
//
// Block elements are found by the `data-blockid` attribute ContentArea renders,
// which is unique per block, so these reads need no workspace root passed in.

import type { SelectionPoint } from "../core/selectionState";

// Maps a viewport point to a document position: which block was hit, and the
// character offset inside that block's text. Off any block -> empty blockId.
export function pointToPosition(clientX: number, clientY: number): SelectionPoint {
    const caret = caretPositionAt(clientX, clientY);
    if (!caret) return emptyPoint();

    const blockEl = blockElementContaining(caret.node);
    if (!blockEl) return emptyPoint();

    const offset = textOffsetWithin(blockEl, caret.node, caret.offset);
    return { blockId: blockIdOf(blockEl), offset, offsetEnd: offset };
}

// Maps a document position back to viewport coords — the top-left of the caret
// rectangle at that block + offset. Missing block or node -> origin.
export function positionToCoords(point: SelectionPoint): { clientX: number; clientY: number } {
    const blockEl = blockElementById(point.blockId);
    if (!blockEl) return { clientX: 0, clientY: 0 };

    const located = textNodeAtOffset(blockEl, point.offset);
    if (!located) return { clientX: 0, clientY: 0 };

    const caretRange = document.createRange();
    caretRange.setStart(located.node, located.offset);
    caretRange.collapse(true);

    const rect = caretRange.getBoundingClientRect();
    return { clientX: rect.left, clientY: rect.top };
}

// Reads the plain-text content of a block by id. Missing block -> empty string.
export function getElementText(blockId: string): string {
    const blockEl = blockElementById(blockId);
    return blockEl ? blockEl.textContent ?? "" : "";
}

// Locates the text node + offset for a target character offset into a block's
// text, walking its text nodes in order. Used by callers that need a DOM Range
// boundary (caret coords, highlight ranges) from a logical offset.
export function textNodeAtOffset(
    blockEl: HTMLElement,
    targetOffset: number,
): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let consumed = 0;

    let textNode = walker.nextNode() as Text | null;
    while (textNode) {
        const length = textNode.data.length;
        if (consumed + length >= targetOffset) {
            return { node: textNode, offset: targetOffset - consumed };
        }
        consumed += length;
        textNode = walker.nextNode() as Text | null;
    }

    // Offset past the end (or no text nodes): clamp to the last boundary.
    return lastTextBoundary(blockEl);
}

// The block element for a blockId, scoped by the data-blockid attribute.
export function blockElementById(blockId: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-blockid="${blockId}"]`);
}


// ── Internal DOM glue ─────────────────────────────────────────────────────────

function emptyPoint(): SelectionPoint {
    return { blockId: "", offset: 0, offsetEnd: 0 };
}

// caretPositionFromPoint is the standard; Firefox uses caretRangeFromPoint.
// Returns the text node + offset under the cursor, normalised across both APIs.
function caretPositionAt(clientX: number, clientY: number): { node: Node; offset: number } | null {
    const doc = document as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    if (doc.caretPositionFromPoint) {
        const position = doc.caretPositionFromPoint(clientX, clientY);
        return position ? { node: position.offsetNode, offset: position.offset } : null;
    }
    if (doc.caretRangeFromPoint) {
        const range = doc.caretRangeFromPoint(clientX, clientY);
        return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }
    return null;
}

// Walks up from a node to the nearest element carrying data-blockid.
function blockElementContaining(node: Node): HTMLElement | null {
    const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
    return start ? start.closest<HTMLElement>("[data-blockid]") : null;
}

function blockIdOf(blockEl: HTMLElement): string {
    return blockEl.getAttribute("data-blockid") ?? "";
}

// The character offset of (node, nodeOffset) measured from the start of the
// block's text — the inverse of textNodeAtOffset.
function textOffsetWithin(blockEl: HTMLElement, node: Node, nodeOffset: number): number {
    const measureRange = document.createRange();
    measureRange.selectNodeContents(blockEl);
    measureRange.setEnd(node, nodeOffset);
    return measureRange.toString().length;
}

// The last valid text boundary in a block: the final text node at its end, or
// null when the block holds no text node at all.
function lastTextBoundary(blockEl: HTMLElement): { node: Text; offset: number } | null {
    const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT);
    let lastNode: Text | null = null;

    let textNode = walker.nextNode() as Text | null;
    while (textNode) {
        lastNode = textNode;
        textNode = walker.nextNode() as Text | null;
    }

    return lastNode ? { node: lastNode, offset: lastNode.data.length } : null;
}
