# Pass: src/panel/unfold.ts (r3-p2)

Files touched: `src/panel/unfold.ts` only.

Score: 145 -> 118 (byRule before: max-lines-per-function 1, id-length 142,
max-params 2; after: max-lines-per-function 1, id-length 115, max-params 2).
cognitiveComplexity: 0 -> 0 (no hot functions before or after).

## What changed
Renamed 27 unclear single-letter LOCAL variables (never parameters, never
object-literal keys tied to an external/imported type shape such as
`ViewAction`, `DiagramNode`, `Box`, `UEdge`) to descriptive names, across
14 small, independently-scoped blocks:

- `drawStageProxyWires`: loop var `e`->`edge`, `let s`->`source`
- `drawStageWires`: loop var `e`->`edge`, `a`/`b`->`repA`/`repB`, `d`->`pathD`
- `resolveSelWireEdgeId`: destructured `a`/`b`->`nodeA`/`nodeB`, `e`->`foundEdge`
- `mountFrontmatter`: `n`->`node`
- `buildEditMetaRow`: `n`->`node`, two closure-local `v`->`kindValue`/`descValue`
- `buildEdgeLabelRow`: `e`->`edge`, `v`->`value`
- `filterTree`: loop var `u`->`node`
- `buildContainerRoleHtml`: loop var `c`->`childId`
- `conns()` closure: `m`->`seen`, loop var `e`->`edge`
- `renderNodeInspector`, `select()`: `u`->`node`/`selNode`
- `renderTree()`, keydown handler: `t`->`treeEl`/`targetEl`
- `buildProxyEl`: `p`->`pillEl`

No function signature (exported or internal), arity, or parameter name
changed. `max-lines-per-function` (the 1876-line `initUnfold` composition
root) and `max-params` (`wireHit`/`wireOpacity`, 5 params) are left for a
future pass — fixing them safely requires either arity changes (forbidden)
or an extraction far beyond the 300-line diff budget.

Diff: 74/74 (add/del), well under budget.
