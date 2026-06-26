# Flowmap AUTHORING_GUIDE — NovaKai

How to author one `flowmap.mmd` per folder, from source. Project-specific layer.
Grammar + fragment mechanics are NOT repeated here — they are the source of truth:

- `src/flowmap-mermaid/README-SyntaxCreator.md` — the `.mmd` grammar (shapes, kinds, frontmatter, the DTO + orchestrator edge patterns).
- `docs/flowmap/FRAGMENT_SPEC.md` — fragment/bundle/namespace rules.

Read both before authoring. This file only adds the NovaKai conventions on top.

---

## 0. The shape of the system (so maps stay true)

```
WSA (conduit) builds a DocDraft, then calls each manager IN ORDER:
    bm -> sm -> dm -> lm        (threading the returned draft into the next call)
then commits.
Managers are SIBLINGS of WSA. They never call each other.
Every manager door: (draft: DocDraft) -> DocDraft   (uniform, no bespoke signatures)
```

- Order is carried by numbered edge labels on the orchestrator, never by manager-to-manager arrows (that was a real bug — it reads as bm calling sm).
- `DocDraft` / `DocShape` are VALUES, not flow steps → dotted satellite edges, never the solid trunk.

## 1. One fragment per folder

- Header: `flowchart LR` then `%% root <containerId>`.
- `<containerId>` MUST be a node in `docs/flowmap/root.mmd` (the join key). If it isn't, add it to root first (node + public contract + `%% kind` + cross-container edges).
- Container `<C>` = the folder's main exported unit. Its id = the folder name where practical.
- Author from CODE. Every pre-existing `.mmd` in the repo is stale — ignore as a source.

## 2. NovaKai role -> node mapping

| Role in code | Node | kind | Notes |
| --- | --- | --- | --- |
| Door (public `receive*`) | node, in a `Receivers` subgraph | function | dual-located: also an `i<N>` in the container frontmatter |
| Switch (the trigger dispatch inside a door) | NOT a node | — | shown as that door's OUT-edges (labelled with the trigger) |
| Translator (`_receive*Flat`, the flat action) | node | function | takes + returns `DocShape` |
| Worker (pure builder: `_setX`, `_buildX`, etc.) | node | function | a sibling of the translator; numbered fan-out |
| Committer (fold-back: `_updateProposed…`, `writeSlices`) | node | function | folds a built piece back |
| Orchestrator (a translator that fans out) | node | function | solid + NUMBERED edge to each worker; never chain worker->worker unless the code truly does |

- Owned state (instance fields) → container `%% fm:meta <C> state=field: Type` lines (repeatable). Types matter — they cross-link on the canvas.
- Multi-arg methods → ONE `i<N>.accepts=name: Type` line PER argument (accepts is repeatable). `route` is the example: 3 accepts lines.

## 3. Dependencies

- A ref to anything OUTSIDE the folder → a STUB node in a `Dependencies (external)` subgraph. Do NOT `%% parent` that subgraph.
- A stub's id MUST be a GLOBAL id (defined in root). The bundler drops the stub and resolves the edge to the global node.
- If a referenced unit isn't global yet but is used by 2+ folders, ADD it to root as a shared node.
- A folder's OWN submodules (its subfolders) are PRIVATE internals, not deps. Map them as private nodes. Promote a submodule to a root container ONLY when it gets its own `flowmap.mmd`.

### Shared nodes currently in root
```
DocDraft   type      the one Payload, in/out of every manager
DocShape   type      flat view threaded inside a manager
model      module    factories + keys (makeTextElement, layoutKey, databaseKey, ...)
store      store     useWorkspaceStore (Zustand, in-memory rendered state)
storage    service   persistence (useDocumentStorage -> Supabase)
dom        service   live DOM that bypasses React (style writes, getBoundingClientRect, CSS.highlights, caret) — boundary-review lens
```
Use `store` for in-memory reads/writes; use `storage` for load/save. Do NOT conflate them.
Edge any unit that touches the DOM directly to `dom` — it is the "what bypasses React" lens.

## 4. Edges

- Solid `-->` = real call order only (the spine). Acyclic.
- Dotted `-.->` = payload in/out, store reads/writes, type use, result returned up, DOM access.
- Orchestrator fans out (solid, numbered) to sibling workers. DTO is a dotted satellite.

## 5. Gotchas

- `end` is a Mermaid reserved word — never use it as a node id (use `end_`). Same caution for other Mermaid keywords.
- IDs are `[A-Za-z0-9_]+` only. A private id may repeat across folders (bundler namespaces `<C>__<id>`); it must NOT collide with a GLOBAL id unless it is a deliberate dep stub.
- Exactly one `%% kind` per node. Output order: header, `%% root`, `%% fm:meta`, `%% kind`/`%% parent`, node + `subgraph` defs, edges.
- No `%% fm` / `%% edge` geometry lines (Tidy positions). No hand-set colours (kind drives the tint).

## 6. Procedure (per folder)

1. Read the folder source (small batch — Filesystem MCP hangs under load; write before more reads).
2. Container `<C>` = folder main unit; ensure `<C>` is in root.
3. Doors → Translators → Workers → Committers as nodes; section them by flow phase into parented subgraphs.
4. Wire REAL call order (solid, numbered fan-out); payload/DOM/store as dotted satellites.
5. External refs → dep stubs with global ids (add to root if missing).
6. Save as `<folder>/flowmap.mmd`.
7. Validate: `node tools/flowmap/validate.mjs <folder>/flowmap.mmd` → PASS.
8. After a batch: `npm run flowmap:bundle && npm run flowmap:validate` → PASS. Open `docs/flowmap/_bundle.mmd` in Flowmap; confirm each container is one node and drills into its internals.

NB: `validate.mjs` checks STRUCTURE only (dup ids, dangling refs, one kind/root). It does NOT check truth — correct names, real call order, right accept/return types come from the SOURCE and your eye in Flowmap. A green bundle proves plumbing, not accuracy.
