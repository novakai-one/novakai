import type { AppContext, CameraApi, FilesApi, MermaidApi } from './__types.generated';

// @novakai-node files__initFiles kind=function
/** wire save plus the hidden .mmd and bodies.json file inputs, bound to ctx; the load verbs are exposed on FilesApi (loadMmdText, loadBodies) so the unfold io tab and the legacy inputs share one code path */
export function initFiles(_ctx: AppContext, _mermaid: MermaidApi, _camera: CameraApi): FilesApi {
  throw new Error('unimplemented');
}
