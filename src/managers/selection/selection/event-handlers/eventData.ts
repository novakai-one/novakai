// ── eventData.ts ──────────────────────────────────────────────────────────────
// Event payload types now come from the canonical event vocabulary.
// Re-exported so the rest of ClaudeSelectionManager keeps importing from
// "./eventData" unchanged. Three channels: mouse, key, lifecycle.

export type {
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
} from "../../../../types/types";
