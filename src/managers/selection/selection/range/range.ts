// ── range.ts ──────────────────────────────────────────────────────────────────
// Flattens a selection (anchor/focus) into the ordered list of SelectionPoints
// it spans, using blockOrder (shape.file.content) as the document order.
//
// Pure. No DOM reads. No state. No setters.
//
// Each emitted point carries the [offset, offsetEnd] span SELECTED within its
// block, derived from its position in the run:
//   - single block      : start edge -> end edge (both real offsets)
//   - first block        : its offset -> end of block (offsetEnd -1)
//   - middle blocks      : whole block (offset -1, offsetEnd -1)
//   - last block         : start of block -> its offset (offset 0)

import type { SelectionState, SelectionPoint } from "../core/selectionState";

// @flowmap-node selection__range kind=function
export function orderedSelectionRange(
    selection: SelectionState,
    order: string[],
): SelectionPoint[] {
    const { anchor, focus } = selection;
    if (!anchor) return [];
    if (!focus) return [wholeFromCaret(anchor)];

    const anchorIdx = order.indexOf(anchor.blockId);
    const focusIdx  = order.indexOf(focus.blockId);

    // Either end missing from the order list: fall back to the raw two points.
    if (anchorIdx === -1 || focusIdx === -1) return [anchor, focus];

    const start = documentStart(anchor, anchorIdx, focus, focusIdx);
    const end   = documentEnd(anchor, anchorIdx, focus, focusIdx);

    if (start.blockId === end.blockId) return [singleBlockSpan(start, end)];

    return spanAcrossBlocks(start, end, order);
}


// ── Edge resolution ────────────────────────────────────────────────────────────

// The selection edge that comes FIRST in document order.
function documentStart(
    anchor: SelectionPoint, anchorIdx: number,
    focus: SelectionPoint, focusIdx: number,
): SelectionPoint {
    return anchorIdx <= focusIdx ? anchor : focus;
}

// The selection edge that comes LAST in document order.
function documentEnd(
    anchor: SelectionPoint, anchorIdx: number,
    focus: SelectionPoint, focusIdx: number,
): SelectionPoint {
    return anchorIdx <= focusIdx ? focus : anchor;
}


// ── Span builders ───────────────────────────────────────────────────────────────

// One block selected: span runs from the start edge's offset to the end edge's.
function singleBlockSpan(start: SelectionPoint, end: SelectionPoint): SelectionPoint {
    return { blockId: start.blockId, offset: start.offset, offsetEnd: end.offset };
}

// Multi-block: walk every block in the run between the two edges and tag each
// with the portion of it that is selected.
function spanAcrossBlocks(
    start: SelectionPoint,
    end: SelectionPoint,
    order: string[],
): SelectionPoint[] {
    const startIdx = order.indexOf(start.blockId);
    const endIdx   = order.indexOf(end.blockId);

    const points: SelectionPoint[] = [];
    for (let i = startIdx; i <= endIdx; i++) {
        const blockId = order[i];
        if (blockId === start.blockId)      points.push(firstBlockSpan(start));
        else if (blockId === end.blockId)   points.push(lastBlockSpan(end));
        else                                points.push(wholeBlock(blockId));
    }
    return points;
}

// First block of a multi-block run: from its offset to the end of the block.
function firstBlockSpan(start: SelectionPoint): SelectionPoint {
    return { blockId: start.blockId, offset: start.offset, offsetEnd: -1 };
}

// Last block of a multi-block run: from the start of the block to its offset.
function lastBlockSpan(end: SelectionPoint): SelectionPoint {
    return { blockId: end.blockId, offset: 0, offsetEnd: end.offset };
}

// A fully-selected middle block.
function wholeBlock(blockId: string): SelectionPoint {
    return { blockId, offset: -1, offsetEnd: -1 };
}

// A collapsed caret with no second edge: treat the whole block as the span.
function wholeFromCaret(caret: SelectionPoint): SelectionPoint {
    return { blockId: caret.blockId, offset: caret.offset, offsetEnd: caret.offset };
}
