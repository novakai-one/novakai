/* =====================================================================
   config.ts — static lookup tables and constants
   ---------------------------------------------------------------------
   Responsibility: hold every hard-coded table the app reads — shape
   list, edge styles, colour palette, per-shape defaults, themes, fonts,
   grid size, zoom limits, storage keys. Pure data + a couple of tiny
   pure helpers. No DOM, no mutable state.
   ===================================================================== */
export const SHAPES = [
    'rect', 'round', 'stadium', 'cylinder', 'diamond', 'circle', 'hex', 'note', 'group',
];
/** Mermaid arrow tokens per edge style. */
export const STYLES = {
    solid: '-->',
    dotted: '-.->',
    thick: '==>',
};
/** Fill swatches. `null` = theme default (no custom fill). */
export const PALETTE = [
    null, '#262c4a', '#2c2840', '#3a2630', '#3a3122', '#1f3340', '#2b3340',
];
export const PALETTE_NAMES = ['default', 'indigo', 'violet', 'rose', 'amber', 'steel', 'slate'];
export const DEFAULTS = {
    rect: { w: 120, h: 52, label: 'Module' },
    round: { w: 120, h: 52, label: 'Process' },
    stadium: { w: 120, h: 46, label: 'Start' },
    cylinder: { w: 120, h: 60, label: 'Store' },
    diamond: { w: 120, h: 84, label: 'Decision?' },
    circle: { w: 80, h: 80, label: 'State' },
    hex: { w: 130, h: 60, label: 'Service' },
    note: { w: 150, h: 80, label: 'note...' },
    group: { w: 260, h: 180, label: 'Group' },
};
/** Port anchor multipliers: [fractionX, fractionY] within a node box. */
export const SIDE_MULT = {
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
    '--note-stroke', '--note-ink', '--edge', '--label-bg',
];
export const THEMES = {
    slate: { name: 'Slate', vars: {
            '--bg': '#0f1216', '--grid': '#181c24', '--panel': '#161a21', '--panel-2': '#1d222c', '--panel-3': '#252b38',
            '--line': '#2a3140', '--line-bright': '#3a4254', '--ink': '#e7eaf1', '--ink-dim': '#8b94a6', '--ink-faint': '#565f6e',
            '--accent': '#7c8cff', '--accent-2': '#d9a066', '--accent-3': '#6f9bd8', '--danger': '#e9697f', '--sel': '#7c8cff',
            '--node-bg': '#1d222c', '--node-stroke': '#3a4254', '--node-ink': '#e7eaf1',
            '--note-bg': '#292318', '--note-stroke': '#4a3f2a', '--note-ink': '#ecdcb8', '--edge': '#6a7384', '--label-bg': '#11151c'
        } },
    carbon: { name: 'Carbon', vars: {
            '--bg': '#121212', '--grid': '#1f1f1f', '--panel': '#181818', '--panel-2': '#202020', '--panel-3': '#2a2a2a',
            '--line': '#2e2e2e', '--line-bright': '#3d3d3d', '--ink': '#ededed', '--ink-dim': '#9a9a96', '--ink-faint': '#5f5f5b',
            '--accent': '#c8956b', '--accent-2': '#b98a5a', '--accent-3': '#9a8f7d', '--danger': '#d9737a', '--sel': '#c8956b',
            '--node-bg': '#1f1f1e', '--node-stroke': '#3d3d3a', '--node-ink': '#ededed',
            '--note-bg': '#2a2620', '--note-stroke': '#44402f', '--note-ink': '#e8dcc0', '--edge': '#6e6e68', '--label-bg': '#151515'
        } },
    dusk: { name: 'Dusk', vars: {
            '--bg': '#15131c', '--grid': '#211d2c', '--panel': '#1b1825', '--panel-2': '#241f31', '--panel-3': '#2f2840',
            '--line': '#322a44', '--line-bright': '#443a5c', '--ink': '#ece8f3', '--ink-dim': '#9a90ab', '--ink-faint': '#645a78',
            '--accent': '#c98aae', '--accent-2': '#c79a72', '--accent-3': '#8f86c9', '--danger': '#db6f8e', '--sel': '#c98aae',
            '--node-bg': '#241f31', '--node-stroke': '#443a5c', '--node-ink': '#ece8f3',
            '--note-bg': '#2b2418', '--note-stroke': '#483d28', '--note-ink': '#ecdcb8', '--edge': '#756a86', '--label-bg': '#18141f'
        } },
    nord: { name: 'Nord', vars: {
            '--bg': '#1c2128', '--grid': '#262d36', '--panel': '#222831', '--panel-2': '#2b323d', '--panel-3': '#353d4a',
            '--line': '#3a4350', '--line-bright': '#4a5568', '--ink': '#e3e8ef', '--ink-dim': '#94a0b0', '--ink-faint': '#647082',
            '--accent': '#80a4c2', '--accent-2': '#cba17a', '--accent-3': '#8fb0cb', '--danger': '#d97f86', '--sel': '#80a4c2',
            '--node-bg': '#2b323d', '--node-stroke': '#4a5568', '--node-ink': '#e3e8ef',
            '--note-bg': '#2c2a20', '--note-stroke': '#494433', '--note-ink': '#e8dcc0', '--edge': '#6f7c8d', '--label-bg': '#1e242c'
        } },
    paper: { name: 'Paper', vars: {
            '--bg': '#f4f2ee', '--grid': '#e0dace', '--panel': '#ffffff', '--panel-2': '#faf8f4', '--panel-3': '#efece5',
            '--line': '#ddd8cd', '--line-bright': '#c9c2b4', '--ink': '#2b2a28', '--ink-dim': '#6b665d', '--ink-faint': '#9a9488',
            '--accent': '#4a6da8', '--accent-2': '#b07a3f', '--accent-3': '#6d8bb5', '--danger': '#c0556a', '--sel': '#4a6da8',
            '--node-bg': '#ffffff', '--node-stroke': '#c9c2b4', '--node-ink': '#2b2a28',
            '--note-bg': '#fbf3d8', '--note-stroke': '#e3d6a8', '--note-ink': '#5a5234', '--edge': '#9a9488', '--label-bg': '#f4f2ee'
        } },
};
export const THEME_ORDER = ['slate', 'carbon', 'dusk', 'nord', 'paper'];
export const FONTS = {
    sans: { name: 'Sans · system', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
    rounded: { name: 'Rounded', stack: "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', 'Varela Round', system-ui, sans-serif" },
    mono: { name: 'Mono', stack: "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace" },
    serif: { name: 'Serif', stack: "'Iowan Old Style', 'Palatino', Georgia, 'Times New Roman', serif" },
};
export const FONT_ORDER = ['sans', 'rounded', 'mono', 'serif'];
/* ---------- default prefs ---------- */
export const DEFAULT_PREFS = {
    theme: 'slate', font: 'sans', grid: true, snap: true, map: true, route: 'straight',
    showFrontmatter: false, fmWidth: 260,
};
/* ---------- tiny pure helpers ---------- */
/** Escape HTML-special characters for safe innerHTML insertion. */
export function esc(s) {
    return (s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
/** Escape a label for embedding inside Mermaid double-quoted text. */
export function escM(s) {
    return (s || '').replace(/"/g, "'").replace(/\n/g, ' ');
}
