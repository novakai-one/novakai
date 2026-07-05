// @novakai-node unfold__ufFitXform kind=function
/** pure camera resolver for one unfold repaint: the first paint and the visible-set verbs (reveal / hide / foldAll) fit content to the stage (clamped k in [0.15,1.15], centred, y floored at pad); every other repaint — crucially toggleExpand — returns the prior transform untouched so a group fold/unfold moves neither zoom nor focus. Owns the fit math previously duplicated in fitView and reframeToFit; no ctx, no DOM */
export function ufFitXform(_action: string, _firstPaint: boolean, _prev: { x: number; y: number; k: number }, _content: { width: number; height: number }, _stage: { width: number; height: number }, _pad: number): { x: number; y: number; k: number } {
  throw new Error('unimplemented');
}
