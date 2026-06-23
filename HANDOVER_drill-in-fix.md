# Flowmap — Drill-in fix + handover

_Last updated: 2026-06-23._

> ## ✅ STATUS: ALL OF PART A IS ALREADY APPLIED TO DISK (2026-06-23)
> The six-file fix below was applied successfully via the Filesystem tools in the
> session that wrote this doc. **Do NOT re-apply it** — the `find` blocks will no
> longer match. Part A is kept as a record and rollback reference.
>
> **The only thing left for the next session / Claude Code:** run `npm run typecheck`,
> then `npm run dev`, and walk the Verification checklist. If typecheck fails, paste the
> first error.

---

## TL;DR

Drilling into a node is broken. The cause is a single design mistake: the drilled
container is drawn as a fake read-only `.level-root` element instead of a real node.
Every reported symptom traces to that one element. The fix is to delete the fake
header and render the container as a **real, interactive `.node`** (the level anchor),
auto-wire new children to it, and cap fit-zoom at 100%.

**Part A below is verified and safe for Claude Code to apply directly.** All find-targets
were checked against the current files on disk and match exactly. `pointer.ts` needs
**no** changes.

---

## Part 0 — Verdict on the previous instructions (were they wrong?)

No. The earlier patch set was correct. Every `find` block matches the current disk
state character-for-character, and the logic is sound. Claude Code likely rejected it
because it arrived fragmented across several chat "message blocks," not because of an
error. This document is the consolidated, ordered, single-source version.

The one point worth questioning — does `pointer.ts` need editing so the container is
draggable/selectable? — resolves to **no**. The pointer layer hit-tests DOM `.node`
elements via `closest('.node')` and reads `dataset.id`; selection and the inspector key
off `state.sel`. Once the container is rendered as a real `.node` with `dataset.id`, it
flows through all of that unchanged. Dragging it does not carry its children (the group-
drag-extras path only fires for `group`-shaped nodes), which is the intended behaviour.

---

## Symptom → cause → fix (all one root cause)

| # | Symptom | Cause | Fixed by |
|---|---------|-------|----------|
| 1 | Drilled node fills the screen | `zoomToFit` has no max zoom | cap fit at `z ≤ 1` (camera.ts) + fit to the container's real rect (state.ts) |
| 2 | No wire between parent and new child | container was not a wire endpoint; new child got no edge | `addNode` pushes a `container → child` edge; edge loop treats the container as in-level (nodes.ts, wires.ts) |
| 3 | Dragging a child drags the parent | header position derived from children's bounding box | container drawn at its own `x/y` as a real node (render.ts) |
| 4 | Parent not draggable | `.level-root` had `stopPropagation` + no `data-id` | real `.node` with `data-id` goes through the normal pointer path (render.ts) |
| 5 | Parent ports/hover dead | same as #4 | same as #4 |
| 6 | Inspector disabled for parent | `.level-root` had no `data-id`; never selectable | real `.node` is selectable → inspector renders it (render.ts) |
| 7 | Frontmatter chips dead | fm card lived inside the `stopPropagation` header | fm card now lives inside a real node (render.ts) |

---

## Part A — APPLIED (record + rollback reference)

**These six edits are already on disk.** Listed in the order they were applied. Files 1–4
are independently safe; files 5 and 6 (render.ts + wires.ts) are a coupled pair and both
landed together. Kept here so the next session can see exactly what changed and revert if
needed. **Do not re-run these find/replaces** — they will not match the current files.

Next action is verification only: `npm run typecheck` then `npm run dev`.

### File 1 — `src/core/camera.ts`  (symptom #1: stop fill-screen)

Find:
```ts
    const bw = (b.maxX - b.minX) + pad * 2, bh = (b.maxY - b.minY) + pad * 2;
    const z = Math.min(Z_MAX, Math.min(cw / bw, ch / bh));
```
Replace:
```ts
    const bw = (b.maxX - b.minX) + pad * 2, bh = (b.maxY - b.minY) + pad * 2;
    // fit only zooms OUT; never magnify a small level past 100%
    const z = Math.min(Z_MAX, 1, Math.min(cw / bw, ch / bh));
```

### File 2 — `src/core/state.ts`  (symptom #1: fit to the container's real rect)

Find:
```ts
/** Bounds the camera should fit at a level: children plus the root header. */
export function levelFitBounds(state: StateStore, container: string | null):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const b = levelBounds(state, container);
  const h = levelHeaderRect(state, container);
  if (!h) return b; // top level
  const hb = { minX: h.x, minY: h.y, maxX: h.x + h.w, maxY: h.y + h.h };
  if (!b) return hb;
  return {
    minX: Math.min(b.minX, hb.minX), minY: Math.min(b.minY, hb.minY),
    maxX: Math.max(b.maxX, hb.maxX), maxY: Math.max(b.maxY, hb.maxY),
  };
}
```
Replace:
```ts
/** Bounds the camera should fit at a level: children plus the container node. */
export function levelFitBounds(state: StateStore, container: string | null):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const b = levelBounds(state, container);
  if (!container || !state.nodes[container]) return b; // top level
  const c = state.nodes[container];
  const cb = { minX: c.x, minY: c.y, maxX: c.x + c.w, maxY: c.y + c.h };
  if (!b) return cb;
  return {
    minX: Math.min(b.minX, cb.minX), minY: Math.min(b.minY, cb.minY),
    maxX: Math.max(b.maxX, cb.maxX), maxY: Math.max(b.maxY, cb.maxY),
  };
}
```
Note: `levelHeaderRect` stays exported but becomes unused. `noUnusedLocals` does **not**
flag unused exports, so the build stays clean. (Optional cleanup later: delete
`levelHeaderRect` from state.ts once nothing imports it.)

### File 3 — `src/interaction/nodes.ts`  (symptom #2: place child under parent + auto-wire)

Find:
```ts
import { snapV } from '../core/state';
```
Replace:
```ts
import { snapV, childIdsOf } from '../core/state';
```

Find:
```ts
    const id = 'n' + (state.nid++);
    const d = DEFAULTS[shape] || DEFAULTS.rect;
    const { stage } = ctx.dom;
    if (wx == null || wy == null) {
      const c = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
      const off = (Object.keys(state.nodes).length % 5) * 12;
      wx = c.x - d.w / 2 + off;
      wy = c.y - d.h / 2 + off;
    }
    state.nodes[id] = {
      id, label: opts.label ?? d.label, shape,
      color: PALETTE[0],
      x: snapV(wx, ctx.snap), y: snapV(wy, ctx.snap), w: d.w, h: d.h,
      parent: ctx.view.container,
    };
    ctx.hooks.render(); ctx.hooks.sync();
```
Replace:
```ts
    const id = 'n' + (state.nid++);
    const d = DEFAULTS[shape] || DEFAULTS.rect;
    const { stage } = ctx.dom;
    const container = ctx.view.container;
    if (wx == null || wy == null) {
      if (container && state.nodes[container]) {
        // inside a drilled level: stack new nodes under the container node
        const c = state.nodes[container];
        const sibs = childIdsOf(state, container).length;
        wx = c.x + (sibs % 3) * (d.w + 32);
        wy = c.y + c.h + 90 + Math.floor(sibs / 3) * (d.h + 44);
      } else {
        const c = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
        const off = (Object.keys(state.nodes).length % 5) * 12;
        wx = c.x - d.w / 2 + off;
        wy = c.y - d.h / 2 + off;
      }
    }
    state.nodes[id] = {
      id, label: opts.label ?? d.label, shape,
      color: PALETTE[0],
      x: snapV(wx, ctx.snap), y: snapV(wy, ctx.snap), w: d.w, h: d.h,
      parent: container,
    };
    // auto-wire container -> new child so drill levels keep their graph.
    // skip group / note (structural, not interface nodes)
    if (container && state.nodes[container] && shape !== 'group' && shape !== 'note') {
      state.edges.push({
        id: 'e' + (state.eid++), from: container, to: id,
        label: '', style: 'solid', routing: ctx.prefs.route || 'straight',
      });
    }
    ctx.hooks.render(); ctx.hooks.sync();
```

### File 4 — `css/styles.css`  (accent ring on the container node)

Find:
```css
.level-root.shape-note { border-radius: 2px 2px 2px 13px; }
```
Replace:
```css
.level-root.shape-note { border-radius: 2px 2px 2px 13px; }

/* drilled container drawn as a real, interactive node (the level anchor):
   accent ring distinguishes it from its editable children */
.node.is-container {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent), 0 8px 26px rgba(0,0,0,.4);
  z-index: 3;
}
.node.is-container.selected {
  box-shadow: 0 0 0 1.5px var(--sel),
    0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent),
    0 10px 30px rgba(0,0,0,.4);
}
```

### File 5 — `src/render/render.ts`  (symptoms #3–#7: container becomes a real node)  ⚠ pair with File 6

Find:
```ts
import { childIdsOf, levelHeaderRect } from '../core/state';
```
Replace:
```ts
import { childIdsOf } from '../core/state';
```

Find:
```ts
    // only the nodes at the current drill level; groups first (z-order)
    const ids = childIdsOf(state, ctx.view.container).sort((a, b) =>
      (state.nodes[a].shape === 'group' ? 0 : 1) - (state.nodes[b].shape === 'group' ? 0 : 1));
```
Replace:
```ts
    // nodes at the current drill level; groups first (z-order). The drilled
    // container itself is appended last so it renders as a real, interactive
    // node (the level anchor) above its children.
    const container = ctx.view.container;
    const ids = childIdsOf(state, container).sort((a, b) =>
      (state.nodes[a].shape === 'group' ? 0 : 1) - (state.nodes[b].shape === 'group' ? 0 : 1));
    if (container && state.nodes[container]) ids.push(container);
```

Find:
```ts
      const isSel = state.sel.has(id);
      const svgShape = (n.shape === 'diamond' || n.shape === 'hex' || n.shape === 'cylinder');
```
Replace:
```ts
      const isSel = state.sel.has(id);
      const isContainer = id === container;
      const svgShape = (n.shape === 'diamond' || n.shape === 'hex' || n.shape === 'cylinder');
```

Find:
```ts
      el.className = 'node shape-' + n.shape + (svgShape ? ' svgshape' : '')
        + (isSel ? ' selected' : '') + (runtime.linkSrc === id ? ' linksrc' : '') + traceCls;
```
Replace:
```ts
      el.className = 'node shape-' + n.shape + (svgShape ? ' svgshape' : '')
        + (isSel ? ' selected' : '') + (runtime.linkSrc === id ? ' linksrc' : '')
        + (isContainer ? ' is-container' : '') + traceCls;
```

Find:
```ts
      // drill-in affordance: open this node's internal level. Skipped for
      // groups (in-level containers) and notes (annotations).
      if (n.shape !== 'group' && n.shape !== 'note') {
```
Replace:
```ts
      // drill-in affordance: open this node's internal level. Skipped for
      // groups, notes, and the container itself (you're already inside it).
      if (n.shape !== 'group' && n.shape !== 'note' && !isContainer) {
```

Delete the fake header block. Find:
```ts
    // read-only root header: the container you drilled into, shown above its
    // internals so the level always has visible context
    const headerRect = levelHeaderRect(state, ctx.view.container);
    if (headerRect && ctx.view.container) {
      const c = state.nodes[ctx.view.container];
      const hdr = document.createElement('div');
      hdr.className = 'level-root shape-' + c.shape;
      hdr.style.left = headerRect.x + 'px';
      hdr.style.top = headerRect.y + 'px';
      hdr.style.width = headerRect.w + 'px';
      hdr.style.height = headerRect.h + 'px';
      const hlab = document.createElement('span');
      hlab.className = 'label';
      hlab.textContent = c.label;
      hdr.appendChild(hlab);
      if (c.kind) {
        const kb = document.createElement('span');
        kb.className = 'kindbadge';
        kb.textContent = KIND_BADGE[c.kind];
        hdr.appendChild(kb);
      }
      hdr.onpointerdown = (ev) => ev.stopPropagation();
      if (c.fm && !isFrontmatterEmpty(c.fm)) hdr.appendChild(buildFmCard(c.fm, traced));
      world.appendChild(hdr);
    }
```
Replace:
```ts
    // (the drilled container is now rendered as a real node in the loop above)
```

Find:
```ts
      const showEmpty = !!ctx.view.container && ids.length === 0;
```
Replace:
```ts
      const showEmpty = !!container && childIdsOf(state, container).length === 0;
```

`KIND_BADGE`, `isFrontmatterEmpty`, and `buildFmCard` are still used by the main loop,
so their imports remain valid.

### File 6 — `src/render/wires.ts`  (symptom #2: real parent↔child edges)  ⚠ pair with File 5

Find:
```ts
import { portPos, bestSides, containerOf, childIdsOf, levelHeaderRect } from '../core/state';
```
Replace:
```ts
import { portPos, bestSides, containerOf, childIdsOf } from '../core/state';
```

Find:
```ts
    // node footprints (box + frontmatter card) used to keep labels off nodes
    const obstacles: Obstacle[] = [];
    for (const id of childIdsOf(state, container)) {
```
Replace:
```ts
    // ids visible at this level: children plus the drilled container itself
    const memberIds = container && state.nodes[container]
      ? [...childIdsOf(state, container), container]
      : childIdsOf(state, container);
    // node footprints (box + frontmatter card) used to keep labels off nodes
    const obstacles: Obstacle[] = [];
    for (const id of memberIds) {
```

Find:
```ts
    const headerRect = levelHeaderRect(state, container);
    const headerNode: DiagramNode | null =
      (headerRect && container && state.nodes[container])
        ? { ...state.nodes[container], x: headerRect.x, y: headerRect.y, w: headerRect.w, h: headerRect.h }
        : null;

    function drawEdge(e: DiagramEdge, a: DiagramNode, b: DiagramNode): void {
```
Replace:
```ts
    function drawEdge(e: DiagramEdge, a: DiagramNode, b: DiagramNode): void {
```

Find:
```ts
    for (const e of state.edges) {
      const a0 = state.nodes[e.from], b0 = state.nodes[e.to];
      if (!a0 || !b0) continue;
      // edges touching the container itself draw against the root header
      if (headerNode && container && (e.from === container || e.to === container)) {
        const cIsFrom = e.from === container;
        const otherId = cIsFrom ? e.to : e.from;
        const other = state.nodes[otherId];
        if (!other) continue;
        if (containerOf(state, otherId) === container) {
          drawEdge(e, cIsFrom ? headerNode : other, cIsFrom ? other : headerNode);
        } else {
          boundaryStub(e, headerNode, other, cIsFrom);
        }
        continue;
      }
      const aIn = containerOf(state, e.from) === container;
      const bIn = containerOf(state, e.to) === container;
      if (!aIn && !bIn) continue;
      if (aIn !== bIn) { boundaryStub(e, aIn ? a0 : b0, aIn ? b0 : a0, aIn); continue; }
      drawEdge(e, a0, b0);
    }
```
Replace:
```ts
    // a node is "at this level" if it's a child here OR it's the container
    // itself (now drawn as a real node, the level anchor)
    const inLevel = (id: string): boolean =>
      id === container || containerOf(state, id) === container;
    for (const e of state.edges) {
      const a0 = state.nodes[e.from], b0 = state.nodes[e.to];
      if (!a0 || !b0) continue;
      const aIn = inLevel(e.from), bIn = inLevel(e.to);
      if (!aIn && !bIn) continue;
      if (aIn !== bIn) { boundaryStub(e, aIn ? a0 : b0, aIn ? b0 : a0, aIn); continue; }
      drawEdge(e, a0, b0);
    }
```

After File 6, `DiagramNode` is still used by `drawEdge`/`boundaryStub` signatures, so its
import stays valid. `levelHeaderRect` is no longer imported here — correct.

---

## Part B — VERIFY after applying (minor; likely no code change)

These are not blockers. Apply Part A, run the app, and confirm. Each has a one-line remedy
if it bites.

1. **Select-all / marquee skip the container.** `selectAll` and marquee selection filter
   to `childIdsOf(level)`, which excludes the container. Clicking the container directly
   still selects it (verified path). If you want Ctrl+A and marquee to include the
   container too, add `id === container` to those level checks in `selection.ts` /
   `pointer.ts`. Low priority.

2. **Pre-existing children may sit far from the container.** Children added *before* this
   fix were placed at viewport-centre, not relative to the container, so on first drill-in
   they can appear far away (fit-zoom will still frame them, capped at 100%). New children
   land directly under the container. No code issue — a one-time layout artifact. Drag them
   into place or re-Tidy.

3. **Dead CSS.** `.level-root*` rules are now unused (no `.level-root` element is created).
   Harmless. Delete later if desired.

---

## Verification checklist (maps to the 7 symptoms)

```
npm run typecheck      # must pass; paste any error
npm run dev
```

Drill into a node with the ⤢ button, then check:

- [ ] #1 the level does not balloon to fill the screen (zoom ≤ 100%)
- [ ] #3 the container node sits at its own spot; dragging a child does NOT move it
- [ ] #4 the container node is draggable
- [ ] #5 hovering the container shows its ports; ports start a wire
- [ ] #2 dropping a new shape adds it under the container WITH a wire from the container
- [ ] #6 selecting the container fills the inspector (incl. the Parent dropdown)
- [ ] #7 clicking a type chip in the container's frontmatter card highlights that type
- [ ] back: the breadcrumb "Main" returns to the top level

If typecheck fails, paste the first error — most likely an unused-import line that needs
one of the import edits above that didn't land.

---

## Rollback

All changes are in git-tracked files. To revert just this work:
```
git diff                       # review
git checkout -- src/core/camera.ts src/core/state.ts src/interaction/nodes.ts \
                src/render/render.ts src/render/wires.ts css/styles.css
```

---

## Project state (for a fresh conversation)

**What Flowmap is:** a browser TS/Vite diagram tool with one model as source of truth;
a canvas and a Mermaid textarea both read/write it. Goal: use it as a two-way planning
tool with Claude — map a codebase to `.mmd`, get a build plan as `.mmd` to review, and
hand a `.mmd` back as a build contract.

**Done:**
- M1 semantic node kinds (`%% kind`, kind badge).
- M2 drill-in container model (`%% parent`, level filtering, breadcrumb, boundary stubs).
- M2.5 this fix — drill-in container rendered as a real node (Part A above).
- `src/core/validate.ts` exists (pure): `edgeIdentities`, `validateModel`,
  `semanticDiff`. **Not yet wired** to any UI button. (A "Check" toolbar button was
  planned: runs `validateModel` + `semanticDiff(model, fromMermaid(toMermaid(model)))`,
  reports to console + toast. Wiring it is the next small task.)

**Agreed roadmap (dependency order):**
1. **Tier 1 — trust the file.** Round-trip fidelity (semantic equality, NOT literal `===`;
   geometry + id counters are allowed to drift) + the Validate action + parser tolerance.
   Edge identity is a derived comparator (`from~to~style`), not a serializer change — the
   `.mmd` format stays clean. (validate.ts already implements this; wire the button next.)
2. **Tier 2 — contract semantics.** `status` field (`existing|planned|in-progress|done`,
   planned = dashed); per-node `spec`/`acceptance`; typed edges
   (`calls|imports|depends-on|data-flow`); treat typed `accepts`/`returns` as the
   enforceable core. Do this BEFORE writing prompt templates so the templates describe a
   format that already has these fields.
3. **Tier 3 — authoring kit.** `SYNTAX_README.md` (exists) as the single source; three
   prompt templates (codebase→`.mmd`, plan→`.mmd`, `.mmd`→code); a mapping table
   (node→file, kind→construct, interface→signature, edge→import/call, containment→folder);
   `FLOWMAP_SPEC.md` enforcement rules — but those rules are only binding when paired with
   a mechanical post-build diff (Tier 4), not as prose alone.
4. **Tier 4 — handoff loop.** "Copy `.mmd` + prompt wrapper" button; import a returned
   `.mmd`; diff incoming vs current; **merge-by-id** on reimport (so `status: planned→done`
   flows back). Depends on Tier 1 identity.
5. **Tier 5 — scale & review.** Nesting past 2 levels + per-level Tidy + collapse/expand;
   a repo→`.mmd` importer (walks imports/exports, `source` paths, folder auto-grouping);
   read-only review mode with version diff; in-app Claude generation (defer — last; the
   offline load-`.mmd` path proves the loop without key-management risk).

**Immediate next steps after this fix lands and verifies:**
1. Wire the "Check" toolbar button to `validate.ts` (small; index.html button + main.ts
   handler + console/toast report).
2. Add the `status` field end-to-end (type → config → mermaid `%% status` round-trip →
   inspector control → dashed styling for `planned`).
3. Then the three prompt templates + `FLOWMAP_SPEC.md`.

**Known environment issue:** the MCP Filesystem server on this machine times out / crashes
intermittently (4-minute hangs). If a write fails, retry once; if it keeps failing, hand the
exact patch blocks above to Claude Code instead.
