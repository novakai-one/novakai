/* =====================================================================
   seed.ts — first-run sample diagram
   ---------------------------------------------------------------------
   Responsibility: populate the model with a small example diagram, used
   only when there's no autosave to restore. Pure model write.
   ===================================================================== */

import type { StateStore } from '../state/state';
import type { DiagramNode, DiagramEdge } from '../types/types';

function seedNodesUpper(): Record<string, DiagramNode> {
  return {
    workspaceArea: {
      id: 'workspaceArea', label: 'WorkspaceArea', shape: 'rect', color: null, x: 300, y: 64, 'w': 150, 'h': 52,
    },
    dragManager: {
      id: 'dragManager', label: 'DragManager', shape: 'round', color: null, x: 300, y: 200, 'w': 140, 'h': 52,
    },
    store: {
      id: 'store', label: 'Zustand store', shape: 'cylinder', color: null, x: 540, y: 200, 'w': 140, 'h': 60,
    },
  };
}

function seedNodesLower(): Record<string, DiagramNode> {
  return {
    decision: {
      id: 'decision', label: 'Dragging?', shape: 'diamond', color: null, x: 96, y: 184, 'w': 128, 'h': 96,
    },
    textElement: {
      id: 'textElement', label: 'TextElement', shape: 'rect', color: null, x: 540, y: 344, 'w': 140, 'h': 52,
    },
    renderTiles: {
      id: 'renderTiles', label: 'render tiles', shape: 'stadium', color: null, x: 300, y: 344, 'w': 140, 'h': 46,
    },
  };
}

function seedNodes(): Record<string, DiagramNode> {
  return { ...seedNodesUpper(), ...seedNodesLower() };
}

function seedEdges(): DiagramEdge[] {
  return [
    { id: 'e1', from: 'workspaceArea', 'to': 'dragManager', label: 'routes event', style: 'solid', routing: 'ortho' },
    { id: 'e2', from: 'dragManager', 'to': 'store', label: 'writes', style: 'solid', routing: 'straight' },
    { id: 'e3', from: 'dragManager', 'to': 'decision', label: '', style: 'dotted', routing: 'straight' },
    { id: 'e4', from: 'store', 'to': 'textElement', label: 'holds', style: 'solid', routing: 'straight' },
    { id: 'e5', from: 'store', 'to': 'renderTiles', label: 'reads', style: 'solid', routing: 'ortho' },
  ];
}

export function seed(state: StateStore): void {
  state.nodes = seedNodes();
  state.edges = seedEdges();
  state.nid = 7;
  state.eid = 6;
}
