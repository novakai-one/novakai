# M6 readability pass — src/panel/unfold.ts (r2-p2)

Files touched: `src/panel/unfold.ts` (+ `.readability/baseline-scores.json` ratchet update).

Score: 285 -> 194 (byRule before: id-length 282, max-lines-per-function 1,
max-params 2; after: id-length 191, max-lines-per-function 1, max-params 2).
sonarjs/cognitive-complexity was already 0 both before and after (the last
hot function was eliminated in r2-p1); no cognitive-complexity work was
available this pass, so effort went entirely into id-length per the fallback
priority order.

Renames (all local/private, no exported/signature changes):
- Hoisted `LAYER_DEFS`'s `t`/`d` fields to `label`/`desc`; loop var `L` ->
  `layerDef`.
- Widely-scoped camera transform object `Z` (21 usages across
  clampPan/fitView/wheel/pointer handlers/reframeToFit/zoom buttons) ->
  `viewXform`.
- `contentSize()`'s return shape `{w,h}` -> `{width,height}`, updated at all
  4 call sites (drawWires, clampPan, fitView, reframeToFit).
- Function-local renames: `h` factory's `e`->`el`; dock/tab handlers'
  `e`/`b`/`t`->`ev`/`tabBtn`/`tab`; file-load handlers' `e`/`f`->`ev`/`file`;
  `populateNodesAndParents`/`applyHierGroups`/`computeEdgesAndAdjacency`'s
  `n`/`p`/`u`/`g`/`e`/`s`->`rawNode`/`parentId`/`entry`/`groupDef`/`edge`/`agg`;
  `parentOf`'s `n`->`node`; `deepFreeze`'s `s`->`viewSpec`; `apply`/`commit`/
  `paint`'s `a`->`action`/`modelIdx`; `computeBlast`'s `c`/`s`/`e`->
  `childId`/`seed`/`inEdge`; wheel/pointerdown/pointermove's `e`/`r`->
  `wheelEv`/`downEv`/`moveEv`/`rect`; `depthOf`'s `d`/`u`->`depth`/`entry`.
- Skipped renaming property keys tied to cross-file contracts (`.a`/`.b` on
  wire endpoints matching `ViewSpec.selWire`/`ufSliceTargets`'s param type in
  `unfold-slice.ts`; `UEdge.w`/`Box.w` shared across many call sites) —
  those would require edits outside `src/panel/unfold.ts` or touch too many
  unrelated sites for the diff budget.

Diff: 132 additions / 131 deletions on the target (within the 300-line budget).

No behavior change: `UnfoldApi`/`initUnfold` signature untouched; api-surface
hashes for every `src/panel` entry are byte-identical old vs new. Verified via
typecheck, `lint --quiet` (0 errors), `spec:test:all`, and `test:src`, all green.
