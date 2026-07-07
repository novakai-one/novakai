/* =====================================================================
   pages.ts — IDE shell: empty-state page data + rail icon glyphs
   ---------------------------------------------------------------------
   Responsibility: the 7 non-editor tabs are DATA, not modules — one row
   per tab in EMPTY, rendered by the single emptyPage(def) factory
   (SPEC_SHELL §7: one dim mono line + a fainter command, no spinner, no
   illustration). RAIL_ICONS holds one inline-SVG glyph per rail item
   (all 8 tabs, including codebase) plus the muted map-gate glyph (§1).
   No router, no DOM beyond the empty-state factory — shell.ts owns that.
   ===================================================================== */

export interface EmptyDef {
  id: string;
  label: string;
  line1: string;
  cmd: string;
}

// SPEC_SHELL §1 tab order, top to bottom on the rail. `codebase` has no row
// here — it is the real editor, never an empty state — and neither does
// `design` any more (K5: it is a real page, src/ide/design.ts, rendered by
// shell.ts's renderHost — a real page has no empty-state row, same as
// codebase). Both still get a RAIL_ICONS glyph below. Line-2 strings are
// placeholders each owning phase finalizes (SPEC_SHELL §7).
export const EMPTY: readonly EmptyDef[] = [
  { id: 'home', label: 'home', line1: 'ask novakai anything about this repo', cmd: 'home — chat entry point · K8' },
  { id: 'contracts', label: 'contracts', line1: 'the work order — everything enforceable, in one document', cmd: 'npm run novakai:contract · K4' },
  { id: 'agents', label: 'agents', line1: 'run Claude Code in a real terminal, in the repo', cmd: 'agents — xterm over the dev-server bridge · K6' },
  { id: 'files', label: 'files', line1: 'open a folder from disk; the repo scopes every tab', cmd: 'files — File System Access · K7' },
  { id: 'analytics', label: 'analytics', line1: 'agent spend per contract, per project', cmd: 'analytics — per-repo metrics · K10' },
  { id: 'rules', label: 'rules', line1: 'the ruleset the contract gates enforce', cmd: 'npm run novakai:contract reads these · K9' },
];

/** One dim mono line + a fainter command beneath it — the BINDING empty-
    state grammar (PROTO_MANIFEST.md:94, "designed empty state: one dim
    mono line"). No spinner, no illustration, no "coming soon." */
export function emptyPage(def: EmptyDef): HTMLElement {
  const page = document.createElement('div');
  page.className = 'empty';
  const line = document.createElement('div');
  line.textContent = def.line1;
  const cmd = document.createElement('div');
  cmd.className = 'empty-cmd';
  cmd.textContent = def.cmd;
  page.append(line, cmd);
  return page;
}

const ICON_ATTRS = 'viewBox="0 0 20 20" fill="none" stroke="currentColor" '
  + 'stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"';

// SPEC_SHELL §1 — one 20x20 inline glyph per rail item (≤3 paths each),
// plus the non-interactive bottom map-gate glyph (a shield). Simple line
// glyphs only: home = house outline, agents = terminal chevron,
// files = folder, analytics = two bars, rules = checklist.
export const RAIL_ICONS: Record<string, string> = {
  home: `<svg ${ICON_ATTRS}><path d="M3 9.5 10 4l7 5.5"/><path d="M5 8.5V16h10V8.5"/></svg>`,
  design: `<svg ${ICON_ATTRS}><path d="M4.5 15.5 13 7l2 2-8.5 8.5H4.5z"/><path d="M12 8l2 2"/></svg>`,
  codebase: `<svg ${ICON_ATTRS}><path d="M7 6 3 10l4 4"/><path d="M13 6l4 4-4 4"/></svg>`,
  contracts: `<svg ${ICON_ATTRS}><path d="M5 3h10v14H5z"/><path d="M7.5 7h5M7.5 10.5h5M7.5 14h3"/></svg>`,
  agents: `<svg ${ICON_ATTRS}><path d="M4 5h12v10H4z"/><path d="m6.5 8.5 2.5 2-2.5 2M10.5 12.5h3"/></svg>`,
  files: `<svg ${ICON_ATTRS}><path d="M3 6h5l1.5 2H17v8H3z"/></svg>`,
  analytics: `<svg ${ICON_ATTRS}><path d="M7 13v3M13 8v8"/></svg>`,
  rules: `<svg ${ICON_ATTRS}><path d="M4 5.5h3M4 10h3M4 14.5h3"/><path d="M9 5.5h7M9 10h7M9 14.5h7"/></svg>`,
  gate: `<svg ${ICON_ATTRS}><path d="M10 3l6 2.2v4.3c0 4-2.6 6.7-6 7.5-3.4-.8-6-3.5-6-7.5V5.2L10 3z"/></svg>`,
};
