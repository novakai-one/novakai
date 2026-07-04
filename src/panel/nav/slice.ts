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
import { sliceIds, sliceStubs } from '../../core/state/state';

export interface SliceApi {
  render: () => void;
  sliceFor: (ids: string[]) => { text: string; info: string };
}

export function initSlice(ctx: AppContext, deps: { mermaid: MermaidApi }): SliceApi {
  const { state } = ctx;

  /* ---- the one slice-serialisation path (the files.loadMmdText precedent):
     the legacy pane and the unfold slice tab are two triggers of this same
     proven behaviour. Empty ids = full diagram (enables whole-doc copy). ---- */
  function sliceFor(ids: string[]): { text: string; info: string } {
    if (ids.length === 0) {
      const nc = Object.keys(state.nodes).length;
      return {
        text: deps.mermaid.toMermaid(),
        info: `Full diagram · ${nc} node${nc !== 1 ? 's' : ''}`,
      };
    }

    // Compute union of slices for all selected nodes
    const keep = new Set<string>();
    for (const id of ids) {
      if (!state.nodes[id]) continue;
      sliceIds(state, id).forEach((x) => keep.add(x));
    }
    const stubs = sliceStubs(state, keep);
    const only = new Set<string>([...keep, ...stubs]);
    const text = deps.mermaid.toMermaid({ only });

    const label = ids.length === 1
      ? `Slice around ${ids[0]}`
      : `Slice around ${ids.length} nodes`;
    const info = `${label} · ${keep.size} node${keep.size !== 1 ? 's' : ''}`
      + (stubs.size ? ` · ${stubs.size} boundary stub${stubs.size !== 1 ? 's' : ''}` : '');

    return { text, info };
  }

  const pane = document.getElementById('paneSlice') as HTMLElement | null;
  if (!pane) return { render: () => {}, sliceFor };

  /* ---- build the pane chrome ---- */
  const info = document.createElement('div');
  info.className = 'slice-info';

  const out = document.createElement('textarea');
  out.id = 'sliceOut';
  out.spellcheck = false;
  out.readOnly = true;
  out.className = 'slice-out';

  const btns = document.createElement('div');
  btns.className = 'slice-btns';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'filebtn';
  copyBtn.textContent = 'Copy';
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(out.value);
    ctx.hooks.toast('Slice copied');
  };

  btns.appendChild(copyBtn);
  pane.appendChild(info);
  pane.appendChild(out);
  pane.appendChild(btns);

  function render(): void {
    const result = sliceFor([...state.sel]);
    out.value = result.text;
    info.textContent = result.info;
  }

  return { render, sliceFor };
}
