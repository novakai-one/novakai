# Wire-reroute fix — QA + follow-ups (Claude Code task)

Single self-contained work order. Repo: `flowmap`. The fix is implemented and
builds; this covers verification I could not run (no browser bridge in the
authoring session) plus optional cleanups.

---

## 0. What already shipped — DO NOT undo

Commit `282663c` on `main` (NOT pushed). `tsc --noEmit && vite build` both green.

**Bug:** wires stayed routed *through* nodes that had moved into their path
(false visual connections), persisting after the operation finished.

**Root cause:** route-cache validity keyed only on the two endpoint boxes
(`basisOf`), so a third node moving into a settled edge never invalidated it.
And a full reroute only ran on a handful of explicit call sites.

**Fix (two halves):**
- **A — global obstacle signature.** `obstacleSignature(ctx)` in `avoidRouter.ts`
  fingerprints *every* non-group node footprint (box + measured frontmatter
  card) + the frontmatter toggle. Stored per `CachedRoute` as `sig`. `routeFor()`
  now takes the current sig and drops any route whose sig differs. So a stale
  avoided route is **never drawn** — worst case is a temporary elbow (the
  correctness floor: an elbow is honest, a wire through an unrelated node lies).
- **B — centralized trigger.** `ensureRoutes(ctx)` reroutes whenever the sig
  changed since the last route. Called from `render()` and from the post-paint
  measure pass (`measureCards`). Deduped on the sig and `requestAnimationFrame`-
  coalesced, so it is loop-safe and does not spam the worker. This removes the
  need for each mutation path to remember to reroute.

Files touched: `src/render/avoidRouter.ts`, `src/render/wires.ts`,
`src/render/render.ts`.

**Hard constraints:** do NOT reintroduce `basisOf`/endpoint-only invalidation,
and do NOT remove `ensureRoutes` — either reopens the bug. Keep the elbow
fallback (it is the anti-flicker / anti-lie behaviour).

---

## 1. Browser geometric QA  — PRIMARY, NOT YET RUN

`npm run dev`, open the local URL. For each scenario: do the action, let it
settle (~0.3s for the worker reply), then confirm **no wire path crosses a node
it is not connected to.**

Scenarios (each must pass):
1. Drag a node so it sits on the straight line between two *other* connected
   nodes. Wire must bend around it.
2. Toggle frontmatter on (style panel) so cards appear/grow. Wires must route
   around the new, larger card footprints.
3. Resize a node into a nearby wire's path.
4. Arrow-key nudge a node into a wire's path (note: 350 ms debounce before the
   reroute — wait for it).
5. Inspector X / Y / W / H numeric edits.
6. Undo, then redo, a node move.
7. Tidy (auto-layout).
8. Mermaid import and clipboard paste of a subgraph.

**Important QA caveat:** a transient crossing *during* an active drag is
expected and not a bug — only edges incident to the dragged node follow per
frame; the full reroute runs on drop. Judge the **settled** state, not mid-drag.

Optional automated check (paste in console). It flags any wire segment that
passes through a non-endpoint node box. Endpoint nodes are excluded by the
heuristic "a node whose box contains the path's first or last point". It reads
node boxes from the model, so first expose the context once:
`window.__ctx = ctx;` in `main.ts` after boot (remove after), or adapt to
however the app exposes state.

```js
// returns [] on pass, else [{edge, throughNode}]
(() => {
  const ctx = window.__ctx; if (!ctx) return 'expose window.__ctx first';
  const S = ctx.state, show = ctx.prefs.showFrontmatter;
  const fp = id => { const n=S.nodes[id]; const m=show?S.measured.get(id):null;
    if(!m) return {x:n.x,y:n.y,w:n.w,h:n.h};
    const w=Math.max(n.w,m.cardW); return {x:n.x-(w-n.w)/2,y:n.y,w,h:n.h+6+m.cardH}; };
  const boxes = Object.keys(S.nodes).filter(id=>S.nodes[id].shape!=='group').map(id=>({id,...fp(id)}));
  const inBox=(p,b)=>p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;
  const segHitsBox=(p,q,b)=>{ // sample the segment; wires are axis-aligned so this is exact enough
    const steps=Math.max(2,Math.ceil((Math.abs(q.x-p.x)+Math.abs(q.y-p.y))/4));
    for(let i=0;i<=steps;i++){const t=i/steps;if(inBox({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t},b))return true;}return false;};
  const out=[];
  document.querySelectorAll('#wires path[data-eid]').forEach(path=>{
    const nums=(path.getAttribute('d').match(/-?\d+(\.\d+)?/g)||[]).map(Number);
    const pts=[];for(let i=0;i+1<nums.length;i+=2)pts.push({x:nums[i],y:nums[i+1]});
    if(pts.length<2)return;
    const ends=boxes.filter(b=>inBox(pts[0],b)||inBox(pts[pts.length-1],b)).map(b=>b.id);
    for(let i=0;i+1<pts.length;i++)for(const b of boxes){
      if(ends.includes(b.id))continue;
      if(segHitsBox(pts[i],pts[i+1],b))out.push({edge:path.dataset.eid,throughNode:b.id});}
  });
  return out.length?out:'PASS: no wire crosses a non-endpoint node';
})();
```

Run it after each scenario. Non-empty result = a real crossing to investigate.

---

## 2. Residual obstacle paths that skip `render()`

`ensureRoutes` only fires from `render()` and `measureCards`. A path that
changes obstacle geometry but never calls `ctx.hooks.render()` will NOT reroute.
Two suspects from the prior root-cause analyses — confirm and patch:

- **Frontmatter WIDTH control** in `src/panel/style-controls.ts` (~the control
  near the frontmatter toggle). If it changes card width via a CSS var only and
  does not call `render()`, the measure pass never re-runs → no reroute.
  Fix: have it call `ctx.hooks.render()` after the change (render → measure →
  `ensureRoutes` then covers it). The frontmatter *toggle* (`onchange` at
  ~line 47) already calls `render()` and is fine.
- **Font change** in `src/panel/theming.ts`. The prior analysis claimed it does
  not call `render()`. If changing the font resizes cards, same gap. Fix: call
  `ctx.hooks.render()` on font change. `applyTheme` (~line 34) already renders.

How: grep both files for the width/font handlers, check each calls
`ctx.hooks.render()` (or `ctx.hooks.reroute()`), add it where a card/node
geometry change currently repaints via CSS only. Re-run the Task 1 check for
scenario 2 variants (width slider, font swap).

---

## 3. OPTIONAL — prune now-redundant explicit reroutes

These call sites are superseded by `render()` → `ensureRoutes` (a scoped reroute
is dropped when the full reroute bumps `routeGen`), so they are harmless but
redundant. Remove only if you want a leaner call graph:
- `src/interaction/pointer.ts` ~389 / ~399 — `rerouteEdges` on drag/resize end.
  KEEP if you want incident edges to settle one frame sooner; else removable.
- `src/panel/inspector.ts` ~200 — `reroute` on edge reset.
- `src/interaction/keyboard.ts` ~91 — `reroute` on nudge.
- `src/io/layout.ts` ~464 — `routeReferences` after Tidy. Only remove if you
  confirm Tidy triggers a `render()` afterwards (it should).
Low priority; the fix is correct with them left in place.

---

## 4. Housekeeping — leftover worktrees (needs a human decision)

Two Claude Code worktrees exist under `.claude/worktrees/`:
`vibrant-boyd-0aa482` and `vigilant-pike-7136af`.

`vigilant-pike-7136af` has **7 uncommitted edits** (`css/styles.css`,
`index.html`, `src/core/config.ts`, `src/core/persistence.ts`,
`src/interaction/nodes.ts`, `src/io/layout.ts`, `src/render/wires.ts`).
Uncommitted = unrecoverable. **Do NOT `git worktree remove` either** until a
human inspects (`cd` in, `git diff`, `git stash list`) and salvages or
explicitly discards. Some edits are in the wire area and may overlap this fix.

---

## Notes
- `282663c` is on `main`, NOT pushed. Follow the repo's no-push convention.
- A `vite` dev server was left running on port **5175** (5173/5174 were in use,
  likely by the worktrees). Kill it if not needed.
