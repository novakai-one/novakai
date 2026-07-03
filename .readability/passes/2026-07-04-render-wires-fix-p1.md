# M6 render-wires-fix-p1

## Files touched
- `src/render/wires.ts`

## Score
- `src/render/wires.ts`: 34 -> 33 (`id-length` 31 -> 31 unchanged; `max-lines-per-function` 3 -> 2; `cognitiveComplexity` [] -> [] unchanged)

## Complexity reductions
Scoped to bringing exactly one oversized function under 60 lines, per pass
orders: `drawEdge` (100 lines -> under 60, no longer flagged). Extracted its
nested closures to module-private, file-local functions: `edgeStrokeColor`,
`edgeStrokeWidth`, `edgeMarkerUrl`, `drawEdgeHalo`, `drawEdgeMainPath`,
`drawEdgeBendHandle`, `placeEdgeLabel`, `edgeLabelPosition`,
`edgeLabelClassName`. `drawEdgeMainPath` needed >4 params so its edge/path/
selection state was bundled into a small `EdgeDrawState` interface and its
stroke/width/marker values into `EdgeVisual`, keeping `max-params` clean (no
new warning). New functions' params were given clear multi-char names
(`edge`, `pathD`) rather than reusing the file's single-letter convention, so
no new `id-length` warnings were introduced.

`initWires` (222 -> 154) and `drawWires` (195 -> 127) both shrank as a side
effect (drawEdge is nested inside them) but remain over 60 lines — left for a
future pass, as instructed. Diff: 120+91 = 211 changed lines (budget 300).
