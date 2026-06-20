import type { DocShape, FileData } from "../../types/types"
import { layoutKey } from "../../types/types"

// Shared paste helpers used by BOTH the text-paste and block-paste modules.
// Pure: never mutate the input shape. The paste router and the two paste
// modules import from here; the paste modules never import each other.

// The active file's id, or "" when no file is open.
export function activeFileId(shape: DocShape): string {
    return shape.file?.id ?? ""
}

// Where the first pasted block starts: directly below the anchor's bottom edge,
// no gap. No anchor (or no placement) -> top of the document (y = 0).
export function bottomEdgeOfAnchor(anchorId: string | null, shape: DocShape): number {
    if (!anchorId) return 0
    const placement = shape.layoutData[layoutKey(activeFileId(shape), anchorId)]
    return placement ? placement.y + placement.h : 0
}

// Where new blocks go in file.content: the slot immediately AFTER the anchor
// block. No anchor (or anchor not in this file) -> end of the list. This index
// is the splice point the paste modules insert the pasted ids at.
export function insertIndexAfter(anchorId: string | null, shape: DocShape): number {
    const content = shape.file?.content ?? []
    if (!anchorId) return content.length
    const idx = content.indexOf(anchorId)
    return idx === -1 ? content.length : idx + 1
}

// Splices the pasted ids into content at insertIdx (the slot after the anchor),
// so pasted blocks sit directly below the anchor in document order. Never
// mutates the input file.
export function insertIntoContent(file: FileData | null, ids: string[], insertIdx: number): FileData | null {
    if (!file) return file
    const content = [...file.content]
    content.splice(insertIdx, 0, ...ids)
    return { ...file, content }
}
