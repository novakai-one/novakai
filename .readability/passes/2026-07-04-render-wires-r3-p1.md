# M6 readability pass — src/render/wires.ts (r3-p1)

**File touched:** `src/render/wires.ts`

**Score:** 32 -> 26 (target strictly lower; no other files touched)

## Complexity reductions

- `drawWiresImpl` was 127 lines (max-lines-per-function, limit 60). Extracted
  `drawEdge`, `boundaryStub`, and the edge-dispatch loop (`paintVisibleEdges`)
  to module scope. Their own signatures stay byte-identical to before
  (`e/a/b` and `e/inner/outer/innerIsFrom`) since the novakai map tracks
  `wires__drawEdge`'s exact param types — the surrounding per-repaint state
  (wires/world/state/sig/traced flags/overNode/placedLabels/stubCounts/
  container) is threaded through a new module-scope `pc: EdgePaintCtx`
  handle set by `paintVisibleEdges`, rather than added as extra parameters.
  `drawWiresImpl` is now ~40 lines; `paintVisibleEdges` ~30.
- Local-only renames (no signature changes): `labelAnchor`'s `a,b` ->
  `pointA,pointB`; `edgePath`'s `p,q` -> `portA,portB`.
- `id-length` warnings: 31 -> 26 from the above; `max-lines-per-function`: 1 -> 0.

## Verification

typecheck, lint --quiet, spec:test:all, test:src all green. API-surface hash
for `src/render` unchanged. novakai gate: 0 errors (2 pre-existing-class
warnings, non-blocking).
