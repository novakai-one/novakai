// SelectionPoint.ts
//
// A single caret position: text node, character offset, block id + type.
// offset uses raw node.length — see the ZWS rule in domHelpers.ts.
// nodeText is the stripped version — safe for text extraction only.

import type { BlockType } from './types'

export class SelectionPoint {
    node:      Text | null = null
    nodeText:  string      = ""
    blockId:   string      = ""
    blockType: BlockType   = "content-area"
    offset:    number      = -1

    get isSet(): boolean {
        return this.offset !== -1 && this.node !== null
    }

    copyFrom(other: SelectionPoint): void {
        this.node      = other.node
        this.nodeText  = other.nodeText
        this.blockId   = other.blockId
        this.blockType = other.blockType
        this.offset    = other.offset
    }

    clone(): SelectionPoint {
        const copy = new SelectionPoint()
        copy.copyFrom(this)
        return copy
    }
}
