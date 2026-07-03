# m6/interaction-pointer-r2-p1 — src/interaction/pointer.ts

Files touched: `src/interaction/pointer.ts` only.

Score: 53 -> 51 (byRule before: max-lines-per-function 1, id-length 50,
sonarjs/cognitive-complexity 2; after: max-lines-per-function 1, id-length 50,
sonarjs/cognitive-complexity 0).

Complexity reductions:
- `pointerdown` listener (cognitive complexity 43): extracted the entire
  node-hit branch into `handleNodePointerDown`, then further split that into
  `traceTypeChip` (type-chip double-click de-dupe/trace), `handleLinkModeClick`
  (link-mode wiring), `isAdditiveClick` (modifier-key check), and
  `selectNodeForClick` (selection semantics). The listener now just routes to
  small named helpers with early returns.
- `pointerup` listener (cognitive complexity 25): extracted the node-drag
  commit path into `finishNodeDrag` and the link-drop resolution into
  `finishLinkDrop`.
- Local params introduced in new helpers were given clearer names
  (`target`, `pev`) rather than reusing single-letter `t`/`e`, keeping the
  id-length warning count flat instead of growing.

Both hot functions (>=15 complexity) eliminated; 0 remain on the target.
