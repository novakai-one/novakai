// ── BlockManager ─────────────────────────────────────────────────────────────
// Owns block CREATION and DELETION. Given one BlockEvent + the current document
// slices, it builds the new block(s) and proposes where they sit — or marks a
// block for removal. It has NO opinion on collisions: it places per the trigger
// using what's already on the canvas, and hands the result back to WSA.
//
// Pure: reads the slices it's given, returns the next slices. No store, no save,
// no React. The only outside read is measuredBlockHeight (live DOM height of the
// anchor) so "below X" lands flush instead of guessing X's height.
//
// WSA then merges newPlacements into the layout set and calls LayoutManager
// (resolveEventLayout) to validate. LayoutManager's output is what gets stored —
// BlockManager's positions are a proposal, never the final word.

import { snapToGrid, GRID_UNIT, PAGE_X, rowsForHeight, heightForRows } from '../layout/grid'
import {
    measuredBlockHeight,
    NEW_BLOCK_DEFAULT_W,
    NEW_BLOCK_DEFAULT_H,
    NEW_BLOCK_VERTICAL_GAP,
    NEW_BLOCK_TOP,
    NEW_BLOCK_CONTENT,
} from '../components/workspace/workspaceLayout'
import { layoutKey } from '../types/types'
import type {
    BlockEvent,
    ContentDataSet,
    FileData,
    LayoutChangeMode,
    LayoutDataSet,
    LayoutItem,
    TextElement,
} from '../types/types'


// The slices BlockManager reads. WSA's currentSlices() is a superset, so it
// passes straight in (extra `files` field is ignored here).
export interface BlockManagerSlices {
    file:    FileData
    dataSet: ContentDataSet
    layouts: LayoutDataSet
}


// What BlockManager hands back to WSA. `content` is the new membership/order for
// the active file; `newPlacements` are the placements to MERGE into the layout
// set (empty for a delete). `subjectIds` / `deleted` tell LayoutManager what
// changed so it runs the right pass.
export interface BlockProposal {
    dataSet:       ContentDataSet
    content:       string[]
    newPlacements: LayoutItem[]
    mode:          LayoutChangeMode
    subjectIds:    string[]                                    // add: the new ids
    deleted?:      { y: number; h: number; key: string }       // delete: the hole + key to strip
    focusStartId?: string                                      // caret to start of this block
    focusEndId?:   string | null                               // caret to end of this block
}


// The one entry WSA calls. Routes the trigger to the matching builder.
export function runBlockEvent(event: BlockEvent, slices: BlockManagerSlices): BlockProposal | null {
    switch (event.trigger) {
        case "enter":                 return createBelow(slices, event)
        case "canvas-click":          return createAtY(slices, event)
        case "block-panel-selection": return insertAtBottom(slices, event)
        case "delete":                return deleteBlock(slices, event)
        default:                      return null
    }
}


// ── Enter: a new block directly below the source ─────────────────────────────

function createBelow(slices: BlockManagerSlices, event: BlockEvent): BlockProposal | null {
    const sourceId = event.callerId
    const value = event.payload?.value ?? ""
    const tag   = event.payload?.tag ?? "p"

    const sourceEl = slices.dataSet[sourceId]
    if (!sourceEl) return null

    // The Enter also commits whatever the user had typed in the source block.
    const updatedSource: TextElement = { ...sourceEl, innerContent: value, Tag: tag }

    const newId = crypto.randomUUID()
    const sourceLayout = slices.layouts[layoutKey(slices.file.id, sourceId)]
    const sourceH = measuredBlockHeight(sourceId, sourceLayout?.h ?? NEW_BLOCK_DEFAULT_H)
    const newY = snapToGrid((sourceLayout?.y ?? NEW_BLOCK_TOP) + sourceH + NEW_BLOCK_VERTICAL_GAP)
    const newX = sourceLayout?.x ?? PAGE_X

    const newBlock = makeBlock(newId, "ContentArea", tag, NEW_BLOCK_CONTENT)
    const newLayout: LayoutItem = {
        blockId: newId, fileId: slices.file.id,
        x: newX, y: newY, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
    }

    const dataSet: ContentDataSet = { ...slices.dataSet, [sourceId]: updatedSource, [newId]: newBlock }
    const content = insertAfter(slices.file.content, sourceId, [newId])

    return { dataSet, content, newPlacements: [newLayout], mode: "add", subjectIds: [newId], focusStartId: newId }
}


// ── Canvas click: a fresh empty paragraph on the clicked row ─────────────────

function createAtY(slices: BlockManagerSlices, event: BlockEvent): BlockProposal | null {
    const y = event.payload?.y
    if (y === undefined) return null

    const newId = crypto.randomUUID()
    const newBlock = makeBlock(newId, "ContentArea", "p", "")
    const newLayout: LayoutItem = {
        blockId: newId, fileId: slices.file.id,
        x: PAGE_X, y, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
    }

    const dataSet: ContentDataSet = { ...slices.dataSet, [newId]: newBlock }
    const content = [...slices.file.content, newId]

    return { dataSet, content, newPlacements: [newLayout], mode: "add", subjectIds: [newId], focusStartId: newId }
}


// ── Panel selection: insert the chosen block below the lowest one ────────────

function insertAtBottom(slices: BlockManagerSlices, event: BlockEvent): BlockProposal | null {
    const spec = event.payload?.spec
    if (!spec) return null

    // Bottom edge of the lowest placement. Stored h may be stale, but it only
    // seeds the proposed y — LayoutManager re-measures and resolves after.
    const bottoms = slices.file.content
        .map(bid => slices.layouts[layoutKey(slices.file.id, bid)])
        .filter((p): p is LayoutItem => Boolean(p))
        .map(p => p.y + p.h)
    const y = snapToGrid(bottoms.length ? Math.max(...bottoms) + NEW_BLOCK_VERTICAL_GAP : NEW_BLOCK_TOP)

    const newId = crypto.randomUUID()
    const newBlock = makeBlock(newId, spec.component, spec.Tag, NEW_BLOCK_CONTENT, spec.classNames ?? "")
    const newLayout: LayoutItem = {
        blockId: newId, fileId: slices.file.id,
        x: PAGE_X, y, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
    }

    const dataSet: ContentDataSet = { ...slices.dataSet, [newId]: newBlock }
    const content = [...slices.file.content, newId]

    return { dataSet, content, newPlacements: [newLayout], mode: "add", subjectIds: [newId], focusStartId: newId }
}


// ── Delete: remove an empty block, report the hole it left ───────────────────

function deleteBlock(slices: BlockManagerSlices, event: BlockEvent): BlockProposal | null {
    const blockId = event.callerId
    if (!slices.dataSet[blockId]) return null

    // Measure the hole BEFORE removal (the block is still in the DOM — delete
    // runs synchronously). LayoutManager pulls everything below up by this.
    const deletedLayout = slices.layouts[layoutKey(slices.file.id, blockId)]
    const deletedY = deletedLayout?.y ?? 0
    const deletedH = heightForRows(rowsForHeight(measuredBlockHeight(blockId, deletedLayout?.h ?? GRID_UNIT)))

    const dataSet: ContentDataSet = { ...slices.dataSet }
    delete dataSet[blockId]

    // Caret lands on the previous block in document order (none if it was first).
    const deletedIdx = slices.file.content.indexOf(blockId)
    const focusEndId = deletedIdx > 0 ? slices.file.content[deletedIdx - 1] : null

    const content = slices.file.content.filter(id => id !== blockId)

    return {
        dataSet, content, newPlacements: [], mode: "delete", subjectIds: [],
        deleted: { y: deletedY, h: deletedH, key: layoutKey(slices.file.id, blockId) },
        focusEndId,
    }
}


// ── Builders ─────────────────────────────────────────────────────────────────

function makeBlock(
    id: string,
    component: TextElement['component'],
    tag: TextElement['Tag'],
    innerContent: string,
    classNames: string = "",
): TextElement {
    return {
        id, component, Tag: tag,
        styles: "", classNames, innerContent,
        parentId: null, children: null, files: [],
    }
}

// Insert ids directly after anchorId in document order (appends if not found).
function insertAfter(content: string[], anchorId: string, ids: string[]): string[] {
    const idx = content.indexOf(anchorId)
    if (idx === -1) return [...content, ...ids]
    return [...content.slice(0, idx + 1), ...ids, ...content.slice(idx + 1)]
}
