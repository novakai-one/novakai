import type { EdgeStyle, Routing } from './__types.generated';

// @flowmap-node types__DiagramEdge kind=type
/** one edge: from, to, label, style, routing, optional label/bend positions */
export interface DiagramEdge {
  style: EdgeStyle;
  routing: Routing;
}
