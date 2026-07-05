// @novakai-node unfold__ufEscAction kind=function
/** pure Esc-chain decision for the primary surface: priority order connect > focusType > selWire > stage > sel > query, and 'none' at the bottom — an armed connect-mode outranks everything else (M5 A-verbs), and Escape never exits unfold (the old close() branch is gone by design, M4 correction) */
export function ufEscAction(_s: { connect: boolean; focusType: boolean; selWire: boolean; stage: boolean; sel: boolean; query: boolean }): 'cancelConnect' | 'clearTypeFocus' | 'deselectWire' | 'exitStage' | 'selectGroup' | 'clearQuery' | 'none' {
  throw new Error('unimplemented');
}
