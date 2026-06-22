# Flowmap `.mmd` format — authoring spec

Authoritative reference for producing a Flowmap diagram file. Hand this to an
LLM with a codebase and ask for a single `.mmd` text file. Flowmap's **Load**
button (or Mermaid tab → *Apply text → canvas*) reads it directly.

A `.mmd` file is valid Mermaid `flowchart` syntax plus a few `%%` comment lines
that Mermaid ignores and Flowmap reads. Every Flowmap-only line starts with
`%%`, so the file is always a legal Mermaid diagram.

This spec is verified line-for-line against the parser. Following it produces a
file that loads, and that reads cleanly after pressing **Tidy**.

---

## 0. The two rules that decide readability

Tidy builds a tree. It needs to know the trunk.

1. Declare a root: `%% root <id>`.
2. Use **solid** arrows (`-->`) for the call/flow tree only. Use **dotted**
   arrows (`-.->`) for everything else.

Solid edges build the trunk. Dotted edges are references; Tidy parks their
target beside the node that uses it and routes the link around all boxes.
Get this split right and the diagram is readable. Get it wrong and it is flat.

---

## 1. Minimum viable file

```
flowchart TD
  app["WorkspaceArea"]
  store[("Zustand store")]
  app --> store
```

Complete and loadable. Nodes auto-place on a grid; Tidy repositions them.
Everything below is optional enrichment.

---

## 2. Line types

A file contains these line kinds. Put all `%%` lines above the body.

```
flowchart TD                         header (required)
%% root <id>                         layer-0 entry node
%% fm:meta <id> <key>=<value>        a node's name/desc/state/interface
<node definitions>                   one per line
<edge definitions>                   one per line
```

Two more line kinds exist but are NOT used when converting a codebase
(see §8): `%% fm` pins a position, `%% edge` forces routing. Skip both —
Tidy handles position and routing.

`%%` blocks may appear in any order relative to each other.

---

## 3. Header and root

```
flowchart TD
```

- Direction is one of `TD` (top-down), `BT` (bottom-up), `LR`
  (left-right), `RL` (right-left). `TB` is accepted as an alias for `TD`.
- Direction sets how Tidy stacks layers. `TD` lays each layer out as a
  horizontal row; `LR` lays each layer out as a vertical column.
- Choose by branching factor, not aesthetics. If the root — or any node — has
  3+ direct children, use `LR`. In `TD` those children form one wide row and
  every parent→child edge shares one vertical lane, so the labels collide. In
  `LR` the children stack in a column, each edge gets its own horizontal lane,
  and the labels separate. Reserve `TD` for shallow, narrow trees.

```
%% root <id>
```

- Names the entry node. Tidy forces it to layer 0 and grows the tree away
  from it.
- Repeatable: declare several roots for a forest.
- Omit it and Tidy picks nodes with no incoming solid edge. Declaring it
  explicitly is the single biggest factor in a readable result.

---

## 4. Node IDs

- An ID matches `[A-Za-z0-9_]+` — letters, digits, underscore only.
- No hyphens, dots, or spaces.
- One ID = one node. Reusing an ID refers to the same node.
- Use meaningful IDs (`dragManager`, `store`), not `n1`/`n2`. They make the
  `%% fm:meta` lines self-documenting.

---

## 5. Node shapes

Define each node with the shape that matches what it is. Label goes in quotes.

| Shape | Suggested meaning | Syntax |
|---|---|---|
| `rect` | module / class / file | `id["Label"]` |
| `round` | process / function | `id("Label")` |
| `stadium` | entry / exit point | `id(["Label"])` |
| `cylinder` | store / database / cache | `id[("Label")]` |
| `diamond` | decision / branch | `id{"Label"}` |
| `circle` | state / event | `id(("Label"))` |
| `hex` | service / external system | `id{{"Label"}}` |
| `note` | annotation | `id>"Label"]` |
| `group` | container (see §9) | `subgraph id ["Label"]` … `end` |

Label rules:
- Keep it short — a few words. Detail belongs in frontmatter (§7).
- Replace any `"` inside the label with `'`.
- One line; no newlines.

A node first seen on an edge line with no definition becomes a `rect`. Define
every node explicitly to control its shape.

**Shape signals role, edges decide it.** Tidy lays out two kinds of node:
- **Spine** — the flow tree. Fits `rect`, `round`, `stadium`, `diamond`.
- **Satellite** — referenced but not flowed through (stores, services,
  events, types). Fits `cylinder`, `hex`, `circle`, `note`.

The real role is set by edge style (§6), not shape. Pick the shape that
matches the role so the two agree.

---

## 6. Edges

```
a --> b                 solid arrow (spine)
a ==> b                 thick arrow (spine, emphasized)
a -.-> b                dotted arrow (reference)
a -->|verb| b           labelled arrow
a -.->|writes| b        dotted + label
```

**Edge labels are NOT quoted.** The text between the pipes is taken literally.

```
a -->|routes event| b     correct   → label: routes event
a -->|"routes event"| b    wrong     → label: "routes event"  (quotes included)
```

One edge per line. Direction means dependency / send: `a --> b` = a depends on
or sends to b.

### Edge style drives Tidy

- **Solid (`-->`) and thick (`==>`) = spine.** The flow tree. They define
  parent → child and pull nodes into layers.
- **Dotted (`-.->`) = reference.** Callbacks, write-backs, wiring, reads, type
  use. Drawn as a link, ignored by layout — a dotted edge never moves a node.

Authoring contract:
1. Draw the call order as one solid chain or branch: `root --> a --> b`.
2. Make every back-reference, callback, write-back, wiring, and type-use
   dotted. An edge pointing back up the tree is almost always dotted.
3. Keep the solid graph acyclic. A cycle in solid edges hides the trunk and
   flattens the layout.

On Tidy, every dotted edge is automatically routed orthogonally and steered
around all node boxes. You do not mark routing by hand.

Label edges with the verb of the relation: `reads`, `writes`, `calls`,
`emits`, `returns to`. The labels make the diagram a sentence.

### Two patterns that break the spine split

These two cases are the most common mapping errors. Handle them explicitly.

**1. Value / DTO objects are parameters, not call-graph nodes.**

A value threaded through functions — a DTO, event, snapshot, immutable state
object — is data passed *as an argument*, not a step in the flow. Do not put it
in the trunk with solid edges.

```
wsa --> shape --> handler        wrong  → shape sits in the trunk as a stage
wsa -.->|builds| shape           right  → shape is a satellite value
```

Model it as a satellite (`circle` / `note`) with a dotted edge from the node
that creates it. Its accepts/returns already live in each node's frontmatter.

**2. An orchestrator fans out; it does not chain its helpers.**

When one node calls several helpers in sequence (a conduit, mediator, pipeline
driver), each helper is called *by the orchestrator*. The helpers do not call
each other.

```
orch --> a --> b --> c           wrong  → reads as a calls b calls c
orch -->|1| a                    right  → orch calls each helper
orch -->|2| b
orch -->|3| c
```

One helper's output feeding the next is mediated by the orchestrator — that is
not a helper-to-helper call. Draw a solid edge from the orchestrator to each
helper and put the sequence in the labels (`1`, `2`, `3`). The helpers become
siblings in one layer. Any result handed back to the orchestrator is a dotted
`returns` edge, not a solid one.

---

## 7. Frontmatter — a node's public interface

The payload most worth extracting from code. Two levels: node-level fields and
per-interface fields. Each is one `%% fm:meta` line.

Node-level:

```
%% fm:meta <id> name=<text>      display name; at most once
%% fm:meta <id> desc=<text>      one-line description; at most once
%% fm:meta <id> state=<text>     one owned state field; repeatable
```

Per-interface — a node may expose several, numbered from `0`:

```
%% fm:meta <id> i<N>.name=<text>      interface name; at most once per N
%% fm:meta <id> i<N>.accepts=<text>   one input; repeatable
%% fm:meta <id> i<N>.returns=<text>   one output; repeatable
```

Value rules:
- The value is everything after the first `=` to the end of the line.
- Do NOT quote it.
- It may contain spaces, `:`, `|`, `,`, `<`, `>`, `&` — all literal.
- It may not contain a newline. One item per line.
- Do not put `%%` inside a value.

Map from code:
- `name` → the symbol's declared name.
- `desc` → its one-line purpose.
- `state` → fields / instance variables it owns.
- `i<N>.name` → one public method / entry point / message.
- `i<N>.accepts` → that interface's params / props / handled messages.
- `i<N>.returns` → that interface's return type(s) / emitted output.

Use a single interface `i0` for a simple node; add `i1`, `i2`, … for several
distinct entry points. A node may leave `i0.name` blank and emit only
`i0.accepts` / `i0.returns`. Omit any field that does not apply; a node with no
`%% fm:meta` lines has no frontmatter.

Example:

```
%% fm:meta store name=Store
%% fm:meta store desc=single source of truth for the diagram model
%% fm:meta store state=nodes: Record<string, Node>
%% fm:meta store state=edges: Edge[]
%% fm:meta store i0.name=patch
%% fm:meta store i0.accepts=p: Partial<State>
%% fm:meta store i0.returns=void
%% fm:meta store i1.name=snapshot
%% fm:meta store i1.returns=State
```

Frontmatter display is toggled in the app (Style tab → "Frontmatter cards") but
is always kept in the file. Write it regardless of display state.

---

## 8. Groups, positions, routing markers

### Groups (containers)

A group wraps related nodes. Declare it as a Mermaid `subgraph`; list the child
definitions between `subgraph` and `end`.

```
subgraph domain ["Domain layer"]
  store[("app store")]
  reducer("rootReducer")
end
```

- A group can carry frontmatter: `%% fm:meta domain desc=…`.
- Declare edges in the body (§6), never inside the `subgraph`.
- Membership is structural: a node belongs to the group whose `subgraph … end`
  its definition sits between. Load position does not change it.

When to use a group:

- Group nodes that share an owner — a layer, package, or bounded context.
- Skip plain sequential flow; the spine already shows order.
- A one-member group adds noise; inline the node instead.

### Positions and routing — skip when converting

```
%% fm <id> <x> <y> <w> <h> <shape> <color>      pin one node's box
%% edge <id> ortho                              force ortho on one edge
```

- `x y w h` are integers (pixels, top-left origin, y grows down). `<shape>` is
  a §5 key. `<color>` is `#rrggbb` or the literal `null`.
- Do NOT emit these when converting a codebase. Tidy positions every node and
  auto-routes every dotted edge. Pinning is a manual polish step done in the
  editor afterward.

---

## 9. What makes Tidy readable

A clean result comes from four things, in order of impact:

1. One declared `%% root`.
2. Solid edges form a single acyclic tree following real call order.
3. Every other relation is dotted.
4. Shapes match role (spine shapes vs satellite shapes).

Tidy then stacks the spine into layers, parks each satellite beside the node
that references it, and routes every dotted link around the boxes.

---

## 10. Conversion procedure (for an LLM reading a codebase)

1. **Identify units.** One node per meaningful unit — module, class, service,
   store, major function. Aim for the architecture: ~5–40 nodes, not one per
   line.
2. **Choose IDs.** Short, unique, `[A-Za-z0-9_]+`. Prefer the symbol name
   (`paymentService`).
3. **Choose shapes** (§5) from what each unit is.
4. **Pick the entry node** — where flow starts. Emit `%% root <id>`.
5. **Draw the spine with solid arrows** (§6): one acyclic chain or branch in
   real call order, `root --> a --> b`. Apply the two §6 patterns: a value
   object (DTO / event / snapshot) is a dotted satellite, not a trunk stage; an
   orchestrator draws a solid edge to *each* helper (labels `1`/`2`/`3`), never
   helper-to-helper.
6. **Draw everything else dotted** (`-.->`): callbacks, write-backs, wiring,
   reads, type use, any edge pointing back up the tree, any result returned to
   a caller. Label every edge with the verb of the relation.
7. **Attach frontmatter** (§7) for each node: name, one-line desc, owned state,
   then one numbered interface per entry point with its accepts/returns.
8. **Group related nodes (optional).** When several nodes share an owner —
   a layer, package, or bounded context — wrap their definitions in
   `subgraph id ["Label"] … end` (§8). Membership is the nesting, not position,
   so a converted file clusters on the first Tidy. Skip plain sequential flow;
   one-member groups add noise.
9. **Do not emit `%% fm` or `%% edge` lines.** Tidy handles position and
   routing.
10. **Output order:** header, then `%% root`, then `%% fm:meta` lines, then the
    node and `subgraph` definitions, then the edge definitions. Output only the
    `.mmd` text.

---

## 11. Grammar reference (exact)

Lines Flowmap reads. `<value>` runs to end of line, unquoted, no newline.

```
flowchart TD                                  TD | BT | LR | RL
%% root <id>
%% fm:meta <id> name=<value>
%% fm:meta <id> desc=<value>
%% fm:meta <id> state=<value>
%% fm:meta <id> i<N>.name=<value>
%% fm:meta <id> i<N>.accepts=<value>
%% fm:meta <id> i<N>.returns=<value>
id["Label"]      id("Label")      id(["Label"])
id[("Label")]    id{"Label"}      id(("Label"))
id{{"Label"}}    id>"Label"]
subgraph id ["Label"] … end
a --> b          a ==> b          a -.-> b
a -->|label| b   a -.->|label| b
```

Hard rules:
- IDs: `[A-Za-z0-9_]+`. No `-`, `.`, or spaces.
- Node labels: quoted; replace `"` with `'`; one line.
- Edge labels: between pipes, NOT quoted.
- Frontmatter values: after the first `=`, not quoted, `< > & | : ,` literal.
- Never put `%%` inside a label or value.

---

## 12. Worked example

```
flowchart TD
%% root workspace
%% fm:meta workspace name=WorkspaceArea
%% fm:meta workspace desc=root canvas surface; routes pointer events
%% fm:meta workspace i0.name=onPointer
%% fm:meta workspace i0.accepts=PointerEvent
%% fm:meta workspace i0.returns=void
%% fm:meta drag name=DragManager
%% fm:meta drag desc=tracks an in-progress drag and commits it
%% fm:meta drag state=active: DragItem | null
%% fm:meta drag i0.name=start
%% fm:meta drag i0.accepts=id: string
%% fm:meta drag i0.returns=void
%% fm:meta drag i1.name=move
%% fm:meta drag i1.accepts=point: Point
%% fm:meta drag i1.returns=void
%% fm:meta drag i2.name=commit
%% fm:meta drag i2.returns=void
%% fm:meta store name=Store
%% fm:meta store desc=single source of truth for the diagram model
%% fm:meta store state=nodes: Record<string, Node>
%% fm:meta store state=edges: Edge[]
%% fm:meta store i0.name=patch
%% fm:meta store i0.accepts=p: Partial<State>
%% fm:meta store i0.returns=void
%% fm:meta store i1.name=snapshot
%% fm:meta store i1.returns=State
  workspace["WorkspaceArea"]
  drag("DragManager")
  isDragging{"Dragging?"}
  store[("Store")]
  tiles(["render tiles"])
  workspace -->|routes event| drag
  drag -->|commits to| store
  drag -.->|checks| isDragging
  store -.->|rendered by| tiles
```

Load it, press **Tidy**. The solid edges form the spine
`workspace → drag → store`, stacked from the root. The dotted edges park
`isDragging` beside `drag` and `tiles` beside `store`, each link routed around
the boxes. A public-interface card sits under each node when frontmatter
display is on.
