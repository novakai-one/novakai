/* =====================================================================
   unfold-verbs.ts — the pure verb-applicability gate for unfold's hidden
   actions (overlay-scoped shortcuts + the selection-only '⋯' menu)
   ---------------------------------------------------------------------
   Which verb is invocable depends only on the selection shape: a card or
   group selected, a wire selected, a non-empty clipboard, an empty model.
   Scattered as if-guards inside a menu painter this is unprovable
   DOM-bound branching — and an offered-but-impossible verb (paste with an
   empty clipboard, edge ops with no wire) is exactly the class of silent
   wrongness the loop exists to kill. One pure function decides instead,
   so "the menu can never offer an impossible verb" is a red-then-green
   acceptance claim, not prose (E2/H1 factor-to-pure; ufDockReduce /
   ufSliceTargets precedent: dependency-free file inside the unfold
   module, unfold.ts consumes it).

   Table: addNode/undo/redo → always; connect/copy/duplicate/wrap/editMeta
   → a card or group is selected; delete → a card/group OR a wire is
   selected; paste → the clipboard is non-empty; edgeLabel/edgeReverse/
   edgeDelete → a wire is selected; clearAll → the model is non-empty;
   any unknown verb → false (fail closed). An empty-string sel counts as
   no selection (consistent with the sibling ufSliceTargets).
   ===================================================================== */

const ALWAYS = new Set(['addNode', 'undo', 'redo']);
const NEEDS_SEL = new Set(['connect', 'copy', 'duplicate', 'wrap', 'editMeta']);
const NEEDS_WIRE = new Set(['edgeLabel', 'edgeReverse', 'edgeDelete']);

export function ufVerbAllowed(
  verb: string,
  flags: { sel: string | null; wire: boolean; clipboard: boolean; modelEmpty: boolean },
): boolean {
  const hasSel = !!flags.sel;
  if (ALWAYS.has(verb)) return true;
  if (NEEDS_SEL.has(verb)) return hasSel;
  if (verb === 'delete') return hasSel || flags.wire;
  if (verb === 'paste') return flags.clipboard;
  if (NEEDS_WIRE.has(verb)) return flags.wire;
  if (verb === 'clearAll') return !flags.modelEmpty;
  return false;
}
