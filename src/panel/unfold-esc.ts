/* unfold-esc.ts — the pure Esc-chain decision for the primary surface
   (M4 correction). Kept in its own wasm-free module so the behavioural
   contract can execute outside the browser (the E2/H1 factor-to-pure rule:
   unfold.ts's import chain reaches libavoid.wasm and cannot be imported by
   the acceptance runner). Priority order connect > focusType > selWire >
   stage > sel > query, and 'none' at the bottom — Escape never exits unfold
   (the old close() branch is gone by design). An armed connect-mode outranks
   everything else: a two-step verb in flight must cancel before any other
   Esc meaning applies (M5 A-verbs). The keydown handler in unfold.ts is a
   thin applier of this result. */

export function ufEscAction(s: { connect: boolean; focusType: boolean; selWire: boolean; stage: boolean; sel: boolean; query: boolean }):
  'cancelConnect' | 'clearTypeFocus' | 'deselectWire' | 'exitStage' | 'selectGroup' | 'clearQuery' | 'none' {
  if (s.connect) return 'cancelConnect';
  if (s.focusType) return 'clearTypeFocus';
  if (s.selWire) return 'deselectWire';
  if (s.stage) return 'exitStage';
  if (s.sel) return 'selectGroup';
  if (s.query) return 'clearQuery';
  return 'none';
}
