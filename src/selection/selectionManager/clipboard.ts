// clipboard.ts
//
// Pure builders that turn the current selection (anchor / focus / resolved
// range) into a structured clipboard payload and plain text. No state and no
// clipboard I/O — SelectionManager owns navigator.clipboard and the in-memory
// fallback. Callers must guarantee an active selection before calling, and for
// cross-block selections the resolved range must already be built.

import type { ClipboardBlockData, ResolvedRange } from './types'
import type { SelectionPoint } from './SelectionPoint'
import {
    fragmentToHtmlString,
    getTagForBlock,
    getFirstTextNodeForBlock,
    getLastTextNodeForBlock,
} from './domHelpers'


// One ClipboardBlockData per (partially or fully) selected block.
export function buildClipboardBlocks(
    anchor: SelectionPoint,
    focus: SelectionPoint,
    resolved: ResolvedRange | null,
    wsaEl: HTMLElement,
): ClipboardBlockData[] {
    const isSingleBlock = anchor.blockId === focus.blockId

    if (isSingleBlock) {
        if (!anchor.node || !focus.node) return []
        const range = new Range()
        if (anchor.node === focus.node) {
            const startOffset = Math.min(anchor.offset, focus.offset)
            const endOffset   = Math.max(anchor.offset, focus.offset)
            range.setStart(anchor.node, startOffset)
            range.setEnd(anchor.node, endOffset)
        } else {
            const anchorBefore = !!(anchor.node.compareDocumentPosition(focus.node) & Node.DOCUMENT_POSITION_FOLLOWING)
            const [sn, so, en, eo] = anchorBefore
                ? [anchor.node, anchor.offset, focus.node, focus.offset]
                : [focus.node,  focus.offset,  anchor.node, anchor.offset]
            range.setStart(sn, so)
            range.setEnd(en, eo)
        }
        return [{
            html: fragmentToHtmlString(range.cloneContents()),
            tag:  getTagForBlock(anchor.blockId, wsaEl),
        }]
    }

    if (!resolved) return []

    const blocks: ClipboardBlockData[] = []

    if (resolved.start.node) {
        const lastNode = getLastTextNodeForBlock(resolved.start.blockId, wsaEl) ?? resolved.start.node
        const range = new Range()
        range.setStart(resolved.start.node, resolved.start.offset)
        range.setEnd(lastNode, lastNode.length)
        blocks.push({
            html: fragmentToHtmlString(range.cloneContents()),
            tag:  getTagForBlock(resolved.start.blockId, wsaEl),
        })
    }

    for (const mp of resolved.middle) {
        const tag = getTagForBlock(mp.blockId, wsaEl)
        if (!mp.node) {
            blocks.push({ html: '', tag })
            continue
        }
        const lastNode = getLastTextNodeForBlock(mp.blockId, wsaEl) ?? mp.node
        const range = new Range()
        range.setStart(mp.node, 0)
        range.setEnd(lastNode, lastNode.length)
        blocks.push({
            html: fragmentToHtmlString(range.cloneContents()),
            tag,
        })
    }

    if (resolved.end.node) {
        const firstNode = getFirstTextNodeForBlock(resolved.end.blockId, wsaEl) ?? resolved.end.node
        const range = new Range()
        range.setStart(firstNode, 0)
        range.setEnd(resolved.end.node, resolved.end.offset)
        blocks.push({
            html: fragmentToHtmlString(range.cloneContents()),
            tag:  getTagForBlock(resolved.end.blockId, wsaEl),
        })
    }

    return blocks
}


// Plain-text extraction of the current selection (single- or cross-block).
export function computeSelectedText(
    anchor: SelectionPoint,
    focus: SelectionPoint,
    resolved: ResolvedRange | null,
): string {
    const isSingleBlock = anchor.blockId === focus.blockId

    if (isSingleBlock) {
        if (!anchor.node || !focus.node) return ""
        if (anchor.node === focus.node) {
            const startOffset = Math.min(anchor.offset, focus.offset)
            const endOffset   = Math.max(anchor.offset, focus.offset)
            return anchor.nodeText.substring(startOffset, endOffset)
        }
        const anchorBefore = !!(anchor.node.compareDocumentPosition(focus.node) & Node.DOCUMENT_POSITION_FOLLOWING)
        const [sn, so, en, eo] = anchorBefore
            ? [anchor.node, anchor.offset, focus.node, focus.offset]
            : [focus.node,  focus.offset,  anchor.node, anchor.offset]
        const range = new Range()
        range.setStart(sn, so)
        range.setEnd(en, eo)
        return range.toString()
    }

    if (!resolved) return ""

    const lastTextSiblingOf = (node: Text): Text => {
        const children = node.parentElement?.childNodes
        if (!children) return node
        for (let i = children.length - 1; i >= 0; i--) {
            if (children[i].nodeType === Node.TEXT_NODE) return children[i] as Text
        }
        return node
    }
    const firstTextSiblingOf = (node: Text): Text => {
        const children = node.parentElement?.childNodes
        if (!children) return node
        for (let i = 0; i < children.length; i++) {
            if (children[i].nodeType === Node.TEXT_NODE) return children[i] as Text
        }
        return node
    }

    const startLastNode = lastTextSiblingOf(resolved.start.node!)
    const startRange    = new Range()
    startRange.setStart(resolved.start.node!, resolved.start.offset)
    startRange.setEnd(startLastNode, startLastNode.length)
    const startText = startRange.toString()

    const middleText = resolved.middle.map(point => {
        if (!point.node) return ""
        const firstNode = firstTextSiblingOf(point.node)
        const lastNode  = lastTextSiblingOf(point.node)
        const range     = new Range()
        range.setStart(firstNode, 0)
        range.setEnd(lastNode, lastNode.length)
        return range.toString()
    }).join("\n")

    const endFirstNode = firstTextSiblingOf(resolved.end.node!)
    const endRange     = new Range()
    endRange.setStart(endFirstNode, 0)
    endRange.setEnd(resolved.end.node!, resolved.end.offset)
    const endText = endRange.toString()

    return [startText, middleText, endText].filter(Boolean).join("\n")
}
