// ── Block definitions ─────────────────────────────────────────────────────────
// The catalog of blocks a user can insert from the side panel — the single source
// of truth shared by the side that LISTS them (LeftPanel renders the Blocks tile)
// and the side that CREATES them (BlockManager resolves a panel click's block id
// back to its spec). Same role COMPONENT_REGISTRY plays for rendering: one map,
// two readers, no drift.
//
// Each entry maps a stable id to the component + semantic tag it renders as.

import type { BlockSpec } from "../../types/types";

// @flowmap-node blockDefs kind=module
export const BLOCK_DEFINITIONS: BlockSpec[] = [
  { id: "block-h1", block: "Heading 1", component: "ContentArea", Tag: "h1" },
  { id: "block-h2", block: "Heading 2", component: "ContentArea", Tag: "h2" },
  { id: "block-h3", block: "Heading 3", component: "ContentArea", Tag: "h3" },
  { id: "block-p", block: "Paragraph", component: "ContentArea", Tag: "p" },
  {
    id: "block-quote",
    block: "Quote",
    component: "ContentArea",
    Tag: "blockquote",
  },
  {
    id: "block-database",
    block: "Database",
    component: "DatabaseArea",
    Tag: "div",
  },
];
