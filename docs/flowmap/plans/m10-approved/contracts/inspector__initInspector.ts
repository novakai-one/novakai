import type { AppContext, InspectorApi, NodesApi, SelectionApi } from './__types.generated';

// @flowmap-node inspector__initInspector kind=function
/** build the inspector bound to ctx, nodes and selection; edge and node-meta mutations delegate to the nodes module's single-owner verbs (setEdgeLabel, reverseEdge, deleteEdge, setNodeMeta) — the inspector owns DOM and cadence, never the mutation */
export function initInspector(_ctx: AppContext, _nodes: NodesApi, _selection: SelectionApi): InspectorApi {
  throw new Error('unimplemented');
}
