// ── BlockManager ─────────────────────────────────────────────────────────────
// A helper class in WSA's conduit, alongside SM, DM, LM. WSA forwards EVERY
// event with the uniform DocShape and gets the shape back. BlockManager owns
// CREATION and DELETION: on the triggers it cares about it adds/removes the
// block in the shape it was handed and returns it; every other trigger returns
// the shape untouched. It does NOT resolve collisions — LayoutManager does that
// next in the chain. WSA makes no decision; this class does.
//
// State: only the workspace element (handed in once on mount) so it can convert
// a click's viewport y into content y. The document lives in the shape, in/out.

import { snapToGrid, GRID_UNIT, PAGE_X } from '../../../layout/grid'
import {
    measuredBlockHeight,
    NEW_BLOCK_DEFAULT_W,
    NEW_BLOCK_DEFAULT_H,
    NEW_BLOCK_VERTICAL_GAP,
    NEW_BLOCK_TOP,
    NEW_BLOCK_CONTENT,
} from '../../workspace/workspaceLayout'
import { layoutKey } from '../../../types/types'
import { makeDatabaseConfig, makeDatabaseRow, DB_BLOCK_DEFAULT_H } from '../../../database/databaseFactory'
import type {
    ContentDataSet,
    LayoutDataSet,
    LayoutItem,
    TextElement,
    DatabaseDataSet,
    DatabaseConfiguration,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
    DocShape,
} from '../../../types/types'


export default class BlockManager {

    private _wsaEl: HTMLElement | null = null
    setWorkspaceEl = (el: HTMLElement | null): void => { this._wsaEl = el }


    // ── Conduit entry points (uniform shape) ─────────────────────────────────

    receiveMouseEvent = (mouseData: MouseEventData, trigger: string, shape: DocShape): DocShape => {
        switch (trigger) {
            case "workspace-click":    return this._createAtClick(mouseData, shape)
            case "database-add-row":   return this._addRow(mouseData, shape)
            default:                   return shape
        }
    }

    receiveKeyEvent = (keyData: KeyEventData, trigger: string, shape: DocShape): DocShape => {
        if (trigger !== "keydown") return shape
        // Temporary insert trigger: Cmd/Ctrl+Shift+D drops a database below.
        // Uses the existing key conduit (the panel block-event path isn't wired
        // in this build). Replace with a panel/omni-input selection later.
        if ((keyData.metaKey || keyData.ctrlKey) && keyData.shiftKey && keyData.key.toLowerCase() === "d") {
            keyData.nativeEvent.preventDefault()
            return this.createDatabase(shape)
        }
        switch (keyData.key) {
            case "Enter":     return this._createBelow(keyData, shape)
            case "Backspace": return this._deleteBlock(keyData, shape)
            default:          return shape
        }
    }

    receiveLifecycleEvent = (_data: LifecycleEventData, _trigger: string, shape: DocShape): DocShape => {
        return shape
    }


    // ── Canvas click → fresh empty paragraph on the clicked grid row ─────────
    // Owns the create guards (plain left click, no modifiers) and the geometry.
    // shape.file is the active file (WSA seeds it).
    private _createAtClick = (mouseData: MouseEventData, shape: DocShape): DocShape => {
        if (!shape.file || !this._wsaEl) return shape

        const plainLeftClick =
            mouseData.button === 0 &&
            !mouseData.metaKey && !mouseData.ctrlKey &&
            !mouseData.shiftKey && !mouseData.altKey
        if (!plainLeftClick) return shape

        const fileId = shape.file.id
        const rect = this._wsaEl.getBoundingClientRect()
        const y = snapToGrid(mouseData.clientY - rect.top + this._wsaEl.scrollTop)

        const newId = crypto.randomUUID()
        const block = makeBlock(newId, "ContentArea", "p", "")
        const placement: LayoutItem = {
            blockId: newId, fileId, x: PAGE_X, y, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
        }
        return this._addBlock(shape, block, placement, [...shape.file.content, newId])
    }


    // ── Enter → a new block directly below the source ────────────────────────
    // keyData.blockId is the block the caret was in. We commit its current text
    // (read live from the DOM) and drop the new block flush beneath it.
    private _createBelow = (keyData: KeyEventData, shape: DocShape): DocShape => {
        if (keyData.shiftKey) return shape          // Shift+Enter = native line break
        if (!shape.file) return shape
        keyData.nativeEvent.preventDefault()

        const fileId = shape.file.id
        const sourceId = keyData.blockId
        const sourceEl = shape.contentData[sourceId]
        if (!sourceEl) return shape

        // Commit the source block's live text/tag as part of the split.
        const live = readEditable(keyData.nativeEvent)
        const updatedSource: TextElement = { ...sourceEl, innerContent: live.value, Tag: live.tag }

        const sourceLayout = shape.layoutData[layoutKey(fileId, sourceId)]
        const sourceH = measuredBlockHeight(sourceId, sourceLayout?.h ?? NEW_BLOCK_DEFAULT_H)
        const newY = snapToGrid((sourceLayout?.y ?? NEW_BLOCK_TOP) + sourceH + NEW_BLOCK_VERTICAL_GAP)
        const newX = sourceLayout?.x ?? PAGE_X

        const newId = crypto.randomUUID()
        const block = makeBlock(newId, "ContentArea", live.tag, NEW_BLOCK_CONTENT)
        const placement: LayoutItem = {
            blockId: newId, fileId, x: newX, y: newY, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
        }

        const contentData: ContentDataSet = {
            ...shape.contentData, [sourceId]: updatedSource, [newId]: block,
        }
        const layoutData: LayoutDataSet = {
            ...shape.layoutData, [layoutKey(fileId, newId)]: placement,
        }
        const content = insertAfter(shape.file.content, sourceId, [newId])
        return { file: { ...shape.file, content }, contentData, layoutData, databaseData: shape.databaseData }
    }


    // ── Backspace on an empty block → delete it ──────────────────────────────
    private _deleteBlock = (keyData: KeyEventData, shape: DocShape): DocShape => {
        if (!isEmptyEditable(keyData.nativeEvent)) return shape   // only empty blocks
        if (!shape.file) return shape
        keyData.nativeEvent.preventDefault()

        const fileId = shape.file.id
        const blockId = keyData.blockId
        if (!shape.contentData[blockId]) return shape

        const contentData: ContentDataSet = { ...shape.contentData }
        delete contentData[blockId]
        const layoutData: LayoutDataSet = { ...shape.layoutData }
        delete layoutData[layoutKey(fileId, blockId)]

        // If the deleted block was a database, drop its configuration too.
        // Its cell blocks live in contentData; deleting them is a later step
        // (the cells are reachable only through the config we're removing).
        let databaseData: DatabaseDataSet = shape.databaseData
        if (databaseData[blockId]) {
            databaseData = { ...databaseData }
            delete databaseData[blockId]
        }

        const content = shape.file.content.filter(id => id !== blockId)
        return { file: { ...shape.file, content }, contentData, layoutData, databaseData }
    }


    // Add one block + its placement to the shape, with the given new content order.
    private _addBlock = (
        shape: DocShape,
        block: TextElement,
        placement: LayoutItem,
        content: string[],
    ): DocShape => {
        if (!shape.file) return shape
        const contentData: ContentDataSet = { ...shape.contentData, [block.id]: block }
        const layoutData:  LayoutDataSet  = {
            ...shape.layoutData, [layoutKey(placement.fileId, block.id)]: placement,
        }
        return { file: { ...shape.file, content }, contentData, layoutData, databaseData: shape.databaseData }
    }


    // ── Insert a database block at the bottom of the active file ─────────────
    // Public so a panel/omni-input selection can call it through the block-event
    // store later. Creates THREE things in one commit, mirroring the data split:
    //   1. a TextElement (component "DatabaseArea") — the dumb renderer
    //   2. its LayoutItem — the block's placement on the file canvas
    //   3. its DatabaseConfiguration — schema + seed row, keyed by the block id
    // The configuration's seed cells are real TextElement records added to
    // contentData, so every cell edits through the same path as any other block.
    createDatabase = (shape: DocShape): DocShape => {
        if (!shape.file) return shape
        const fileId = shape.file.id

        const newId = crypto.randomUUID()
        const block = makeBlock(newId, "DatabaseArea", "div", "")

        // Place it below everything currently on the file (single-column drop).
        const lowestY = lowestPlacedBottom(fileId, shape.layoutData)
        const y = snapToGrid(lowestY + NEW_BLOCK_VERTICAL_GAP)
        const placement: LayoutItem = {
            blockId: newId, fileId, x: PAGE_X, y, w: NEW_BLOCK_DEFAULT_W, h: DB_BLOCK_DEFAULT_H,
        }

        // Seed schema + one empty row. Cells are fresh TextElement records.
        const { config, cellBlocks } = makeDatabaseConfig(newId)

        const contentData: ContentDataSet = { ...shape.contentData, [newId]: block }
        for (const cell of cellBlocks) contentData[cell.id] = cell

        const layoutData: LayoutDataSet = {
            ...shape.layoutData, [layoutKey(fileId, newId)]: placement,
        }
        const databaseData: DatabaseDataSet = { ...shape.databaseData, [newId]: config }
        const content = [...shape.file.content, newId]
        return { file: { ...shape.file, content }, contentData, layoutData, databaseData }
    }


    // ── Append an empty row to an existing database ──────────────────────
    // mouseData.blockId is the database block id (the add-row affordance tags it).
    // Builds one cell block per column, appends the row id to rowOrder, and folds
    // the cells into contentData so each edits through the normal block path.
    private _addRow = (mouseData: MouseEventData, shape: DocShape): DocShape => {
        const dbId = mouseData.blockId
        const config: DatabaseConfiguration | undefined = shape.databaseData[dbId]
        if (!config) return shape

        const { row, cellBlocks } = makeDatabaseRow(config.columns, dbId)

        const contentData: ContentDataSet = { ...shape.contentData }
        for (const cell of cellBlocks) contentData[cell.id] = cell

        const updatedConfig: DatabaseConfiguration = {
            ...config,
            rows: { ...config.rows, [row.id]: row },
            rowOrder: [...config.rowOrder, row.id],
        }
        const databaseData: DatabaseDataSet = { ...shape.databaseData, [dbId]: updatedConfig }
        return { ...shape, contentData, databaseData }
    }
}


// Bottom edge (y + h) of the lowest placement on a file — where the next
// bottom-dropped block starts. Returns NEW_BLOCK_TOP when the file is empty.
function lowestPlacedBottom(fileId: string, layouts: LayoutDataSet): number {
    let bottom = NEW_BLOCK_TOP
    for (const item of Object.values(layouts)) {
        if (item.fileId !== fileId) continue
        const itemBottom = item.y + (item.h || GRID_UNIT)
        if (itemBottom > bottom) bottom = itemBottom
    }
    return bottom
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


// ── contentEditable reads (the only DOM BlockManager touches besides height) ──

// The live text + resolved tag of the block that fired a key event. Read from
// the event's currentTarget (the contentEditable) so Enter commits exactly what
// the user sees, not stale store state.
function readEditable(event: KeyEventData['nativeEvent']): { value: string, tag: TextElement['Tag'] } {
    const target = event.currentTarget as HTMLElement
    const value = target.textContent ?? ""
    const tagName = target.tagName.toLowerCase()
    const tag = (ALLOWED_TAGS.has(tagName) ? tagName : "p") as TextElement['Tag']
    return { value, tag }
}

// True when the contentEditable that fired the event has no text — the only case
// where Backspace deletes the whole block.
function isEmptyEditable(event: KeyEventData['nativeEvent']): boolean {
    const target = event.currentTarget as HTMLElement
    return (target.textContent ?? "").length === 0
}

const ALLOWED_TAGS = new Set([
    "h1", "h2", "h3", "h4", "h5", "p", "span", "ol", "ul", "li", "div", "blockquote",
])
