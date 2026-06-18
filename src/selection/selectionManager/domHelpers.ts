// domHelpers.ts
//
// Pure DOM read/write helpers for selection. These are the ONLY functions in
// the codebase that read window.getSelection() / the block DOM, or write the
// caret back to the browser. No selection state lives here — every function
// takes what it needs as arguments.
//
// ── ZWS (U+200B) rule ───────────────────────────────────────────────────────
//   contentEditable injects U+200B at caret boundaries. Range endpoints MUST
//   use node.length (raw), NOT nodeText.length (stripped). nodeText strips the
//   ZWS, and using it for Range endpoints causes off-by-one errors that drop
//   the last character from cross-block highlight ranges. nodeText is safe for
//   text extraction (display / clipboard) only.
//
// ── DOM CLIMBING SAFETY ──────────────────────────────────────────────────────
//   readBlockContent reads the [contenteditable="true"] element directly —
//   NEVER the outer .content-area wrapper. Reading the wrapper saves the Tag
//   markup, so on reload the block re-wraps, producing <p><p>...</p></p>. Within
//   a few reloads the tree is unrecoverable.

import type { TextElement } from '../../types/types'
import type { BlockType } from './types'
import { SelectionPoint } from './SelectionPoint'


export function stripZWS(text: string): string {
    return text.replace('​', '')
}


// Walks up from a node to the nearest [data-blockid] ancestor.
// wsaEl is the walk boundary — outside means coordinates landed outside any block.
export function blockIdFromNode(node: Node, wsaEl: HTMLElement): string | null {
    let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node
    while (current && current !== wsaEl) {
        if (current instanceof HTMLElement && current.hasAttribute('data-blockid')) {
            return current.getAttribute('data-blockid')
        }
        current = current.parentNode
    }
    return null
}


export function snapshotBrowserCaret(blockId: string, blockType: BlockType = "content-area"): SelectionPoint | null {
    const browserSelection = window.getSelection()
    if (!browserSelection || browserSelection.rangeCount === 0) return null

    const range = browserSelection.getRangeAt(0)
    const node  = range.startContainer
    if (node.nodeType !== Node.TEXT_NODE) return null

    const point = new SelectionPoint()
    point.node      = node as Text
    point.nodeText  = stripZWS((node as Text).nodeValue || '')
    point.blockId   = blockId
    point.blockType = blockType
    point.offset    = range.startOffset
    return point
}


export function caretPointFromCoordinates(
    x: number,
    y: number,
    wsaEl: HTMLElement,
    blockType: BlockType = "content-area"
): SelectionPoint | null {
    const caretPosition = document.caretPositionFromPoint(x, y)
    if (!caretPosition) return null

    let textNode: Text
    let resolvedOffset: number

    if (caretPosition.offsetNode.nodeType === Node.TEXT_NODE) {
        textNode       = caretPosition.offsetNode as Text
        resolvedOffset = caretPosition.offset
    } else {
        // Empty editable case: clicking an editable with no text children
        // returns the element itself as offsetNode. Find/insert a text node
        // so the caret has a home and SM's anchor.node can be tracked.
        const el = caretPosition.offsetNode as Element
        const editable = el.matches?.('[contenteditable="true"]')
            ? (el as HTMLElement)
            : (el.closest?.('[contenteditable="true"]') as HTMLElement | null)
        if (!editable) return null
        let existing = Array.from(editable.childNodes).find(
            n => n.nodeType === Node.TEXT_NODE
        ) as Text | undefined
        if (!existing) {
            existing = document.createTextNode('')
            editable.appendChild(existing)
        }
        textNode       = existing
        resolvedOffset = 0
    }

    const blockId  = blockIdFromNode(textNode, wsaEl)
    if (!blockId) return null

    const point = new SelectionPoint()
    point.node      = textNode
    point.nodeText  = stripZWS(textNode.data || '')
    point.blockId   = blockId
    point.blockType = blockType
    point.offset    = resolvedOffset
    return point
}


// First/last contentEditable Text nodes inside a block. Queries from wsaEl
// (NOT child-walking) so it works regardless of intermediate wrappers.
export function getFirstTextNodeForBlock(blockId: string, wsaEl: HTMLElement): Text | null {
    const editable = findEditableForBlock(blockId, wsaEl)
    if (!editable) return null
    return (editable.childNodes[0] as Text) ?? null
}

export function getLastTextNodeForBlock(blockId: string, wsaEl: HTMLElement): Text | null {
    const editable = findEditableForBlock(blockId, wsaEl)
    if (!editable) return null
    const childNodes = editable.childNodes
    for (let i = childNodes.length - 1; i >= 0; i--) {
        if (childNodes[i].nodeType === Node.TEXT_NODE) return childNodes[i] as Text
    }
    return null
}


// SAFE lookup — handles both cases:
//  - data-blockid lives directly on the contentEditable Tag
//  - data-blockid lives on a wrapper, contentEditable is a descendant
// Never reads from the outer .content-area div directly.
export function findEditableForBlock(blockId: string, wsaEl: HTMLElement): HTMLElement | null {
    const blockEl = wsaEl.querySelector<HTMLElement>(`[data-blockid="${blockId}"]`)
    if (!blockEl) return null
    if (blockEl.matches('[contenteditable="true"]')) return blockEl
    return blockEl.querySelector<HTMLElement>('[contenteditable="true"]') ?? null
}


// Previous/next text node within the same contentEditable element.
// Used by arrow-key caret movement across <br> lines inside one block.
export function getPrevTextNodeInBlock(node: Text): Text | null {
    const siblings = node.parentElement?.childNodes
    if (!siblings) return null
    const idx = Array.from(siblings).indexOf(node)
    for (let i = idx - 1; i >= 0; i--) {
        if (siblings[i].nodeType === Node.TEXT_NODE) return siblings[i] as Text
    }
    return null
}

export function getNextTextNodeInBlock(node: Text): Text | null {
    const siblings = node.parentElement?.childNodes
    if (!siblings) return null
    const idx = Array.from(siblings).indexOf(node)
    for (let i = idx + 1; i < siblings.length; i++) {
        if (siblings[i].nodeType === Node.TEXT_NODE) return siblings[i] as Text
    }
    return null
}


// Reads the live contentEditable text + tag for a block.
// SAFE: reads from the editable element only — never the outer wrapper.
// See DOM CLIMBING SAFETY at top of file.
//
// IMPORTANT: uses innerText, NOT innerHTML. ContentArea writes back via
// contentRef.current.innerText = innerContent on mount. If we read innerHTML
// here, the saved string contains raw <br>/<span>/etc. markup which then
// renders as literal text on the next mount (innerText setter doesn't parse
// HTML). Each click would HTML-escape further, producing strings like
// "abc&lt;br&gt;1". innerText round-trips clean: <br> -> \n on read, \n -> <br>
// on write.
export function readBlockContent(blockId: string, wsaEl: HTMLElement): { value: string; tag: TextElement['Tag'] } | null {
    const editable = findEditableForBlock(blockId, wsaEl)
    if (!editable) return null
    const rawText = editable.innerText ?? ''
    const value   = rawText === '​' ? '' : rawText
    const tag     = editable.tagName.toLowerCase() as TextElement['Tag']
    return { value, tag }
}


// True if (x, y) lands inside any [data-blockid] element. Used to distinguish
// dead-space clicks from in-block clicks.
export function coordinatesAreInsideBlock(x: number, y: number): boolean {
    const target = document.elementFromPoint(x, y)
    if (!target) return false
    return target.closest('[data-blockid]') !== null
}


// The ONLY place that writes the caret back to window.getSelection().
export function pushCaretToDOM(point: SelectionPoint): void {
    if (!point.node) return
    const browserSelection = window.getSelection()
    if (!browserSelection) return

    const range      = document.createRange()
    const safeOffset = Math.min(point.offset, point.node.length)
    range.setStart(point.node, safeOffset)
    range.collapse(true)
    browserSelection.removeAllRanges()
    browserSelection.addRange(range)
}


// Serialises a cloned Range fragment into an HTML string, stripping ZWS.
export function fragmentToHtmlString(fragment: DocumentFragment): string {
    const wrapper = document.createElement('div')
    wrapper.appendChild(fragment)
    return wrapper.innerHTML.replace(/​/g, '')
}


export function getTagForBlock(blockId: string, wsaEl: HTMLElement): string {
    const editable = findEditableForBlock(blockId, wsaEl)
    return editable?.tagName.toLowerCase() ?? 'p'
}
