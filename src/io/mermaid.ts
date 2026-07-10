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
import type { StateStore } from '../core/state/state';
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

// Serialize the live model to Mermaid text (see mermaid-serialize for the grammar).
function serializeState(state: StateStore, opts: { only?: Set<string> } = {}): string {
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

// Copy a freshly parsed fragment onto the live state.
function applyParsedResult(state: StateStore, result: ReturnType<typeof fromMermaid>): void {
  state.nodes = result.nodes;
  state.edges = result.edges;
  state.nid = result.nextN;
  state.eid = result.nextE;
  state.dir = result.dir;
  state.roots = result.roots;
  state.hier = result.hier;
}

// Parse `ctx.dom.mmd.value` and, on success, replace the live model, re-sync
// the textarea, and record history; on parse failure, toast without touching state.
function applyParsedText(ctx: AppContext, selection: SelectionApi, sync: () => void): void {
  try {
    const result = fromMermaid(ctx.dom.mmd.value);
    if (!Object.keys(result.nodes).length) {
      ctx.hooks.toast('No nodes parsed');
      return;
    }
    applyParsedResult(ctx.state, result);
    selection.clearSel();
    ctx.hooks.render();
    sync();
    ctx.hooks.pushHistory();
    ctx.hooks.toast('Applied');
  } catch {
    ctx.hooks.toast('Parse error');
  }
}

// Set up the Mermaid text <-> live-model bridge for one app context.
export function initMermaid(ctx: AppContext, selection: SelectionApi): MermaidApi {
  const { state } = ctx;
  const { mmd } = ctx.dom;

  const toMermaid = (opts: { only?: Set<string> } = {}): string => serializeState(state, opts);

  const sync = (): void => {
    mmd.value = toMermaid();
  };

  const applyText = (): void => applyParsedText(ctx, selection, sync);

  return { toMermaid, sync, applyText };
}
