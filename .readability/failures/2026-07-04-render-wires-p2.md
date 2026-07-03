# M6 render-wires-p2 — FAILED (diff budget exceeded)

## Gate that failed
Step 4 ABSOLUTE RULE — "DIFF BUDGET: max 300 changed lines on TARGET
(additions+deletions per git diff --numstat)."

## Exact evidence
```
$ git diff --numstat src/render/wires.ts
340	275	src/render/wires.ts
```
Total changed lines = 340 + 275 = 615, which is more than double the 300-line
budget.

## What was attempted
src/render/wires.ts (pass #2) had a baseline score of 34 (31 id-length + 3
max-lines-per-function; cognitiveComplexity: []). To clear the 3
max-lines-per-function warnings (initWires 222 lines, drawWires 195 lines,
drawEdge 100 lines — all closures nested inside initWires, closing over
`wires`/`world`/loop-local state), the nested closures were lifted to
module-scope, module-private functions (buildObstacles, overNode, paintDefs,
isIncidentEdge, bothMatchTrace, boundaryStub, strokeColorFor/strokeWidthFor/
markerUrlFor, drawEdgeHalo/drawEdgeMainPath/drawEdgeBendHandle,
placeLabelPosition, drawEdgeLabel, drawEdge, renderEdgesAtLevel, paintWires,
edgePath, retargetMovedEdges), threading a small `DrawState`/`EdgeVisual`/
`StubEnds` bundle through them to keep max-params <= 4. This did reduce the
target's post-edit eslint output on src/render/wires.ts to 4 warnings (only
the 4 unfixable id-length hits on exported orthoPath/midOf/labelAnchor
parameters, which cannot be renamed without touching the exported
signature — verified via a live typecheck+lint run before the budget check
stopped the pass), with 0 cognitive-complexity and 0
max-lines-per-function warnings remaining. typecheck was clean throughout.

However, because every nested closure had to move to file scope (not just
the 3 oversized functions), the total diff size on the single target file
came out to 615 changed lines — the mechanical cost of un-nesting ~15
closures out of `initWires`/`drawWires`/`drawEdge` in one pass, well past the
300-line ceiling.

## What was reverted
`git reset --hard` on m6/render-wires-p2, discarding the entire uncommitted
rewrite of src/render/wires.ts. Branch is back at m6/integration HEAD
(commit 99851b1). No commit was made. This failure file is left uncommitted
per protocol.

## Recommendation for a future pass
Split this fix across passes and/or budget: pass A extracts only
`buildObstacles`/`overNode`/`paintDefs`/`boundaryStub` (fixes drawWires's
line count with a smaller diff), pass B extracts `drawEdge`'s inner
helpers, pass C tackles remaining id-length renames — each independently
under the 300-line ceiling.
