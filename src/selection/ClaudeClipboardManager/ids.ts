import type {
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    LayoutItem,
    TextElement,
    DatabaseConfiguration,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import type { ClipboardSlice } from "./clipboardStore"

// Re-keys a clipboard slice so its blocks can be pasted into `fileId`.
// COPY mints fresh ids (the paste is a new block); CUT keeps ids (same block, moved).
// Returns the re-keyed slice plus the old->new id map for later reference remapping.

export interface RegenResult {
    slice: ClipboardSlice,
    idMap: Record<string, string>,
}

export interface RegenOptions {
    keepSameIds?: boolean, // CUT keeps ids (same block moved); COPY (default) mints new ones
}

export function regenerateIds(
    slice: ClipboardSlice,
    fileId: string,
    opts: RegenOptions = {},
): RegenResult {
    const idMap = mapOldIdsToNew(slice.contentData, opts.keepSameIds ?? false)

    return {
        slice: {
            contentData:  rebuildContentUnderNewIds(slice.contentData, idMap),
            layoutData:   rebuildLayoutUnderNewIds(slice.layoutData, idMap, fileId),
            databaseData: rebuildDatabasesUnderNewIds(slice.databaseData, idMap),
        },
        idMap,
    }
}

// Raw crypto.randomUUID(), matching blockManager.ts / databaseFactory.ts (no prefix),
// so pasted ids are indistinguishable from blocks created any other way.
export function freshId(): string {
    return crypto.randomUUID()
}

function mapOldIdsToNew(content: ContentDataSet, keepSameIds: boolean): Record<string, string> {
    const idMap: Record<string, string> = {}
    for (const oldId of Object.keys(content)) {
        idMap[oldId] = keepSameIds ? oldId : freshId()
    }
    return idMap
}

function rebuildContentUnderNewIds(content: ContentDataSet, idMap: Record<string, string>): ContentDataSet {
    const rebuilt: ContentDataSet = {}
    for (const [oldId, block] of Object.entries(content)) {
        const newId = idMap[oldId]
        const movedBlock: TextElement = { ...block, id: newId }
        // Flat blocks only today (children null). Nested children[] remap is deferred — PLAN.md.
        rebuilt[newId] = movedBlock
    }
    return rebuilt
}

function rebuildLayoutUnderNewIds(
    layout: LayoutDataSet,
    idMap: Record<string, string>,
    fileId: string,
): LayoutDataSet {
    const rebuilt: LayoutDataSet = {}
    for (const placement of Object.values(layout)) {
        const newId = idMap[placement.blockId]
        if (!newId) continue
        const movedPlacement: LayoutItem = { ...placement, blockId: newId, fileId }
        rebuilt[layoutKey(fileId, newId)] = movedPlacement
    }
    return rebuilt
}

function rebuildDatabasesUnderNewIds(
    databases: DatabaseDataSet,
    idMap: Record<string, string>,
): DatabaseDataSet {
    const rebuilt: DatabaseDataSet = {}
    for (const [oldId, config] of Object.entries(databases)) {
        const newId = idMap[oldId]
        if (!newId) continue
        const movedConfig: DatabaseConfiguration = { ...config, id: newId }
        // Row cells reference content-block ids; remapping those is deferred — PLAN.md.
        rebuilt[databaseKey(newId)] = movedConfig
    }
    return rebuilt
}
