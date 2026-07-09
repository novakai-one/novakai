/* =====================================================================
   mermaid.ts — two-way Mermaid text <-> model
   ---------------------------------------------------------------------
   Responsibility: serialize the model to Mermaid flowchart text
   (toMermaid, with %% fm layout metadata so positions round-trip),
   parse Mermaid text back into a model (fromMermaid), apply parsed text
   to the live model (applyText), and keep the textarea in sync (sync).

   This is the only module that knows the Mermaid grammar + the custom
   metadata comments. Pure transform on one side, model write on the other.

   The serialize + parse halves live in sibling modules
   (mermaid-serialize, mermaid-parse) to keep each file under the size cap;
   this file wires them together and re-exports the parser entry points.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { SelectionApi } from '../interaction/selection';
import type { IncludeFn } from './mermaid-serialize';
import {
  emitLayoutMeta, emitFrontmatterAndKindMeta, emitContainmentMeta, emitEdgeMeta,
  emitRootAndGroupMeta, computeInGroup, emitGroupedNodes, emitEdges,
} from './mermaid-serialize';
import { fromMermaid, parseGroupDirective } from './mermaid-parse';

export { fromMermaid, parseGroupDirective };

export interface MermaidApi {
  toMermaid: (opts?: { only?: Set<string> }) => string;
  sync: () => void;
  applyText: () => void;
}

// Set up the Mermaid text <-> live-model bridge for one app context.
export function initMermaid(ctx: AppContext, selection: SelectionApi): MermaidApi {
  const { state } = ctx;
  const { mmd } = ctx.dom;

  function toMermaid(opts: { only?: Set<string> } = {}): string {
    const keep = opts.only;
    const inc: IncludeFn = (id) => !keep || keep.has(id);
    let out = `flowchart ${state.dir}\n`;
    out += emitLayoutMeta(state, inc);
    out += emitFrontmatterAndKindMeta(state, inc);
    out += emitContainmentMeta(state, inc);
    out += emitEdgeMeta(state, inc);
    out += emitRootAndGroupMeta(state, inc);
    const inGroup = computeInGroup(state, inc);
    out += emitGroupedNodes(state, inc, inGroup);
    out += emitEdges(state, inc);
    return out;
  }

  function sync(): void { mmd.value = toMermaid(); }

  function applyText(): void {
    try {
      const r = fromMermaid(mmd.value);
      if (!Object.keys(r.nodes).length) { ctx.hooks.toast('No nodes parsed'); return; }
      state.nodes = r.nodes; state.edges = r.edges; state.nid = r.nextN; state.eid = r.nextE; state.dir = r.dir; state.roots = r.roots; state.hier = r.hier;
      selection.clearSel(); ctx.hooks.render(); sync(); ctx.hooks.pushHistory();
      ctx.hooks.toast('Applied');
    } catch { ctx.hooks.toast('Parse error'); }
  }

  return { toMermaid, sync, applyText };
}
