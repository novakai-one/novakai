import type { AppContext, CameraApi, ClipboardApi, FilesApi, HistoryApi, MermaidApi, NodesApi, SelectionApi, SliceApi, ThemingApi, UnfoldApi } from './__types.generated';

// @novakai-node unfold__initUnfold kind=function
/** build the primary surface (own DOM + own CSS, the planner isolation pattern) bound to ctx; reads ctx.state + ctx.bodies, writes only through the shared hooks path; the dock carries a temporary legacy-compare affordance instead of a ✕ (M4 correction); the panel is a real dock driven by the pure ufDockReduce — five tabs on a two-row strip (reveal · io · mermaid / slice · style), chevron collapse, drag resize, state persisted under unfold.dock; model verbs are reachable through hidden-by-default affordances — overlay-scoped shortcuts and a selection-only '⋯' actions menu gated by the pure ufVerbAllowed, every verb bridging the unfold selection to the shared model selection and invoking the single-owner module verbs (nodes/clipboard/history) before a full rebuild */
export function initUnfold(_ctx: AppContext, _deps: { selection: SelectionApi; camera: CameraApi; files: FilesApi; mermaid: MermaidApi; slice: SliceApi; theming: ThemingApi; nodes: NodesApi; clipboard: ClipboardApi; history: HistoryApi }): UnfoldApi {
  throw new Error('unimplemented');
}
