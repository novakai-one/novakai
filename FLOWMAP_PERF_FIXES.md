# Flowmap performance fixes — Claude Code work order

Single source of truth for the perf work. Apply top to bottom. Do not skip the verification step at the end of each fix.

## What broke (from a real Performance profile)

```
click / drag / Tidy
      -->  hooks.reroute()  OR  autoLayout()
              -->  routeReferences()           (src/render/avoidRouter.ts)
                      -->  libavoid routeEdges() (wasm)
```

Profile of ONE pointerup: 12,724 ms total.

- ~7,274 ms (70%) = libavoid throwing C++ exceptions, each building a full JS stack trace.
- ~2,000 ms = real orthogonal routing.
- 1 ms = DOM rendering.

Two separate user-visible problems:

1. Freeze (1–12 s) on every drag-drop, resize, and Tidy.
2. Wires collide after Tidy.

Why the collisions: when libavoid throws hard, the `catch` clears the route cache. Then `wires.ts` draws every edge with the naive elbow path (`orthoPath`). Elbows do not avoid nodes. So a throwing router == colliding wires. Making libavoid succeed is what removes the collisions.

## Hard constraints — do not violate

- Do NOT change the `.mmd` syntax. Existing files must still load. None of these fixes touch the parser (`src/io/mermaid.ts`). Keep it that way.
- Keep obstacle-avoiding wires. Do NOT delete libavoid. Do NOT make elbows the permanent default.
- Tidy must produce non-colliding wires.

## Verification commands (run from repo root after each fix)

```bash
cd /Users/christopherdasca/Programming/flowmap
npx tsc --noEmit        # must print no errors
npm run build           # must succeed
```

Manual check after a successful build:
1. Load the app with the ~160-node file.
2. Drag a node. It must follow the cursor smoothly. Drop must not freeze.
3. Click Tidy. It must finish fast AND wires must not cross nodes.

---

## FIX 1 — kill the exception stack-trace cost  ✅ DONE

File: `src/render/avoidRouter.ts`. Already applied.

`routeReferences()` now wraps the wasm call:

```ts
const prevStackLimit = Error.stackTraceLimit;
Error.stackTraceLimit = 0;
try {
  await ensureRouter();
  const routes = await routeEdges(graph, { ...options });
  // ...cache routes...
} catch (err) {
  if (!scope) routeCache.clear();
  console.warn('[avoidRouter] routing failed; using fallback elbows', err);
} finally {
  Error.stackTraceLimit = prevStackLimit;
}
```

Verify it is present. Do not duplicate it. This removes the ~7,274 ms trace cost and changes no routing output.

Self-check: this fix is a measurement. After it, re-profile one drag-drop. If the 7 s exception band is gone, the hypothesis held. If it is NOT gone, stop and report — the trace is being captured some other way and FIX 2 matters more.

---

## FIX 2 (part A) — stop feeding libavoid bad rects  ✅ DONE

File: `src/render/avoidRouter.ts`. Already applied.

Added `sanitizeRect()`; every obstacle rect is forced finite, integer, min 1×1 before it reaches libavoid. Zero-area / NaN rects made the router throw. Verify `footprintRect` returns `sanitizeRect(...)`.

## FIX 2 (part B) — find and remove the real throw source  ⬜ TODO

Part A only removes degenerate rects. The bulk of throws is almost certainly geometry overlap. Confirm the cause before changing routing behaviour.

Step 1 — confirm the trigger with two re-profiles:

- Profile a drag-drop with frontmatter cards turned OFF (the `showFrontmatter` pref / the toggle in the panel).
- Profile a drag-drop with snap turned OFF.

Read the result:

- If throws drop sharply with cards OFF -> card-inflated footprints are overlapping neighbours. The inflation is in `footprintRect`: width becomes `max(box, card)` and the rect is shifted left by `(w - n.w)/2`. At density these inflated rects overlap.
- If throws drop sharply with snap OFF -> snap is producing coincident node coordinates, so obstacle rects sit exactly on top of each other.

Step 2 — fix only the confirmed cause. Pick the matching option:

Option A (cards are the cause): reduce the inflation. Change `SHAPE_BUFFER` from `14` toward `4`, and/or cap how far the card widens the obstacle so an inflated rect cannot extend more than a few px past the node box on each side. Re-test Tidy: wires must still avoid cards.

Option B (snap is the cause): before building obstacles, detect rects that are exactly coincident and nudge later duplicates by 1 px in x or y so libavoid sees distinct shapes. Do this in the obstacle build loop in `routeReferences`, on the `children` array, not on the model nodes (never mutate `state.nodes` here).

Step 3 — verify: profile Tidy. The exception band must be small. Tidy output must have no wire crossing a node.

Do NOT do both options blindly. Confirm the cause first, change one thing, re-profile.

---

## FIX 3 — route only the edges that moved (drag / resize)  ✅ DONE (applied directly)

Already applied to `context.ts`, `main.ts`, `pointer.ts`. Verify with `npx tsc --noEmit`. Do NOT re-apply — the find/replace anchors below will no longer match, which is expected. Kept for reference.

avoidRouter.ts is already ready for this. `routeReferences(ctx, { onlyEdgeIds })` routes a subset while still using every node as an obstacle, and keeps the cache for edges outside the set. You only need to wire callers.

Effect: dragging a node touching 3 edges routes 3 connectors, not 160.

Trade-off to accept: a scoped reroute does NOT re-route an edge that the moved node now blocks but is not connected to. That edge can overlap until the next Tidy. This is fine for live drag. Tidy stays full-graph, so Tidy has no collisions.

### 3.1 — add a hook to the contract

File: `src/core/context.ts`

Find:

```ts
  /** recompute obstacle-avoiding wire routes, then re-render */
  reroute: () => void;
  /** drill into a node: show only its internal level */
  enterContainer: (id: string) => void;
}
```

Replace with:

```ts
  /** recompute obstacle-avoiding wire routes, then re-render */
  reroute: () => void;
  /** re-route ONLY these edge ids (incremental), then re-render */
  rerouteEdges: (ids: Set<string>) => void;
  /** drill into a node: show only its internal level */
  enterContainer: (id: string) => void;
}
```

In the SAME file, find:

```ts
    reroute: () => notWired('reroute'),
    enterContainer: () => notWired('enterContainer'),
```

Replace with:

```ts
    reroute: () => notWired('reroute'),
    rerouteEdges: () => notWired('rerouteEdges'),
    enterContainer: () => notWired('enterContainer'),
```

### 3.2 — implement the hook at boot

File: `src/main.ts`

Find:

```ts
ctx.hooks.reroute = () => { void routeReferences(ctx).then(() => render.render()); };
```

Replace with:

```ts
ctx.hooks.reroute = () => { void routeReferences(ctx).then(() => render.render()); };
ctx.hooks.rerouteEdges = (ids) => { void routeReferences(ctx, { onlyEdgeIds: ids }).then(() => render.render()); };
```

(`routeReferences` is already imported in main.ts. Do not add a second import.)

### 3.3 — call the scoped hook from drag and resize

File: `src/interaction/pointer.ts`

Add this helper inside `initPointer`, right after the line `const { stage, world } = ctx.dom;` block where `state` is in scope. Put it just below `const linkBtn = document.getElementById('linkBtn') as HTMLElement;`:

```ts
  // edges with at least one endpoint in the moved-node set
  const incidentEdgeIds = (nodeIds: Set<string>): Set<string> => {
    const ids = new Set<string>();
    for (const e of state.edges) {
      if (nodeIds.has(e.from) || nodeIds.has(e.to)) ids.add(e.id);
    }
    return ids;
  };
```

In the SAME file, find the pointerup drag branch:

```ts
    if (mode.drag) {
      clearGuides();
      if (mode.drag.moved) { ctx.hooks.sync(); ctx.hooks.pushHistory(); ctx.hooks.reroute(); }
      mode.drag = null;
      return;
    }
```

Replace with:

```ts
    if (mode.drag) {
      clearGuides();
      if (mode.drag.moved) {
        const moved = new Set<string>([
          ...mode.drag.items.map((it) => it.id),
          ...mode.drag.groupExtras.map((it) => it.id),
        ]);
        ctx.hooks.sync(); ctx.hooks.pushHistory();
        ctx.hooks.rerouteEdges(incidentEdgeIds(moved));
      }
      mode.drag = null;
      return;
    }
```

In the SAME file, find the pointerup resize branch:

```ts
    if (mode.resize) { mode.resize = null; ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory(); ctx.hooks.reroute(); return; }
```

Replace with:

```ts
    if (mode.resize) {
      const moved = new Set<string>([mode.resize.id]);
      mode.resize = null;
      ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory();
      ctx.hooks.rerouteEdges(incidentEdgeIds(moved));
      return;
    }
```

Verify: `npx tsc --noEmit`, then drag a node and confirm drop is fast.

---

## FIX 7 — stop rebuilding all node DOM during drag  ✅ DONE (applied directly)

Already applied to `context.ts`, `main.ts`, `pointer.ts`. Verify with `npx tsc --noEmit`. Do NOT re-apply. Kept for reference.

Cause of mid-drag jank: every `pointermove` during a drag calls `ctx.hooks.render()`, which removes and rebuilds every node element (ports, shapes, cards, labels) for all ~160 nodes, many times per second.

The node `div` already contains its ports, handles, label, and frontmatter card. Moving the div's `left/top` moves all of them. Only the wires (in `#wires`) and edge labels (separate divs) do not follow. So: move the dragged node divs by style, redraw only the wires, skip the node rebuild.

During drag the moved node's cached route is invalidated by `routeFor` (endpoint moved), so wires draw as live elbows while dragging and snap back to avoided routes on drop (FIX 3). That is the intended behaviour.

### 7.1 — expose a wires-only redraw hook

File: `src/core/context.ts`

Find:

```ts
  /** re-route ONLY these edge ids (incremental), then re-render */
  rerouteEdges: (ids: Set<string>) => void;
```

Replace with:

```ts
  /** re-route ONLY these edge ids (incremental), then re-render */
  rerouteEdges: (ids: Set<string>) => void;
  /** redraw wires + edge labels only; does NOT rebuild node DOM */
  redrawWires: () => void;
```

In the SAME file, find:

```ts
    rerouteEdges: () => notWired('rerouteEdges'),
```

Replace with:

```ts
    rerouteEdges: () => notWired('rerouteEdges'),
    redrawWires: () => notWired('redrawWires'),
```

### 7.2 — wire it at boot

File: `src/main.ts`

Find:

```ts
ctx.hooks.render = render.render;
```

Replace with:

```ts
ctx.hooks.render = render.render;
ctx.hooks.redrawWires = wiresMod.drawWires;
```

(`wiresMod` already exists in main.ts: `const wiresMod = initWires(ctx);`.)

### 7.3 — use it in the drag pointermove

File: `src/interaction/pointer.ts`

Find the pointermove drag branch:

```ts
    if (mode.drag) {
      let dx = w.x - mode.drag.sx, dy = w.y - mode.drag.sy;
      mode.drag.moved = true;
      const prim = mode.drag.items[0];
      if (prim) {
        const nx = snapV(prim.ox + dx, ctx.snap), ny = snapV(prim.oy + dy, ctx.snap);
        dx = nx - prim.ox; dy = ny - prim.oy;
      }
      mode.drag.items.forEach((it) => { const n = state.nodes[it.id]; n.x = it.ox + dx; n.y = it.oy + dy; });
      mode.drag.groupExtras.forEach((it) => { const n = state.nodes[it.id]; n.x = it.ox + dx; n.y = it.oy + dy; });
      showAlignGuides();
      ctx.hooks.render();
      return;
    }
```

Replace with:

```ts
    if (mode.drag) {
      let dx = w.x - mode.drag.sx, dy = w.y - mode.drag.sy;
      mode.drag.moved = true;
      const prim = mode.drag.items[0];
      if (prim) {
        const nx = snapV(prim.ox + dx, ctx.snap), ny = snapV(prim.oy + dy, ctx.snap);
        dx = nx - prim.ox; dy = ny - prim.oy;
      }
      const movers = [...mode.drag.items, ...mode.drag.groupExtras];
      movers.forEach((it) => { const n = state.nodes[it.id]; n.x = it.ox + dx; n.y = it.oy + dy; });
      // move only the dragged node elements; do NOT rebuild all nodes
      for (const it of movers) {
        const el = world.querySelector<HTMLElement>(`.node[data-id="${it.id}"]`);
        if (el) { el.style.left = state.nodes[it.id].x + 'px'; el.style.top = state.nodes[it.id].y + 'px'; }
      }
      showAlignGuides();
      ctx.hooks.redrawWires(); // wires + labels follow without a node rebuild
      return;
    }
```

Leave the resize pointermove branch on `ctx.hooks.render()` for now (resize changes node size, which the cheap path does not handle). Resize drop is already scoped by FIX 3.

Verify: `npx tsc --noEmit`, build, then drag a node across the canvas. It must move smoothly with no per-frame stutter, and its wires must follow.

---

## FIX 7-optional — selection click paint (only if a plain select still feels slow)

Lower priority. Rendering is 1 ms in the profile, so this is unprofiled. Only do it if, after FIX 1/2/3/7, clicking a node to select it still feels laggy.

`src/interaction/selection.ts` calls `ctx.hooks.render()` on every select. A full select-paint must: toggle `.selected` on all nodes, toggle `.linksrc`, add/remove resize handles for the single-selected node, redraw wires (selection changes edge highlight), update the status text. `pointer.ts` already has `refreshSelClasses()` as a partial example. Do NOT ship a class-only toggle that forgets the resize handles — handles only exist for a single selected node and are created inside `render()` today. If you cannot cleanly extract handle creation, leave selection on full `render()`.

---

## FIX 4-optional — move routing into a Web Worker (only if Tidy still blocks)

Do this LAST, only if Tidy is still slow after FIX 1 + FIX 2. It does not make routing faster; it stops the main thread from freezing. After FIX 1+2 you would be relocating ~2 s, not ~12 s.

Plan:
1. Create `src/render/avoidWorker.ts` that imports `init` + `routeEdges` from `@mr_mint/elkjs-libavoid` and the wasm url, receives `{ graph, options }` via `postMessage`, and posts back the routes.
2. In `routeReferences`, post the graph to the worker instead of calling `routeEdges` on the main thread. While waiting, leave the cache as-is so `wires.ts` draws elbows (`routeFor` returns null). When the worker replies, fill the cache and call `render()` to upgrade the wires.

RISK: confirm `@mr_mint/elkjs-libavoid` actually initialises inside a Web Worker with Vite's wasm url handling. If it does not load in a worker, abandon FIX 4 and rely on FIX 1+2+3 for speed. Do not break collision avoidance to chase this.

---

## Order of work

DONE already (verify with `npx tsc --noEmit` + `npm run build`): FIX 1, FIX 2A, FIX 3, FIX 7.

Remaining:
1. Build + smoke test. Drag must be smooth, drop fast. If it compiles and runs, the freeze on drag and resize should be gone.
2. FIX 2B — re-profile Tidy, find the throw source, fix the ONE confirmed cause. Tidy is the only path still doing a full-graph route, so it is the remaining freeze AND the wire-collision fix.
3. Re-profile. Stop if drag-drop and Tidy are both fast and Tidy has no collisions.
4. Only if Tidy still blocks after 2B: FIX 4 worker. Only if a plain select still lags: FIX 7-optional.

After all changes: `npx tsc --noEmit` clean, `npm run build` clean, drag smooth, drop fast, Tidy fast with zero wire-node collisions, and an old `.mmd` file still loads unchanged.
