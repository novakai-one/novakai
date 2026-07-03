# M6 readability pass — src/interaction/pointer.ts (p1)

Files touched: `src/interaction/pointer.ts` only (plus this note and the
regenerated `.readability/baseline-scores.json` ratchet).

Score: 57 -> 53 (strictly lower; TARGET-only ratchet requirement met).

Complexity reductions:
- `pointermove` listener (cognitive complexity 58, the worst offender):
  extracted into named module-private helpers `handleLabelDragMove`,
  `handleBendDragMove`, `handlePanMove`, `handleNodeDragMove` (itself
  split further into `hideIncidentEdgeDecor`, `pinMoverBasePosition`,
  `applyDragTransform`), `handleResizeMove`, `handleMarqueeMove`,
  `handleLinkMove`. The listener body is now a flat early-return dispatch.
- `startDrag` (complexity 19): extracted the nested group-membership
  loop into `collectGroupExtras`.
- Hoisted the 3x-duplicated `import('../core/types/types').PortSide`
  inline type into a top-level `PortSide` type import (fixes the
  `sonarjs/no-duplicate-string` warning).
- Added a one-line `//` comment above the exported `initPointer`.

Left for a future pass (diff-budget limited): the `pointerdown` listener
(complexity 43) and `pointerup` listener (complexity 25) are still above
the threshold. All new local helper params were named `pt`/`ev`/`grp`
(not single letters) to avoid inflating `id-length` warnings.
