import type { AppContext, CameraApi, NodesApi, SelectionApi } from './__types.generated';

// @flowmap-node nodes__initNodes kind=function
/** node + edge model verbs bound to ctx: addNode, makeEdge, deleteSelection, alignNodes, wrapInGroup, bringToFront, and the factored single-owner mutations — setEdgeLabel, reverseEdge (swaps endpoints, drops manual bend/labelPos), deleteEdge (by DiagramEdge.id), setNodeMeta (kind/desc patch), clearAll (empty model + counters + selection; confirmation belongs to callers); each verb fires the same render/sync/history hooks its former inline body fired */
export function initNodes(_ctx: AppContext, _selection: SelectionApi, _camera: CameraApi): NodesApi {
  throw new Error('unimplemented');
}
