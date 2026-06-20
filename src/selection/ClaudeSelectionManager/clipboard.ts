// ── clipboard.ts — REMOVED ────────────────────────────────────────────────────
// This scaffolding is gone. All clipboard behaviour now lives in
// ../ClaudeClipboardManager (copy.ts / cut.ts / paste.ts), owned by
// ClipboardManager. NewSelectionManager constructs ClipboardManager directly and
// forwards key events to it; there is no clipboard surface inside the selection
// folder anymore.
//
// File kept only as a tombstone so any stray legacy import fails loudly with an
// empty module rather than silently resolving to old behaviour. Safe to delete
// once nothing references "./clipboard".

export {};
