/* =====================================================================
   seed.ts — first-run sample diagram
   ---------------------------------------------------------------------
   Responsibility: populate the model with a small example diagram, used
   only when there's no autosave to restore. Pure model write.
   ===================================================================== */

import type { StateStore } from './state';

// @flowmap-node seed kind=module
export function seed(state: StateStore): void {
  state.nodes = {
    n1: { id: 'n1', label: 'WorkspaceArea', shape: 'rect', color: null, x: 300, y: 64, w: 150, h: 52 },
    n2: { id: 'n2', label: 'DragManager', shape: 'round', color: null, x: 300, y: 200, w: 140, h: 52 },
    n3: { id: 'n3', label: 'Zustand store', shape: 'cylinder', color: null, x: 540, y: 200, w: 140, h: 60 },
    n4: { id: 'n4', label: 'Dragging?', shape: 'diamond', color: null, x: 96, y: 184, w: 128, h: 96 },
    n5: { id: 'n5', label: 'TextElement', shape: 'rect', color: null, x: 540, y: 344, w: 140, h: 52 },
    n6: { id: 'n6', label: 'render tiles', shape: 'stadium', color: null, x: 300, y: 344, w: 140, h: 46 },
  };
  state.edges = [
    { id: 'e1', from: 'n1', to: 'n2', label: 'routes event', style: 'solid', routing: 'ortho' },
    { id: 'e2', from: 'n2', to: 'n3', label: 'writes', style: 'solid', routing: 'straight' },
    { id: 'e3', from: 'n2', to: 'n4', label: '', style: 'dotted', routing: 'straight' },
    { id: 'e4', from: 'n3', to: 'n5', label: 'holds', style: 'solid', routing: 'straight' },
    { id: 'e5', from: 'n3', to: 'n6', label: 'reads', style: 'solid', routing: 'ortho' },
  ];
  state.nid = 7; state.eid = 6;
}
