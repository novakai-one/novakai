import type { NodeInterface } from './__types.generated';

// @flowmap-node types__Frontmatter kind=type
/** per-node public-interface metadata: name, description, state, interfaces */
export interface Frontmatter {
  interfaces: NodeInterface[];
}
