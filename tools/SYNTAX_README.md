# Flowmap `.mmd` format — authoring spec
LLM reference for emitting a Flowmap diagram. Output one `.mmd` text file; Flowmap **Load** reads it directly. A file is valid Mermaid `flowchart` syntax plus `%%` comment lines Mermaid ignores and Flowmap reads — always a legal Mermaid diagram. Follow this and it loads and reads cleanly after **Tidy**. Emit only the `.mmd` text.

## 1. Layout model
Tidy builds a layered tree. Readability rules, in order of impact:
1. Declare one `%% root <id>` — forced to layer 0; the tree grows from it. Repeatable (forest). Omitted → Tidy infers roots from nodes with no incoming solid edge. Declaring it explicitly is the biggest readability factor.
2. **Solid** `-->` = spine (flow / call tree) ONLY. **Dotted** `-.->` = every other relation.
3. The solid graph stays acyclic and follows real call order.
4. Shape matches role.
- Tidy stacks the spine into layers, parks each satellite beside the node that references it, and routes every dotted link around the boxes. Wrong solid/dotted split → flat layout.
- **Spine** = flowed through. Shapes: rect, round, stadium, diamond.
- **Satellite** = referenced, not flowed through (store, service, event, type, DTO). Shapes: cylinder, hex, circle, note.
- Role is set by edge style, not shape; pick the shape that agrees with the role.

Minimum valid file:

```
flowchart TD
  app["WorkspaceArea"]
  store[("Zustand store")]
  app --> store
```

## 2. Grammar (exact — every line Flowmap reads)
`<value>` runs to end of line: unquoted, single line, never contains `%%`.

```
flowchart <dir>                       dir ∈ TD | BT | LR | RL   (TB = alias for TD)
%% root <id>
%% kind <id> <kind>                   REQUIRED, one per node. kind ∈ component|hook|class|store|module|function|type|service|event
%% parent <child> <parent>
%% fm:meta <id> name=<value>          ≤1 per node
%% fm:meta <id> desc=<value>          ≤1 per node
%% fm:meta <id> state=<value>         repeatable
%% fm:meta <id> i<N>.name=<value>     ≤1 per N; N from 0
%% fm:meta <id> i<N>.accepts=<value>  repeatable
%% fm:meta <id> i<N>.returns=<value>  repeatable
id["Label"]  id("Label")  id(["Label"])  id[("Label")]
id{"Label"}  id(("Label"))  id{{"Label"}}  id>"Label"]
subgraph id ["Label"] … end
a --> b   a ==> b   a -.-> b   a -->|label| b   a -.->|label| b
```

Hard rules:
- IDs `[A-Za-z0-9_]+` — no `-`, `.`, space. One ID = one node; reusing an ID is the same node. Meaningful names (`dragManager`, not `n1`).
- Node labels: quoted; replace `"` with `'`; one line; short (detail → §5).
- Edge labels: between pipes, NOT quoted, taken literally.
- Frontmatter values: after first `=`; not quoted; `< > & | : ,` literal; no newline; no `%%`.
- A node first seen on an edge with no definition defaults to `rect` — define every node to control its shape.
- `%%` lines may appear in any order; put all of them above the body.
- Direction: `TD`/`BT` stack each layer as a horizontal row; `LR`/`RL` as a vertical column. If the root or any node has 3+ direct children, use `LR` — in `TD` those children share one vertical lane and the labels collide. Reserve `TD` for shallow, narrow trees.
- Output order: header, `%% root`, `%% fm:meta`, `%% kind`/`%% parent`, node + `subgraph` defs, edge defs.

NOT emitted when converting a codebase (Tidy positions and routes; these are manual editor polish from dragging in the app):

```
%% fm <id> <x> <y> <w> <h> <shape> <color>          pin a node box
%% edge <id> ortho | bend <x> <y> | labelpos <x> <y>
```

## 3. Shapes & kinds
| Shape | Meaning | Syntax | Role |
| --- | --- | --- | --- |
| rect | module / class / file | `id["L"]` | spine |
| round | process / function | `id("L")` | spine |
| stadium | entry / exit | `id(["L"])` | spine |
| diamond | decision / branch | `id{"L"}` | spine |
| cylinder | store / db / cache | `id[("L")]` | satellite |
| hex | service / external system | `id{{"L"}}` | satellite |
| circle | state / event | `id(("L"))` | satellite |
| note | annotation / type | `id>"L"]` | satellite |

**Kind — REQUIRED on every node.** `%% kind <id> <kind>` tags the language construct, which shape alone cannot (`component`/`hook`/`class`/`module` all collapse to `rect`; `hook`/`function` both look `round`). Shape = role in the flow; kind = what it is in the code. Rendered as a corner badge + automatic fill tint (same kind = one visual family). Do not hand-set colours — kind drives the tint. Kind never affects layout.
| kind | use for | default shape |
| --- | --- | --- |
| component | UI component (React/Vue/etc.), view | rect |
| hook | hook / composable / reactive accessor | round |
| class | class, manager, stateful object instance | rect |
| store | store / slice / global reactive state | cylinder |
| module | file, namespace, util module, data table | rect |
| function | pure function, helper, factory | round |
| type | type, interface, DTO, schema | note |
| service | external system, API, backend, client | hex |
| event | event, message, signal, command | circle |

Shape and kind are chosen independently; the last column is only the default when you create a node by kind in the app, not a constraint.

## 4. Edges
- `-->` solid spine · `==>` thick spine (emphasis) · `-.->` dotted reference.
- Solid/thick define parent → child and pull nodes into layers.
- Dotted = callbacks, write-backs, wiring, reads, type use, any edge pointing back up the tree, any result returned to a caller. A dotted edge never moves a node; it is auto-routed orthogonally around boxes.
- `a --> b` means a depends on / sends to b. One edge per line.
- Label every edge with the relation verb: reads, writes, calls, emits, returns to.

Two mapping patterns (the most common errors):
**DTO / value object = parameter, not a node.** A value threaded through functions (DTO, event, snapshot, immutable state) is an argument, not a flow step. Model it as a satellite (circle/note) with a dotted edge from its creator; its shape already lives in each node's accepts/returns.

```
wsa --> shape --> handler    wrong  (shape sits in the trunk)
wsa -.->|builds| shape       right  (satellite value)
```

**Orchestrator fans out; it does not chain helpers.** A conduit / mediator / pipeline calls each helper itself. Draw a solid edge orchestrator → each helper with the sequence in the labels; any result back is a dotted `returns`. Helpers are siblings in one layer, never helper-to-helper.

```
orch --> a --> b --> c    wrong  (reads as a → b → c)
orch -->|1| a   orch -->|2| b   orch -->|3| c    right
```

## 5. Frontmatter (a node's public interface)
One field per `%% fm:meta` line:
- `name` = declared symbol name (≤1).
- `desc` = one-line purpose (≤1).
- `state` = one owned field / instance var (repeatable).
- `i<N>.name` = one public method / entry point / message.
- `i<N>.accepts` = that interface's params / props / handled messages (repeatable).
- `i<N>.returns` = that interface's return types / emitted output (repeatable).
- Use `i0` for a simple node; add `i1`, `i2`… for distinct entry points. `i0.name` may be blank with only accepts/returns. Omit fields that don't apply; no `%% fm:meta` = no frontmatter. A group (`subgraph`) may carry `name`/`desc`. Frontmatter is always kept in the file regardless of the display toggle.
- **Type cross-reference.** In `state`/`accepts`/`returns`, the text after the first `:` — or the whole item when there is no `:` — is the type. Items sharing a type name link on the canvas (click highlights every user). Reuse exact type names (`DocShape`, not `docShape`). Display-only; format unchanged.

```
%% fm:meta store name=Store
%% fm:meta store desc=single source of truth for the model
%% fm:meta store state=nodes: Record<string, Node>
%% fm:meta store state=edges: Edge[]
%% fm:meta store i0.name=patch
%% fm:meta store i0.accepts=p: Partial<State>
%% fm:meta store i0.returns=void
%% fm:meta store i1.name=snapshot
%% fm:meta store i1.returns=State
```

## 6. Containment, groups, drill-in
- **`%% parent <child> <parent>`** places `<child>` inside `<parent>` as an internal detail. The parent stays an ordinary node. The child does NOT appear on the parent's level — only on drill-in (Open internals / right-click / breadcrumb; Esc steps up). Arbitrary depth: a child may itself be a parent.
- A unit at two levels: top level = the unit as one node + its public-interface frontmatter; one level down = implementation (private functions, local state machine, helper nodes, wired with their own edges).
- **Drill-in is required for any unit you will review or redesign.** Author its private functions as child nodes with their private call order wired — not just the external modules it calls. A unit left as a single node is at architecture altitude and cannot carry a review.
- Edges that cross a level draw as a labelled boundary stub beside the inner node, naming the off-level endpoint, instead of a wire into hidden nodes.
- **Groups (`subgraph id ["Label"] … end`)** cluster nodes on the same level in a dashed box. Membership = the definitions between `subgraph` and `end` (structural, not position). Declare edges in the body, never inside the subgraph. Use for a shared owner / layer / bounded context; skip plain sequential flow; avoid one-member groups.
- Group vs parent: a group is visible together on one level; a parent is hidden, one level down. Group membership is transparent to levels — a grouped node still belongs to its drill-in level.
- **Sections — the highest-value use of groups.** The group label is the section caption (names what a cluster is for). When you decompose a unit, box its inner functions into purpose sections by flow phase, e.g. **Event routing**, **Rendering**, **Persistence**, **Validation**. A section is a `subgraph` parented into the unit so it lives on the unit's drill-in level. **`%% parent` goes on the section, never on the leaf** — the leaves sit inside the `subgraph` and reach the unit's level through it; parenting bare leaves straight onto the unit instead yields a section-less loose bag (exactly what `flowmap-lint` flags):

```
%% parent routing   WorkspaceArea
%% parent rendering WorkspaceArea
  subgraph routing ["Event routing"]
    blockManager("BlockManager") selectionManager("SelectionManager")
    dragManager("DragManager") layoutManager("LayoutManager")
  end
  subgraph rendering ["Rendering"]
    DragContainer["DragContainer"] ContentArea["ContentArea"]
  end
```

For a one-line caption that is not a container (a heading, not a box around members), use a `note` node (`id>"Event routing"]`) beside the cluster; prefer a `subgraph` when the caption names a set of nodes that belong together.

## 7. Conversion procedure (LLM reading a codebase)
1. **Units.** One node per meaningful unit (module, class, service, store, major function). ~5–40 at the top level, not one per line. Flag units you will review/redesign — those get decomposed (step 9); their inner nodes are off this budget.
2. **IDs.** Short, unique, prefer the symbol name.
3. **Shapes** (§3) from what each unit is.
4. **Root.** Pick the entry node; emit `%% root <id>`.
5. **Spine.** Solid arrows in real call order, acyclic. Apply both §4 patterns (DTO → dotted satellite; orchestrator → solid edge to each helper).
6. **Everything else dotted**, labelled with the relation verb.
7. **Frontmatter** per node (§5): name, desc, state, one interface per entry point with accepts/returns.
8. **Kind** every node — `%% kind <id> <kind>` is required, one per node (§3).
9. **Decompose flagged units** to function altitude (required for review): a. one child node per internal function / private step — not just external modules it calls; b. **section the children into purpose `subgraph`s by flow phase** (§6); each leaf lives *inside* its `subgraph` with NO `%% parent` of its own — **the section carries `%% parent <section> <unit>`**, and that one line places the whole drilled level inside the unit (do NOT write `%% parent <leaf> <unit>` on a bare leaf — that yields a section-less loose bag); c. wire the private call order with solid edges (§4); d. give each child its own frontmatter (§5) + kind; e. if the unit owns a state machine, add a node per state + transition edges.
10. **Groups / sections** — top level, group units that share an owner or bounded context; inside a decomposed unit, **always** section (9b). A decomposed unit with no sections is the file-mirror anti-pattern, and `flowmap-lint` fails it (LOOSE-BAG).
11. **Do not emit** `%% fm` or `%% edge` lines (Tidy positions; manual polish). Do not hand-set colours — kind drives the tint.
12. **Output** in the §2 order; emit only the `.mmd` text.
13. **Verify — done = `flowmap-lint <bundle>` exits 0** (no FLAT, no LOOSE-BAG). Grammar-valid is not enough: the common failure is a flat **file-mirror** (one node per file, nothing decomposed) that validates but cannot carry a review. `BUILD_FLOWMAP.md` has the full loop and a known-good reference to imitate.

## 8. Worked example

```
flowchart TD
%% root workspace
%% fm:meta workspace name=WorkspaceArea
%% fm:meta workspace desc=root canvas surface; routes pointer events
%% fm:meta workspace i0.name=onPointer
%% fm:meta workspace i0.accepts=PointerEvent
%% fm:meta workspace i0.returns=void
%% fm:meta drag name=DragManager
%% fm:meta drag state=active: DragItem | null
%% fm:meta drag i0.name=start
%% fm:meta drag i0.accepts=id: string
%% fm:meta drag i1.name=commit
%% fm:meta drag i1.returns=void
%% fm:meta store name=Store
%% fm:meta store state=nodes: Record<string, Node>
%% fm:meta store i0.name=patch
%% fm:meta store i0.accepts=p: Partial<State>
%% fm:meta store i0.returns=void
%% kind workspace component
%% kind drag class
%% kind isDragging function
%% kind store store
%% kind tiles component
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

Spine `workspace → drag → store` stacks from the root; `isDragging` parks by `drag`, `tiles` by `store`, each dotted link routed around the boxes. Every node carries a `%% kind`.