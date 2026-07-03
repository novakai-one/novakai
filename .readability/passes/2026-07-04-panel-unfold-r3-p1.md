# M6 readability pass — panel-unfold-r3-p1

**File touched:** `src/panel/unfold.ts`
**Score:** 194 -> 145 (byRule before: id-length 191, max-lines-per-function 1,
max-params 2; after: id-length 142, max-lines-per-function 1, max-params 2)

## What changed
Renamed ~49 unclear single-letter LOCAL variables (never parameters — every
`function(a, b)` / arrow-callback parameter was left byte-identical per the
hard no-signature-change rule) to descriptive names across `isRendered`,
`visibleRep`, `groupEl`, `cardEl`, `ifaceHtml`, `box`, `parseAllow`,
`trustLayer`, `fillScopeEdgeFallback`, `fillRouteScopeRects`, `requestRoutes`,
`computeLifted`, `wireBadge`, `paintWireItem`, `stageFrameIds`,
`proxyTargetOf`, `stageRepOf`, `centroidOf`, `carriesType`, `renderStageGroup`,
`refreshStage`, `collectProxyLinks`, `deoverlapAngles`, `stageProxies`,
`renameInPlace`, `groupConns`, `invokeVerb`, and `buildActionsMenu` (e.g.
`u`→`cur`/`node`, `g`→`grpEl`/`sgroupEl`/`badgeEl`, `r`→`rect`/`route`,
`m`→`idx`/`mid`/`bucket`, `s`→`ids`/`verbCtx`, `t`→`ramp`/`trimmed`,
`e`→`edge`, `p`→`pathEl`, `n`→`count`).

## Not touched (unfixable within the hard rules)
- `max-params` (2): `wireHit`/`wireOpacity` need a 6th/5th param — forbidden
  (no arity changes).
- `max-lines-per-function` (1): `initUnfold` is the single composition-root
  closure every nested helper shares state through; splitting it is a
  file-boundary change, out of scope for this pass.
- ~93 remaining `id-length` warnings are function parameters (named or
  arrow-callback) or object literal keys tied to external types
  (`ViewAction`, `UEdge`) — left untouched.

Gates: typecheck, lint --quiet, spec:test:all, test:src all green. API
surface for `src/panel` byte-identical to `m6/integration`.
