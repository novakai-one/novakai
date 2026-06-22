/* =====================================================================
   types.ts — shared domain types
   ---------------------------------------------------------------------
   Responsibility: define the data shapes (Node, Edge, ...) that every
   other module reads and writes. No logic, no DOM, no imports. This is
   the vocabulary the whole app speaks.
   ===================================================================== */

export type ShapeKind =
  | 'rect' | 'round' | 'stadium' | 'cylinder'
  | 'diamond' | 'circle' | 'hex' | 'note' | 'group';

export type EdgeStyle = 'solid' | 'dotted' | 'thick';
export type Routing = 'straight' | 'ortho';
export type PortSide = 'pt' | 'pb' | 'pl' | 'pr';

/** Auto-layout flow direction (from the Mermaid header). */
export type FlowDir = 'TD' | 'BT' | 'LR' | 'RL';

/**
 * One public interface a node exposes. A node may expose several (e.g. a
 * manager with separate `start` / `move` / `commit` entry points). Each
 * interface pairs its own accepted inputs with its own returned outputs.
 */
export interface NodeInterface {
  /** interface label (method/entry-point name); may be blank */
  name: string;
  /** inputs this interface accepts (its public params) */
  accepts: string[];
  /** outputs this interface returns */
  returns: string[];
}

/**
 * Per-node frontmatter: surfaces a node's public interface to the rest
 * of the codebase. `name` / `description` / `state` are node-level. A node
 * may expose multiple `interfaces`, each owning its own accepts/returns.
 * All fields optional; an absent frontmatter object means the node has none.
 */
export interface Frontmatter {
  name: string;
  description: string;
  /** stateful variables the component owns/holds */
  state: string[];
  /** public interfaces, each with its own accepts/returns */
  interfaces: NodeInterface[];
}

export interface DiagramNode {
  id: string;
  label: string;
  shape: ShapeKind;
  color: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  /** optional public-interface frontmatter; absent when never set */
  fm?: Frontmatter;
  /** id of the group this node belongs to; absent/null when top-level */
  parent?: string | null;
}

export interface DiagramEdge {
  id: string;
  from: string;
  to: string;
  label: string;
  style: EdgeStyle;
  routing: Routing;
}

/** The persisted/serialisable shape of a whole diagram (model only). */
export interface DiagramData {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
  nid: number;
  eid: number;
}

/** Camera (pan + zoom) state. */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** A simple world-space point. */
export interface Point {
  x: number;
  y: number;
}

/** User preferences, persisted separately from the diagram. */
export interface Prefs {
  theme: string;
  font: string;
  grid: boolean;
  snap: boolean;
  map: boolean;
  route: Routing;
  /** show the per-node frontmatter card on the canvas (data kept either way) */
  showFrontmatter: boolean;
  /** width (px) of the frontmatter card under a node */
  fmWidth: number;
}
