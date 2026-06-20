import type { DocShape } from "../../types/types"
import type { SelectionPoint } from "../ClaudeSelectionManager/selectionState"

// Turns SM's selection range into the selected block ids in document order. The range may
// arrive unordered or with repeats; file.content is the source of truth for order (the same
// order LayoutManager positions against). Ids not present in this file are dropped.

export function resolveSelectedIds(range: SelectionPoint[], shape: DocShape): string[] {
    if (range.length === 0 || !shape.file) return []

    const documentOrder = shape.file.content
    const selectedIds = dedupe(range.map(point => point?.elementId))

    return selectedIds
        .filter(id => documentOrder.includes(id))
        .sort((a, b) => documentOrder.indexOf(a) - documentOrder.indexOf(b))
}

function dedupe(ids: (string | undefined)[]): string[] {
    const seen = new Set<string>()
    const unique: string[] = []
    for (const id of ids) {
        if (!id || seen.has(id)) continue
        seen.add(id)
        unique.push(id)
    }
    return unique
}
