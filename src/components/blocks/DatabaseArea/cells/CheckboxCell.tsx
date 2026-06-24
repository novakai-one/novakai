// CheckboxCell — renders a boolean cell as a toggle and forwards its toggle
// gesture through the conduit. Chosen by CELL_REGISTRY for the "checkbox"
// column type; receives the uniform CellProps every typed renderer gets.
//
// Dumb like every other block: it does NOT flip its own value. The checkbox is
// controlled by the cell's stored value and made readOnly, so a click never
// mutates the DOM. Instead it shapes a "database-cell-mouse-click" mouse payload
// and hands it off — BlockManager flips the cell's innerContent and the re-render
// reflects the new value. Same conduit, same "manager decides" rule as text
// cells, just a different gesture.

import { CHECKBOX_CHECKED } from "../../../../types/types";
import type { CellProps, MouseEventData } from "../../../../types/types";
import "./cells.css";

export default function CheckboxCell({ cell, cbMouseEvent }: CellProps) {
  const isChecked = cell.innerContent === CHECKBOX_CHECKED;

  // Built in the body, never inline in JSX — same rule ContentArea follows.
  // The toggle is a mouse gesture, so it rides the mouse conduit tagged with
  // the cell's own block id; BlockManager reads that id to flip the cell.
  const forwardToggle = (event: React.MouseEvent) => {
    const mouseData: MouseEventData = {
      clientX: event.clientX,
      clientY: event.clientY,
      blockId: cell.id,
      blockType: cell.component,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      button: event.button,
      buttons: event.buttons,
      nativeEvent: event,
    };
    cbMouseEvent(mouseData, "database-cell-mouse-click");
  };

  return (
    <input
      type="checkbox"
      className="db-checkbox-cell"
      data-blockid={cell.id}
      checked={isChecked}
      readOnly
      onMouseDown={forwardToggle}
    />
  );
}
