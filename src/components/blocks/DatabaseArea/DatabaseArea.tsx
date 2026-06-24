// DatabaseArea — the database block component. Same contract as ContentArea:
// it's a dumb renderer registered in COMPONENT_REGISTRY and instantiated by
// WorkspaceArea with the shared conduit props. It holds NO data.
//
//   TextElement (component "DatabaseArea")  — the block WSA renders
//        └─ id ──▶ DatabaseConfiguration     — read from useWorkspaceStore.databases
//                      ├─ columns  ─▶ header cells
//                      └─ rowOrder ─▶ rows, each wrapped in DatabaseRow (draggable)
//                                        └─ cells ─▶ TextElement ids ─▶ ContentArea
//
// Read path at runtime:
//   1. WSA renders this block, passes activeContent (the database's TextElement).
//   2. This reads databases[activeContent.id] from the store → the configuration.
//   3. It renders one header cell per column, one DatabaseRow per rowOrder id.
//   4. Each row renders one ContentArea per column, looked up by the cell id the
//      row's `cells` map points at. So a cell edits through the exact same
//      contentEditable + SM path as every other block.
//
// Every gesture (cell click/keydown/blur, row-handle drag) forwards through the
// same cbMouseEvent / cbKeyboardEvent / cbLifecycleEvent conduit WSA handed in.
// This component decides nothing — the managers do, off the trigger string.

import { useSyncExternalStore } from "react";
import { useWorkspaceStore } from "../../store/useWorkspaceStore";
import { CELL_REGISTRY } from "./cellRegistry";
import DatabaseRow from "./DatabaseRow";
import type {
  ContentDataSet,
  TextElement,
  MouseEventData,
  KeyEventData,
  LifecycleEventData,
} from "../../../types/types";
import type { TriggerWord } from "../../../types/trigger-words";
import "./database-area.css";

interface DatabaseAreaProps {
  activeContent: TextElement;
  contentDataSet: ContentDataSet;
  cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void;
  cbKeyboardEvent: (keyData: KeyEventData, trigger: TriggerWord) => void;
  cbLifecycleEvent: (
    lifecycleData: LifecycleEventData,
    trigger: TriggerWord,
  ) => void;
}

export default function DatabaseArea({
  activeContent,
  contentDataSet,
  cbMouseEvent,
  cbKeyboardEvent,
  cbLifecycleEvent,
}: DatabaseAreaProps) {
  // The configuration for THIS database, keyed by the block id. Subscribed via
  // a selector so the block re-renders when its own config changes and not when
  // an unrelated database does.
  const config = useWorkspaceStore(
    (s) => s.databases?.[activeContent.id] ?? null,
  );

  // Block selection set is SM-owned; rows read it the same way WSA reads block
  // selection. A row id can be in this set once row selection is wired.
  const selectedIds = useSyncExternalStore(
    noopSubscribe,
    getEmptySet,
    getEmptySet,
  );

  if (!config) {
    // Config not loaded yet (or stripped on delete) — render an empty shell
    // so the block still has a measurable box for the layout pass.
    return <div className="database-area" data-blockid={activeContent.id} />;
  }

  // One grid track per column. Header and every row share this string so cells
  // line up. Widths come from the database's internal layout.
  const gridTemplateColumns = config.columns
    .map((col) => `${config.layout.columnWidths[col.key] ?? 200}px`)
    .join(" ");

  return (
    <div className="database-area" data-blockid={activeContent.id}>
      <div className="database-area__title">{config.name}</div>

      {/* Column headers */}
      <div className="database-area__header" style={{ gridTemplateColumns }}>
        {config.columns.map((col) => (
          <div key={col.key} className="database-area__header-cell">
            {col.name}
          </div>
        ))}
      </div>

      {/* Rows — vertical order is rowOrder. Each row is a draggable wrapper. */}
      <div className="database-area__body">
        {config.rowOrder.map((rowId) => {
          const row = config.rows[rowId];
          if (!row) return null;
          return (
            <DatabaseRow
              key={rowId}
              rowId={rowId}
              gridTemplateColumns={gridTemplateColumns}
              isSelected={selectedIds.has(rowId)}
              cbMouseEvent={cbMouseEvent}
            >
              {config.columns.map((col) => {
                const cellBlockId = row.cells[col.key];
                const cellBlock = cellBlockId
                  ? contentDataSet[cellBlockId]
                  : undefined;
                // The column's type picks the renderer — a data lookup, not an
                // outcome branch. Every renderer takes the same CellProps, so
                // the cell stays uniform whatever the type.
                const Cell = CELL_REGISTRY[col.type];
                return (
                  <div key={col.key} className="db-row__cell">
                    {cellBlock && (
                      <Cell
                        cell={cellBlock}
                        contentDataSet={contentDataSet}
                        cbMouseEvent={cbMouseEvent}
                        cbKeyboardEvent={cbKeyboardEvent}
                        cbLifecycleEvent={cbLifecycleEvent}
                      />
                    )}
                  </div>
                );
              })}
            </DatabaseRow>
          );
        })}
      </div>

      {/* Add-row affordance. Fires a mouse event WSA/BlockManager will own
                later; trigger string keeps the conduit uniform. */}
      <div
        className="database-area__add-row"
        onMouseDown={(e) =>
          cbMouseEvent(
            mouseDataFrom(e, activeContent.id),
            "database-area-mouse-click",
          )
        }
      >
        + New row
      </div>
    </div>
  );
}

// Shape a native mouse event into the conduit payload, tagged with the database
// block id. Built in the body, never inline in JSX — same rule as ContentArea.
function mouseDataFrom(e: React.MouseEvent, blockId: string): MouseEventData {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    blockId,
    blockType: "DatabaseArea",
    shiftKey: e.shiftKey,
    metaKey: e.metaKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    button: e.button,
    buttons: e.buttons,
    nativeEvent: e,
  };
}

// Placeholder selection source until row selection is wired into SM. A stable
// empty set keeps useSyncExternalStore happy (same reference every call) so it
// never loops. Swap getEmptySet for SM's row-selection snapshot when it exists.
const EMPTY_SET: Set<string> = new Set();
const getEmptySet = (): Set<string> => EMPTY_SET;
const noopSubscribe = (): (() => void) => () => {};
