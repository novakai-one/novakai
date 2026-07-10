/* diff-views/types.ts — shared arg shape passed to every diff view renderer. */
import type { MmdDiff } from '../../core/diff/diff';
import type { DiagramNode, DiagramEdge } from '../../core/types/types';

export interface DiffModel {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
}

export interface ViewArg {
  diff: MmdDiff;
  before: DiffModel;
  after: DiffModel;
  beforeText: string;
  afterText: string;
}

/** Tiny DOM helper: make an element with class + optional text. */
export function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Parse an edge key "from->to:style" back into parts (for display). */
export function splitEdgeKey(k: string): { from: string; to: string; style: string } {
  const [pair, style] = k.split(':');
  const [from, dest] = pair.split('->');
  return { from, 'to': dest, style };
}
