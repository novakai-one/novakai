import type {
    DocShape,
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    LayoutItem,
    DatabaseConfiguration,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import { clipboardStore, type ClipboardSlice } from "./clipboardStore"
import { regenerateIds } from "./ids"

// ── paste ─────────────────────────────────────────────────────────────────
// Merge the held buffer slice into shape and return a NEW shape. Clipboard owns
// WHERE the blocks land. Clipboard does NOT fix collisions — LayoutManager does
// that downstream. Clipboard's contract to LM: the emitted blocks are in correct
// document order, because LM positions them relying on that order.
//
// Steps (runtime order):
//   1. Read the held slice + ordered ids. If none, return shape unchanged.
//   2. Regenerate ids so pasted blocks never collide with the source.
//   3. Find the anchor row's bottom edge — pasted blocks stack from there.
//   4. Walk the ordered ids: place each block directly below the previous one
//      (next y = prev y + prev h, NO gap), in order.
//   5. Append the ordered pasted ids to the file's content array, in order.
//   6. If mode was "cut", remove the source blocks.   <-- PLACEHOLDER (LM's job)
//   7. return the new shape.
//
// shape is immutable: every dataset + the file is shallow-copied before write so
// React's diff sees new identities.

// Anchor reader. Paste stacks below this row. PLACEHOLDER field — `blockId` is
// the block under the caret at paste time. See PLAN.md item 4.
function readAnchorId(eventData: unknown): string | null {
    const e = eventData as { blockId?: string }
    return e?.blockId ?? null
}

// The y a pasted block stacks from: directly below the anchor's bottom edge.
// anchor y=20 h=20  ->  first paste y = 40. No gap.
function anchorBottom(anchorId: string | null, shape: DocShape): number {
    if (!anchorId) return 0
    const fileId = shape.file?.id ?? ""
    const placement = shape.layoutData[layoutKey(fileId, anchorId)]
    return placement ? placement.y + placement.h : 0
}

export function paste(
    eventData: unknown,
    _reactEvent: React.SyntheticEvent | null,
    shape: DocShape,
): DocShape {
    const slice: ClipboardSlice | null = clipboardStore.read()
    if (!slice) return shape

    const fileId = shape.file?.id ?? ""
    const orderedOldIds = clipboardStore.orderedIds()

    // 2. New ids for every pasted block + map old id -> new id. The ordered new
    //    id list mirrors orderedOldIds through idMap.
    const { slice: fresh, idMap } = regenerateIds(slice, fileId)
    const orderedNewIds = orderedOldIds
        .map(oldId => idMap[oldId])
        .filter((id): id is string => Boolean(id))

    // 3. Stack origin.
    let cursorY = anchorBottom(readAnchorId(eventData), shape)

    // 4. Shallow copies — originals never mutated.
    const contentData:  ContentDataSet  = { ...shape.contentData }
    const layoutData:   LayoutDataSet   = { ...shape.layoutData }
    const databaseData: DatabaseDataSet = { ...shape.databaseData }

    // Walk in document order. Each block: copy content, place directly below the
    // previous block's bottom edge.
    for (const newId of orderedNewIds) {
        const block = fresh.contentData[newId]
        if (!block) continue
        contentData[newId] = block

        const placement = fresh.layoutData[layoutKey(fileId, newId)]
        if (placement) {
            const placed: LayoutItem = {
                ...placement,
                fileId,
                y: cursorY,
            }
            cursorY = placed.y + placed.h // next block sits directly below
            layoutData[layoutKey(fileId, newId)] = placed
        }

        // Database config for this block, if any.
        const config: DatabaseConfiguration | undefined =
            fresh.databaseData[databaseKey(newId)]
        if (config) databaseData[databaseKey(newId)] = config
    }

    // 5. Insert the ordered pasted ids into the file's content array.
    // PLACEHOLDER: appends at end. Real rule may insert right after the anchor
    // index — confirm. Either way the pasted ids stay in their own order.
    let file = shape.file
    if (file) {
        file = { ...file, content: [...file.content, ...orderedNewIds] }
    }

    // 6. Cut cleanup. PLACEHOLDER — remove source blocks if mode was "cut".
    // Deletion needs layout + content-order pulled and the hole closed, which is
    // LayoutManager territory. Clipboard should likely SIGNAL the delete, not do
    // it. Left as a stub. See PLAN.md item 5.
    // if (clipboardStore.mode() === "cut") { ...clipboardStore.sourceIds()... }

    return {
        file,
        contentData,
        layoutData,
        databaseData,
    }
}
