/* =====================================================================
   config.ts — static lookup tables and constants
   ---------------------------------------------------------------------
   Responsibility: hold every hard-coded table the app reads — shape
   list, edge styles, colour palette, per-shape defaults, themes, fonts,
   grid size, zoom limits, storage keys. Pure data + a couple of tiny
   pure helpers. No DOM, no mutable state.
   ===================================================================== */

import type { ShapeKind, NodeKind, EdgeStyle, Prefs } from '../types/types';

export const SHAPES: ShapeKind[] = [
  'rect', 'round', 'stadium', 'cylinder', 'diamond', 'circle', 'hex', 'note', 'group',
];

/** Selectable semantic kinds, in inspector dropdown order. */
export const KINDS: NodeKind[] = [
  'component', 'hook', 'class', 'store', 'module', 'function', 'type', 'service', 'event',
];

/** Default visual shape for a kind (used when creating a node by kind). */
export const KIND_SHAPE: Record<NodeKind, ShapeKind> = {
  component: 'rect',
  hook: 'round',
  class: 'rect',
  store: 'cylinder',
  module: 'rect',
  function: 'round',
  type: 'note',
  service: 'hex',
  event: 'circle',
};

/**
 * Subtle fill tint per semantic kind, so a node's construct reads at a glance
 * and same-kind nodes form a visual family across the canvas. Muted darks in
 * the same register as PALETTE; light label text stays readable on them. Used
 * only when a node has no explicit custom colour (see `nodeFill`).
 */
export const KIND_TINT: Record<NodeKind, string> = {
  component: '#25305a', // indigo
  hook:      '#1f3a36', // teal
  class:     '#34284a', // violet
  store:     '#3a3122', // amber
  module:    '#2b3340', // slate
  function:  '#21372a', // green
  type:      '#3a2630', // rose
  service:   '#1f3340', // steel
  event:     '#3a2545', // magenta
};

/**
 * Effective fill for a node: an explicit custom colour always wins; otherwise
 * the node's kind supplies a tint; otherwise null (theme default). Render and
 * export both go through this so the canvas and the PNG/SVG agree.
 */
export function nodeFill(n: { color: string | null; kind?: NodeKind | null }): string | null {
  return n.color ?? (n.kind ? KIND_TINT[n.kind] : null);
}

/**
 * Default kind for a node created from a given shape. Kind is mandatory, so a
 * node dropped from the toolbar gets a sensible construct immediately (editable
 * in the inspector) — never a kindless, untinted node. The inverse of
 * KIND_SHAPE, collapsed to one kind per shape.
 */
export const SHAPE_KIND: Record<ShapeKind, NodeKind | null> = {
  rect: 'component',
  round: 'function',
  stadium: 'module',
  cylinder: 'store',
  diamond: 'function',
  circle: 'event',
  hex: 'service',
  note: 'type',
  group: null,
};

/** Short badge text shown on a node's corner for each kind. */
export const KIND_BADGE: Record<NodeKind, string> = {
  component: 'cmp',
  hook: 'hook',
  class: 'class',
  store: 'store',
  module: 'mod',
  function: 'fn',
  type: 'type',
  service: 'svc',
  event: 'evt',
};

/** Mermaid arrow tokens per edge style. */
export const STYLES: Record<EdgeStyle, string> = {
  solid: '-->',
  dotted: '-.->',
  thick: '==>',
};

/** Fill swatches. `null` = theme default (no custom fill). */
export const PALETTE: (string | null)[] = [
  null, '#262c4a', '#2c2840', '#3a2630', '#3a3122', '#1f3340', '#2b3340',
];
export const PALETTE_NAMES = ['default', 'indigo', 'violet', 'rose', 'amber', 'steel', 'slate'];

export interface ShapeDefault { w: number; h: number; label: string; }

export const DEFAULTS: Record<ShapeKind, ShapeDefault> = {
  rect: { w: 160, h: 56, label: 'Module' },
  round: { w: 160, h: 56, label: 'Process' },
  stadium: { w: 160, h: 50, label: 'Start' },
  cylinder: { w: 150, h: 64, label: 'Store' },
  diamond: { w: 150, h: 88, label: 'Decision?' },
  circle: { w: 96, h: 96, label: 'State' },
  hex: { w: 160, h: 64, label: 'Service' },
  note: { w: 190, h: 86, label: 'note...' },
  group: { w: 300, h: 200, label: 'Group' },
};

/** Port anchor multipliers: [fractionX, fractionY] within a node box. */
export const SIDE_MULT: Record<string, [number, number]> = {
  pt: [0.5, 0], pb: [0.5, 1], pl: [0, 0.5], pr: [1, 0.5],
};

/* ---------- camera + grid ---------- */
export const Z_MIN = 0.15;
export const Z_MAX = 3;
export const GRID = 16;

/* ---------- storage keys ---------- */
export const PREF_KEY = 'flowmap.prefs.v1';
export const LS_KEY = 'flowmap.autosave.v1';

/* ---------- themes ---------- */
export const THEME_VARS = [
  '--bg', '--grid', '--panel', '--panel-2', '--panel-3', '--line', '--line-bright',
  '--ink', '--ink-dim', '--ink-faint', '--accent', '--accent-2', '--accent-3',
  '--danger', '--sel', '--node-bg', '--node-stroke', '--node-ink', '--note-bg',
  '--note-stroke', '--note-ink', '--edge', '--edge-sel', '--label-bg',
];

export interface Theme { name: string; vars: Record<string, string>; }

export const THEMES: Record<string, Theme> = {
  slate: { name: 'Slate', vars: {
    '--bg': '#0f1216', '--grid': '#181c24', '--panel': '#161a21', '--panel-2': '#1d222c', '--panel-3': '#252b38',
    '--line': '#2a3140', '--line-bright': '#3a4254', '--ink': '#e7eaf1', '--ink-dim': '#8b94a6', '--ink-faint': '#565f6e',
    '--accent': '#7c8cff', '--accent-2': '#d9a066', '--accent-3': '#6f9bd8', '--danger': '#e9697f', '--sel': '#7c8cff',
    '--node-bg': '#1d222c', '--node-stroke': '#3a4254', '--node-ink': '#e7eaf1',
    '--note-bg': '#292318', '--note-stroke': '#4a3f2a', '--note-ink': '#ecdcb8', '--edge': '#6a7384', '--edge-sel': '#4fe0cd', '--label-bg': '#11151c' } },
  carbon: { name: 'Carbon', vars: {
    '--bg': '#121212', '--grid': '#1f1f1f', '--panel': '#181818', '--panel-2': '#202020', '--panel-3': '#2a2a2a',
    '--line': '#2e2e2e', '--line-bright': '#3d3d3d', '--ink': '#ededed', '--ink-dim': '#9a9a96', '--ink-faint': '#5f5f5b',
    '--accent': '#c8956b', '--accent-2': '#b98a5a', '--accent-3': '#9a8f7d', '--danger': '#d9737a', '--sel': '#c8956b',
    '--node-bg': '#1f1f1e', '--node-stroke': '#3d3d3a', '--node-ink': '#ededed',
    '--note-bg': '#2a2620', '--note-stroke': '#44402f', '--note-ink': '#e8dcc0', '--edge': '#6e6e68', '--edge-sel': '#52d8c4', '--label-bg': '#151515' } },
  dusk: { name: 'Dusk', vars: {
    '--bg': '#15131c', '--grid': '#211d2c', '--panel': '#1b1825', '--panel-2': '#241f31', '--panel-3': '#2f2840',
    '--line': '#322a44', '--line-bright': '#443a5c', '--ink': '#ece8f3', '--ink-dim': '#9a90ab', '--ink-faint': '#645a78',
    '--accent': '#c98aae', '--accent-2': '#c79a72', '--accent-3': '#8f86c9', '--danger': '#db6f8e', '--sel': '#c98aae',
    '--node-bg': '#241f31', '--node-stroke': '#443a5c', '--node-ink': '#ece8f3',
    '--note-bg': '#2b2418', '--note-stroke': '#483d28', '--note-ink': '#ecdcb8', '--edge': '#756a86', '--edge-sel': '#6ad8c9', '--label-bg': '#18141f' } },
  nord: { name: 'Nord', vars: {
    '--bg': '#1c2128', '--grid': '#262d36', '--panel': '#222831', '--panel-2': '#2b323d', '--panel-3': '#353d4a',
    '--line': '#3a4350', '--line-bright': '#4a5568', '--ink': '#e3e8ef', '--ink-dim': '#94a0b0', '--ink-faint': '#647082',
    '--accent': '#80a4c2', '--accent-2': '#cba17a', '--accent-3': '#8fb0cb', '--danger': '#d97f86', '--sel': '#80a4c2',
    '--node-bg': '#2b323d', '--node-stroke': '#4a5568', '--node-ink': '#e3e8ef',
    '--note-bg': '#2c2a20', '--note-stroke': '#494433', '--note-ink': '#e8dcc0', '--edge': '#6f7c8d', '--edge-sel': '#5fd0c0', '--label-bg': '#1e242c' } },
  paper: { name: 'Paper', vars: {
    '--bg': '#f4f2ee', '--grid': '#e0dace', '--panel': '#ffffff', '--panel-2': '#faf8f4', '--panel-3': '#efece5',
    '--line': '#ddd8cd', '--line-bright': '#c9c2b4', '--ink': '#2b2a28', '--ink-dim': '#6b665d', '--ink-faint': '#9a9488',
    '--accent': '#4a6da8', '--accent-2': '#b07a3f', '--accent-3': '#6d8bb5', '--danger': '#c0556a', '--sel': '#4a6da8',
    '--node-bg': '#ffffff', '--node-stroke': '#c9c2b4', '--node-ink': '#2b2a28',
    '--note-bg': '#fbf3d8', '--note-stroke': '#e3d6a8', '--note-ink': '#5a5234', '--edge': '#9a9488', '--edge-sel': '#0f9e8c', '--label-bg': '#f4f2ee' } },
};
export const THEME_ORDER = ['slate', 'carbon', 'dusk', 'nord', 'paper'];

/* ---------- fonts ---------- */
export interface FontDef { name: string; stack: string; }

export const FONTS: Record<string, FontDef> = {
  sans: { name: 'Sans · system', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  rounded: { name: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Varela Round', system-ui, sans-serif" },
  mono: { name: 'Mono', stack: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" },
  serif: { name: 'Serif', stack: "'Iowan Old Style', 'Palatino', Georgia, 'Times New Roman', serif" },
};
export const FONT_ORDER = ['sans', 'rounded', 'mono', 'serif'];

/* ---------- default prefs ---------- */
export const DEFAULT_PREFS: Prefs = {
  theme: 'slate', font: 'sans', grid: true, snap: true, map: true, route: 'straight',
  showFrontmatter: false, fmWidth: 330,
};

/* ---------- tiny pure helpers ---------- */

/** Escape HTML-special characters for safe innerHTML insertion. */
export function esc(s: string | null | undefined): string {
  return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
}

/** Escape a label for embedding inside Mermaid double-quoted text. */
export function escM(s: string | null | undefined): string {
  return (s || '').replace(/"/g, "'").replace(/\n/g, ' ');
}
