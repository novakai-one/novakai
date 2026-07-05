import type { Frontmatter, NodeKind, ShapeKind } from './__types.generated';

// @flowmap-node types__DiagramNode kind=type
/** one diagram node: id, label, shape, kind, colour, geometry, frontmatter, parent */
export interface DiagramNode {
  shape: ShapeKind;
  kind: NodeKind | null;
  fm: Frontmatter;
}
