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

// ── ids ───────────────────────────────────────────────────────────────────
// Give every pasted block a NEW id so a paste never collides with the source
// block (paste-in-place would otherwise overwrite the original).
//
// Returns:
//   slice  — the same three datasets, re-keyed and with rewritten id fields.
//   idMap  — old id -> new id, so callers can remap references that point at
//            these blocks (children[], database cell ids) in a later pass.
//
// PLACEHOLDER id generator. Replace with the project's real id factory (whatever
// blockManager / the store uses) so pasted ids match the existing scheme.
function newId(): string {
    return `blk_${Math.random().toString(36).slice(2, 10)}`
}

export interface RegenResult {
    slice: ClipboardSlice,
    idMap: Record<string, string>,
}

export function regenerateIds(slice: ClipboardSlice, fileId: string): RegenResult {
    const idMap: Record<string, string> = {}

    // 1. Mint a new id for every content block first, so later passes can look
    //    references up in idMap.
    for (const oldId of Object.keys(slice.contentData)) {
        idMap[oldId] = newId()
    }

    // 2. Rebuild contentData under the new ids, rewriting the block's own id.
    //    children[] remap is a PLACEHOLDER — flat blocks only today (children
    //    is null), so nested remap is deferred. See PLAN.md.
    const contentData: ContentDataSet = {}
    for (const [oldId, block] of Object.entries(slice.contentData)) {
        const newKey = idMap[oldId]
        const rebuilt: TextElement = { ...block, id: newKey }
        // TODO: if rebuilt.children, map each child id through idMap.
        contentData[newKey] = rebuilt
    }

    // 3. Rebuild layoutData. Re-key by (fileId, newId) and rewrite blockId.
    const layoutData: LayoutDataSet = {}
    for (const item of Object.values(slice.layoutData)) {
        const placement = item as LayoutItem
        const newKey = idMap[placement.blockId]
        if (!newKey) continue
        const rebuilt: LayoutItem = { ...placement, blockId: newKey, fileId }
        layoutData[layoutKey(fileId, newKey)] = rebuilt
    }

    // 4. Rebuild databaseData. Key is the block id, so re-key under the new id
    //    and rewrite config.id. Cell ids inside rows point at content blocks —
    //    remapping those is a PLACEHOLDER (cells reference TextElement ids that
    //    are NOT part of this slice unless the cells were also selected).
    const databaseData: DatabaseDataSet = {}
    for (const [oldId, config] of Object.entries(slice.databaseData)) {
        const newKey = idMap[oldId]
        if (!newKey) continue
        const c = config as DatabaseConfiguration
        const rebuilt: DatabaseConfiguration = { ...c, id: newKey }
        // TODO: remap rebuilt.rows[*].cells through idMap where cell ids were copied.
        databaseData[databaseKey(newKey)] = rebuilt
    }

    return { slice: { contentData, layoutData, databaseData }, idMap }
}
