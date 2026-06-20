import type { ClipboardSlice } from "./clipboardStore"

// ── serialize ─────────────────────────────────────────────────────────────
// Slice <-> plain JSON. ONLY needed if the clipboard must survive a page reload
// or cross a tab boundary (writing to the real OS clipboard as text). For an
// in-memory same-session buffer this is dead weight — kept as a PLACEHOLDER so
// the seam exists if cross-tab paste is wanted later.
//
// A ClipboardSlice is already three plain Record objects of plain data, so the
// current implementation is a pass-through clone. No behaviour until there is a
// real transport to serialize for.

export function serialize(slice: ClipboardSlice): string {
    // PLACEHOLDER: straight JSON. Swap for a versioned envelope if cross-tab
    // paste needs a schema tag.
    return JSON.stringify(slice)
}

export function deserialize(raw: string): ClipboardSlice | null {
    try {
        // PLACEHOLDER: no validation. Add a shape check before trusting external
        // clipboard text (another app could write arbitrary JSON).
        return JSON.parse(raw) as ClipboardSlice
    } catch {
        return null
    }
}
