# Flowmap fragment + bundle spec

Goal: one `.mmd` per folder so maps scale with the codebase. Merge them into one
spec-valid `.mmd` ("the bundle") on demand for a whole-codebase view.
Flowmap is unchanged — every fragment AND the bundle are ordinary
`SYNTAX_README` files that the existing renderer already reads.

```
root.mmd ── global namespace: containers, shared nodes, cross-container edges
  │
  ├── src/blockManager/flowmap.mmd                   one container's internals
  ├── src/selectionManager/flowmap.mmd
  └── ...                                             one per folder (like a README)

bundle = root.mmd + every fragment, merged   (generated, never edited, gitignored)
```

## The one rule that drives everything

```
defined in root.mmd        -> GLOBAL id   (one node for the whole codebase)
defined only in a fragment -> PRIVATE id  (namespaced `<container>__<id>` at merge)
```

That is the whole namespace model. No export/import lists to maintain.
Two folders can both contain `createBlock`; the bundler keeps them apart as
`blockManager__createBlock` and `selectionManager__createBlock`.

## root.mmd

One concept per line:

- header `flowchart LR`, then `%% root main` (main = top-level entry node).
- defines every CONTAINER as a node (e.g. `blockManager`).
- container frontmatter here is the PUBLIC CONTRACT only (`i0`/`i1`… the public methods).
- defines every SHARED node — stores, types, registries, modules used by 2+ folders.
- defines CROSS-CONTAINER edges — container→container, container→store, container→type.
- does NOT define any container's internals.
- every id defined here is global. A container id is the JOIN KEY to its fragment.

## Fragment (one per folder)

- header `flowchart LR`, then `%% root <containerId>` where `<containerId>` is a node in root.mmd.
- defines that container's internals: publics as nodes, internal functions, workers, builders.
- group internals in subgraphs; attach each group to the container with `%% parent <subgraph> <containerId>`.
- publics are DUAL-LOCATED: listed in the container frontmatter (`i0`/`i1`…) AND present as nodes. Same names both places.
- lists cross-folder refs as local STUB nodes whose ids are GLOBAL (defined in root.mmd).
- group those stubs in a `Dependencies` subgraph. Do NOT `%% parent` it.
- renders standalone in Flowmap because the stubs satisfy its edges.

## Hard rules

```
fragment %% root id MUST be a node in root.mmd   else container won't attach
cross-fragment edges target GLOBAL ids only      never point at a foreign private internal
a private id MAY repeat across folders           bundler namespaces them apart
do NOT edit the bundle                           edit fragments, then re-bundle
```

## What the bundler does (mechanical, in order)

```
1  read root.mmd                 -> the set of GLOBAL ids
2  each fragment: rename every non-global id -> <container>__<id>
                                    (nodes, edges, subgraphs, %% parent / kind / fm:meta)
3  drop each fragment's stub of a global id
   drop the emptied Dependencies subgraph
   drop any now-dangling %% parent
4  keep ONE header + ONE `%% root main`; demote fragment roots to plain nodes
5  ownership:
     global node line + %% kind        from root.mmd
     container %% fm:meta               from its fragment   (canonical, overrides root placeholder)
     other global %% fm:meta            from root.mmd
     private everything                 from its fragment
6  drop %% fm / %% edge geometry        (Tidy re-lays the bundle)
7  emit in SYNTAX_README section order
```

## Drill-in result

```
top level        a container is ONE node; publics live only in its frontmatter
drill into it    publics appear as nodes (layer 1), then internals by depth
edge to a dep    crosses the level -> renders as a labelled boundary stub beside the inner node
```

This is existing Flowmap behaviour. The bundler only has to emit correct
`%% parent` chains and globally unique ids; the renderer does the rest.
