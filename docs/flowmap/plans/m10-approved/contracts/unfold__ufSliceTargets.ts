// @flowmap-node unfold__ufSliceTargets kind=function
/** pure mapping from unfold's selection shape to slice target ids: a non-empty selected card/group id wins → [sel]; else a selected wire → its two endpoints deduplicated for a self-loop; else [] meaning full diagram (the legacy no-selection contract); an empty-string sel counts as no selection */
export function ufSliceTargets(_sel: string | null, _wire: { a: string; b: string } | null): string[] {
  throw new Error('unimplemented');
}
