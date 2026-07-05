import type { AppContext, MermaidApi, SliceApi } from './__types.generated';

// @flowmap-node slice__initSlice kind=function
/** build the legacy slice pane chrome and expose the one slice-serialisation path: sliceFor(ids) computes the neighbourhood slice text + info label (empty ids = full diagram), and the legacy pane's render() delegates to it with the editor selection */
export function initSlice(_ctx: AppContext, _deps: { mermaid: MermaidApi }): SliceApi {
  throw new Error('unimplemented');
}
