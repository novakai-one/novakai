/* unfold-slice.ts — the pure selection→slice-targets mapping for the primary
   surface (M5 P-tabs2). Kept in its own dependency-free module so the
   behavioural contract can execute outside the browser (the E2/H1
   factor-to-pure rule, the ufDockReduce/ufEscAction precedent). Unfold's
   selection is a different shape than the legacy pane's ctx.state.sel Set —
   a single card/group id, a selected wire (two endpoint ids), or nothing —
   and this function decides which ids feed the slice: a non-empty sel wins
   over a wire; a wire contributes its two endpoints (deduplicated for a
   self-loop); with neither, the result is [] meaning "full diagram" (the
   legacy pane's no-selection contract, which enables whole-doc copy). An
   empty-string sel counts as no selection. */

export function ufSliceTargets(sel: string | null, wire: { a: string; b: string } | null): string[] {
  if (sel) return [sel];
  if (wire) return wire.a === wire.b ? [wire.a] : [wire.a, wire.b];
  return [];
}
