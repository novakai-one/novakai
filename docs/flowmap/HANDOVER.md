# HANDOVER — NovaKai Flowmap (per-folder maps)

You are continuing for **Chris** (solo dev). Read this, then the three repo docs in §A,
then continue from §D.

## Response style (enforced by auto-loaded skills)
Open every reply with `## Confidence : N%` then `Key assumptions:` as dot points. Terse,
one concept per line, ASCII diagrams before prose. Chris is junior–intermediate React/TS,
wants honest pushback. Default replies short; expand only when asked.

## Chris's standing directives (IMPORTANT)
- Your job = get Flowmap MAPPING the codebase so Chris can SEE it. Do **not** try to fix or
  perfect NovaKai's code design. Map what exists accurately, including oddities.
- Make granularity/mapping decisions yourself (best guess) and document them. Don't ask Chris
  to resolve code-design questions.
- You CANNOT run `node`/`npm` on Chris's Mac. Chris runs `bundle`/`validate` and pastes output.
  Author strictly to grammar so fragments validate first try.

## 0. GOAL / definition of DONE
One `flowmap.mmd` per code folder, co-located, mapping that folder's unit(s). `docs/flowmap/root.mmd`
is the global map (containers + shared nodes + cross-edges). `npm run flowmap:bundle` merges all
fragments + root into `docs/flowmap/_bundle.mmd` (gitignored), which renders the whole codebase in
Flowmap.
- **MVP-done** = every top-level `src/` folder has a fragment + is a node in root; bundle validates;
  Chris can drill into any part. (Remaining list in §E.)
- **Full-done** = substantive submodules also drilled to function-altitude where Chris wants review.

Repo: `/Users/christopherdasca/Programming/NovaKai/Novakai` (Filesystem MCP).

## A. READ THESE FIRST (authoritative)
- `src/flowmap-mermaid/README-SyntaxCreator.md` — the `.mmd` grammar (shapes, kinds, frontmatter,
  the DTO + orchestrator edge patterns). `i<N>.accepts` is REPEATABLE → one `name: Type` line per arg.
- `docs/flowmap/FRAGMENT_SPEC.md` — fragment/bundle/namespace rules.
- `docs/flowmap/AUTHORING_GUIDE.md` — the NovaKai role→node mapping (Door/Translator/Worker/Committer),
  shared-node list, gotchas, per-folder procedure. **This is the project layer; follow it.**

## B. ARCHITECTURE BEING MAPPED (ground truth, read from code)
```
WSA (conduit) builds a DocDraft, then calls each manager IN ORDER, threading the returned draft:
    route: buildDraft -> bm.receive*(draft) -> sm -> dm -> lm -> commit
Managers are SIBLINGS of WSA. They NEVER call each other (drawing bm->sm was a real bug — fixed).
Every manager door: (draft: DocDraft) -> DocDraft   (uniform).
Door pattern: draftToFlat(draft) -> _receive*Flat (works on DocShape) -> foldIntoDraft.
DocShape = the flat view/projection of DocDraft (proposed ?? currentReadOnly per slice).
Event origins: ContentArea (typing/keys/clicks/blur, reads caret at source) and DragHandle (drag).
Persistence: WSA.commit -> setDataSet (Zustand store) + saveDocument (Supabase, debounced).
```

## C. CURRENT STATE — what is authored
Validated earlier at **88 nodes / 25 subgraphs PASS** (root + first 7 fragments).
A later batch was authored but **NOT yet re-validated** (Chris never pasted the result).

Authored fragments (path : `%% root <C>`):
```
docs/flowmap/root.mmd                                              (global map)
src/managers/blockManager/flowmap.mmd                  : blockManager   [from the original proven file]
src/managers/selection/flowmap.mmd                     : selection
src/managers/layout/flowmap.mmd                        : layout
src/components/blocks/draggable/dragManager/flowmap.mmd : drag
src/components/workspace/flowmap.mmd                   : workspace       (the conduit, function-altitude)
src/components/store/flowmap.mmd                       : store           (Zustand)
src/managers/flowmap.mmd                               : draft           (payload spine — draft.ts lives loose in managers/)
src/components/blocks/draggable/dragContainer/flowmap.mmd : dragContainer (+ DragHandle inlined)
src/components/blocks/ContentArea/flowmap.mmd          : contentArea
src/model/flowmap.mmd                                  : model
src/storage/flowmap.mmd                                : storage         (Supabase persistence)
```
Root globals (14 containers/shared): workspace, blockManager, selection, drag, layout, draft,
dragContainer, contentArea, DocDraft, DocShape, model, store, storage, supabase, dom.
Shared lenses in root: `dom` (= what bypasses React), store vs storage split, `supabase` (used by storage + auth).

## D. FIRST ACTION — validate the current bundle
```
npm run flowmap:bundle && npm run flowmap:validate
```
Expected if the merge is sound: **123 nodes, 34 subgraphs, 1 header, 1 root, PASS**.
Integrity formula (has matched every run): `bundle nodes = root globals + every fragment's private nodes`
(deps stubs that name a global id are dropped; private ids are namespaced `<C>__<id>`).
If numbers differ or it FAILs, the message names the file/id — trace it.

## E. REMAINING TODO (order = next steps to DONE)
1. `src/components/panels/` — **LeftPanel = event origin #3** (panel bridge; also calls saveDocument/loadDocument). RightPanel. Highest value left. Add `leftPanel`/`rightPanel` to root.
2. `src/auth/` — `useAuthStore` + Login (+ supabase auth). Add `auth` container; it references shared `supabase`.
3. `src/theme/` — `useThemeStore` (theme shares the `workspaces` row's `theme` column). Add `theme` container.
4. `src/types/` — `COMPONENT_REGISTRY` (type→component dispatch) is worth a node/container; `trigger-words.ts`
   is the `TriggerWord` union (a shared type); `types.ts` is pure type law (frontmatter cross-links, likely no fragment).
5. Leaf block folders — `CanvasArea`, `DatabaseArea`, `database/` (config UI). One fragment per folder.
6. Bridge internals — `src/components/workspace/modules/` (pointer/panel bridge sources; currently nodes in the workspace fragment).
After 1–5: MVP-done. Then optional deepening (§F).

## F. OPEN MAPPING DECISIONS (you decide, document the call)
- **Submodule promote-vs-inline.** Currently inlined as PRIVATE internals: selection's `core/router`,
  `core/shapeBuilder`, `clipboard`, `highlighting`, `range`; layout's `module/workspaceLayout`, `grid`; .
  Promote a submodule to its own fragment + root container ONLY when Chris wants to drill into it for review.
  Substantive candidates to promote later: `workspaceLayout` (DOM-coupled tidy logic), selection `router`/`shapeBuilder`.
- **BlockManager dual path** is a code reality, not yours to fix: Editor types it from `managers/blockManager/`
  (so the fragment is co-located there); App values it from `components/blocks/blockManager/`. Map the managers/ one. Just note it.

## G. GOTCHAS (each already bit once)
- Bundler globs files named EXACTLY `flowmap.mmd`. A loose module file (e.g. `draft.ts`) → put its fragment
  in the containing folder as `flowmap.mmd` (that's why draft is `src/managers/flowmap.mmd`).
- `end` is a Mermaid reserved word → never a node id (use `end_`). Watch other keywords too.
- Filesystem MCP can hang under load → read in small batches (2–3 files), WRITE before more reads. If it crashes
  mid-session, finish pending writes from memory, then write a fresh handover as the last action.
- A dep stub MUST name a GLOBAL id (in root) or it won't drop — it becomes a stray private node. If a referenced
  unit is used by 2+ folders, add it to root as a shared node first.
- `validate.mjs` checks STRUCTURE only (dup ids, dangling refs, one kind/root). It does NOT check truth (right names,
  real call order, accept/return types). Those come from SOURCE + Chris's eye in Flowmap. Green ≠ accurate.

## H. PROCEDURE per folder (short)
Read source (small batch) → container `<C>` = folder's main unit (ensure `<C>` in root) → Doors/Translators/
Workers/Committers as nodes, sectioned by phase into parented subgraphs → wire REAL call order (solid, numbered
fan-out; payload/DOM/store as dotted satellites) → external refs = dep stubs with global ids → save `<folder>/flowmap.mmd`
→ ask Chris to validate → after a batch, Chris bundles + eyeballs in Flowmap. Author from CODE; every pre-existing `.mmd`
in the repo (except these fragments) is stale.
