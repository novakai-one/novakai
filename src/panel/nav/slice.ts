/* =====================================================================
   slice.ts — node neighbourhood slice panel
   ---------------------------------------------------------------------
   Responsibility: show a self-contained .mmd of the selected node's
   neighbourhood (children + parents + connected siblings + boundary
   stubs), with a Copy button. When nothing is selected, shows the full
   diagram mmd — this enables "add slice to diff" to capture the whole
   document. Auto-refreshes on selection change.

   Reads: ctx.state (nodes, edges, sel).
   Calls: mermaid.toMermaid({ only }) for slice serialization.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { MermaidApi } from '../../io/mermaid';
import type { StateStore } from '../../core/state/state';
// @ts-expect-error — shared CLI slicer is a .mjs under tools/ (outside src tsconfig / allowJs:false); no declarations
import { sliceModel } from '../../../tools/buildspec/core/slice-core.mjs';

export interface SliceApi {
  render: () => void;
  sliceFor: (ids: string[]) => { text: string; info: string; ids: string[] };
}

type SliceResult = { text: string; info: string; ids: string[] };

function fullDiagramSlice(state: StateStore, mermaid: MermaidApi): SliceResult {
  const count = Object.keys(state.nodes).length;
  return {
    text: mermaid.toMermaid(),
    info: `Full diagram · ${count} node${count !== 1 ? 's' : ''}`,
    ids: [],
  };
}

function neighbourhoodSlice(state: StateStore, mermaid: MermaidApi, ids: string[]): SliceResult {
  // node set = up (solid parents, transitive) + refs (1-hop dotted neighbours),
  // via the one shared slicer; serialize with the editor's rich emitter.
  // ponytail: fm/up/refs are the external slicer's fixed contract keys — cannot rename
  const model = state as typeof state & { groups?: Set<string>; fm?: Record<string, unknown> };
  const keep = new Set<string>(Object.keys(sliceModel(
    { ...model, groups: model.groups ?? new Set(), ['fm']: model.fm ?? {} },
    ids.filter((id) => state.nodes[id]),
    { ['up']: true, refs: true },
  ).nodes));
  const text = mermaid.toMermaid({ only: keep });

  const label = ids.length === 1 ? `Slice around ${ids[0]}` : `Slice around ${ids.length} nodes`;
  const info = `${label} · ${keep.size} node${keep.size !== 1 ? 's' : ''}`;

  return { text, info, ids: [...keep] };
}

/* ---- the one slice-serialisation path (the files.loadMmdText precedent):
   the legacy pane and the unfold slice tab are two triggers of this same
   proven behaviour. Empty ids = full diagram (enables whole-doc copy). ---- */
function sliceFor(state: StateStore, mermaid: MermaidApi, ids: string[]): SliceResult {
  return ids.length === 0 ? fullDiagramSlice(state, mermaid) : neighbourhoodSlice(state, mermaid, ids);
}

interface SliceChrome {
  info: HTMLDivElement;
  out: HTMLTextAreaElement;
}

function buildCopyButton(ctx: AppContext, out: HTMLTextAreaElement): HTMLButtonElement {
  const copyBtn = document.createElement('button');
  copyBtn.className = 'filebtn';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(out.value);
    ctx.hooks.toast('Slice copied');
  };
  return copyBtn;
}

function buildSliceOutput(): HTMLTextAreaElement {
  const out = document.createElement('textarea');
  out.id = 'sliceOut';
  out.spellcheck = false;
  out.readOnly = true;
  out.className = 'slice-out';
  return out;
}

function buildSliceChrome(pane: HTMLElement, ctx: AppContext): SliceChrome {
  const info = document.createElement('div');
  info.className = 'slice-info';

  const out = buildSliceOutput();

  const btns = document.createElement('div');
  btns.className = 'slice-btns';
  btns.appendChild(buildCopyButton(ctx, out));

  pane.appendChild(info);
  pane.appendChild(out);
  pane.appendChild(btns);

  return { info, out };
}

export function initSlice(ctx: AppContext, deps: { mermaid: MermaidApi }): SliceApi {
  const { state } = ctx;
  const sliceForApi = (ids: string[]): SliceResult => sliceFor(state, deps.mermaid, ids);

  const pane = document.getElementById('paneSlice') as HTMLElement | null;
  if (!pane) return { render: () => {}, sliceFor: sliceForApi };

  const { info, out } = buildSliceChrome(pane, ctx);

  function render(): void {
    const result = sliceForApi([...state.sel]);
    out.value = result.text;
    info.textContent = result.info;
  }

  return { render, sliceFor: sliceForApi };
}
