// Cell registry — the single source of truth mapping a DbColumnType to the React
// component that renders/edits that cell. DatabaseArea keys this map by a
// column's `type` to pick a renderer, the same way TextElement.component keys
// COMPONENT_REGISTRY. Adding a typed cell = one entry here, no DatabaseArea edit.
//
// This is a static data map, not a decision-maker: it holds no branching logic.
// The lookup it serves is data-driven (rule 1.1) — DatabaseArea stays a conduit.
// Every entry takes the uniform CellProps so the lookup result is interchangeable.

import type { CellProps, DbColumnType } from "../../../types/types";
import CheckboxCell from "./cells/CheckboxCell";
import TextCell from "./cells/TextCell";

export type CellComponent = (props: CellProps) => React.ReactNode;

// Total over DbColumnType so a column type can never resolve to nothing (which
// would force a fallback branch in DatabaseArea). Text-like types share the
// default TextCell (ContentArea editor) until they get bespoke renderers.
// @flowmap-node databaseArea__cellRegistry kind=module
export const CELL_REGISTRY: Record<DbColumnType, CellComponent> = {
  text: TextCell,
  number: TextCell,
  date: TextCell,
  select: TextCell,
  checkbox: CheckboxCell,
};
