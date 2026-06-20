import type { ClipboardSlice } from "./clipboardStore"

// Slice <-> JSON. Only needed once the clipboard must cross a tab/window or survive a
// reload (post-MVP transport — PLAN.md). A slice is already plain data, so these are a
// pass-through clone for now; add a versioned envelope and validation when a real
// transport exists.

export function serialize(slice: ClipboardSlice): string {
    return JSON.stringify(slice)
}

export function deserialize(raw: string): ClipboardSlice | null {
    try {
        return JSON.parse(raw) as ClipboardSlice
    } catch {
        return null
    }
}
