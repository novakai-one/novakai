import type { NodeKind } from './__types.generated';

// @flowmap-node config__nodeFill kind=function
/** effective fill for a node: custom colour wins, else kind tint, else theme default */
export function nodeFill(_n: { color: string | null; kind?: NodeKind | null }): string | null {
  throw new Error('unimplemented');
}
