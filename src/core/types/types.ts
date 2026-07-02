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

/**
 * Semantic node kind: what React/TS construct a node represents. Independent
 * of `shape` (the visual form). `kind` drives the kind badge, the default
 * shape when a node is created by kind, and future kind-aware behaviour.
 * Absent `kind` means "unspecified" — the node still works, it just carries
 * no semantic tag.
 */
export type NodeKind =
  | 'component' | 'hook' | 'class' | 'store'
  | 'module' | 'function' | 'type' | 'service' | 'event';

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
  /** semantic kind (React/TS construct); absent when unspecified */
  kind?: NodeKind | null;
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
  /** manual label position (world coords); absent = auto-anchored */
  labelPos?: Point | null;
  /** manual bend point (world coords) the wire passes through; absent = auto-routed */
  bend?: Point | null;
}

/** A reading-mode grouping declared by `%% group` — hierarchy metadata above
    top-level nodes, never a canvas node: no geometry, invisible to the editor. */
export interface HierGroup {
  id: string;
  label: string;
  /** enclosing group id, for nested groups; null = top level */
  parent: string | null;
}

/** The `%% group` / `%% group-member` overlay: groups plus node→group membership. */
export interface Hier {
  groups: Record<string, HierGroup>;
  memberOf: Record<string, string>;
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
