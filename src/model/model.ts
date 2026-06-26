// @flowmap-node model kind=module
// ── model.ts ──────────────────────────────────────────────────────────────
// Model VALUES: the canonical block factory, the composite-key helpers, and the
// checkbox encoding constant. Moved out of types/types.ts so that file holds
// types only (the law). Type-only import below, so no value dependency back into
// types — no cycle.
import type { TextElement } from "../types/types";

// The one canonical fresh block. Every new TextElement — a typed paragraph, a
// database renderer, a database cell — starts from this single default shape, so
// a block's baseline (and any field added to TextElement later) lives in exactly
// one place. Callers override only what differs (tag, component, parentId, …).
// @flowmap-node model__makeText kind=function
export function makeTextElement(
  overrides: Partial<TextElement> = {},
): TextElement {
  return {
    id: crypto.randomUUID(),
    component: "ContentArea",
    Tag: "p",
    styles: "",
    classNames: "",
    innerContent: "",
    parentId: null,
    children: null,
    files: [],
    ...overrides,
  };
}

// Composite key so one block can be placed in many files without collisions.
// (Same block twice in the SAME file would need a unique placement id instead —
//  a later step, since selection + the DOM currently key off blockId.)
// @flowmap-node model__layoutKey kind=function
export const layoutKey = (fileId: string, blockId: string): string =>
  `${fileId}:${blockId}`;

// Composite key helper kept for symmetry with layoutKey. A database is keyed by
// its block id alone today; this exists so call sites read the same way and a
// future per-file database instance can slot in without churn.
// @flowmap-node model__databaseKey kind=function
export const databaseKey = (blockId: string): string => blockId;

// A checkbox cell stores its boolean as the cell block's innerContent: this
// literal when checked, "" when unchecked. The shared encoding contract so the
// renderer (reads it) and BlockManager (writes it on toggle) agree without one
// importing the other.
export const CHECKBOX_CHECKED = "true";
