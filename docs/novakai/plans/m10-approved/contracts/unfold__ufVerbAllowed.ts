// @novakai-node unfold__ufVerbAllowed kind=function
/** pure verb-applicability gate for unfold's hidden actions: over { sel, wire, clipboard, modelEmpty } — addNode/undo/redo always; connect/copy/duplicate/wrap/editMeta need a selected card or group; delete needs a card/group or a wire; paste needs a non-empty clipboard; edgeLabel/edgeReverse/edgeDelete need a selected wire; clearAll needs a non-empty model; unknown verbs are refused (fail closed) */
export function ufVerbAllowed(_verb: string, _s: { sel: string | null; wire: boolean; clipboard: boolean; modelEmpty: boolean }): boolean {
  throw new Error('unimplemented');
}
