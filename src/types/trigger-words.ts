//references below. not exhaustive but any new word must be added and follow the pattern

export const TRIGGER_WORDS = [
  // content-area
  "content-area-mouse-click",
  "content-area-mouse-down",
  "content-area-mouse-up",
  "content-area-mouse-move",
  "content-area-mouse-enter",
  "content-area-mouse-leave",
  "content-area-key-down",
  "content-area-key-up",
  "content-area-key-press",
  "content-area-focus",
  "content-area-blur",

  // database-area
  "database-area-mouse-click",
  "database-area-mouse-down",
  "database-area-mouse-up",
  "database-area-mouse-move",
  "database-area-mouse-enter",
  "database-area-mouse-leave",
  "database-area-key-down",
  "database-area-key-up",
  "database-area-key-press",
  "database-area-focus",
  "database-area-blur",

  // database-row
  "database-row-mouse-click",
  "database-row-mouse-down",
  "database-row-mouse-up",
  "database-row-mouse-move",
  "database-row-mouse-enter",
  "database-row-mouse-leave",
  "database-row-key-down",
  "database-row-key-up",
  "database-row-key-press",
  "database-row-focus",
  "database-row-blur",

  // database-cell
  "database-cell-mouse-click",
  "database-cell-mouse-down",
  "database-cell-mouse-up",
  "database-cell-mouse-move",
  "database-cell-mouse-enter",
  "database-cell-mouse-leave",
  "database-cell-key-down",
  "database-cell-key-up",
  "database-cell-key-press",
  "database-cell-focus",
  "database-cell-blur",

  // canvas-area
  "canvas-area-mouse-click",
  "canvas-area-mouse-down",
  "canvas-area-mouse-up",
  "canvas-area-mouse-move",
  "canvas-area-mouse-enter",
  "canvas-area-mouse-leave",
  "canvas-area-key-down",
  "canvas-area-key-up",
  "canvas-area-key-press",
  "canvas-area-focus",
  "canvas-area-blur",

  // left-panel-block (Blocks-tile selections — a click that inserts a block)
  "left-panel-block-mouse-click",
  "left-panel-block-mouse-down",
  "left-panel-block-mouse-up",
  "left-panel-block-mouse-move",
  "left-panel-block-mouse-enter",
  "left-panel-block-mouse-leave",
  "left-panel-block-key-down",
  "left-panel-block-key-up",
  "left-panel-block-key-press",
  "left-panel-block-focus",
  "left-panel-block-blur",

  // workspace-area
  "workspace-area-mouse-click",
  "workspace-area-mouse-down",
  "workspace-area-mouse-up",
  "workspace-area-mouse-move",
  "workspace-area-mouse-enter",
  "workspace-area-mouse-leave",
  "workspace-area-key-down",
  "workspace-area-key-up",
  "workspace-area-key-press",
  "workspace-area-focus",
  "workspace-area-blur",

  // drag-handle
  "drag-handle-mouse-click",
  "drag-handle-mouse-down",
  "drag-handle-mouse-up",
  "drag-handle-mouse-move",
  "drag-handle-mouse-enter",
  "drag-handle-mouse-leave",
  "drag-handle-key-down",
  "drag-handle-key-up",
  "drag-handle-key-press",
  "drag-handle-focus",
  "drag-handle-blur",
  "drag-handle-drag",

  // drag-container
  "drag-container-mouse-click",
  "drag-container-mouse-down",
  "drag-container-mouse-up",
  "drag-container-mouse-move",
  "drag-container-mouse-enter",
  "drag-container-mouse-leave",
  "drag-container-key-down",
  "drag-container-key-up",
  "drag-container-key-press",
  "drag-container-focus",
  "drag-container-blur",
] as const;

//untested / un-verified. //added xyz date by abc class/component

// @flowmap-node TriggerWord kind=type
export type TriggerWord = (typeof TRIGGER_WORDS)[number];
