# Build Checklist

Generated from 2 accepted change(s).
Each item is "unbuilt" until the gate sees the symbol.
Track progress with:

```
npm run novakai:status -- --plan docs/novakai/plans/m10-approved/plan.json
```

---

- [ ] **[MODIFY]** `unfold__ufFitXform`  — The camera-refit decision is spread across unfold.ts: paint() bundles the 'toggleExpand' case with 'reveal'/'hide' and calls render(true), render() then runs reframeToFit() (L1557), which recomputes viewXform.k/x/y to fit ALL content — the same fit math is also copied verbatim in fitView() (L979). Nothing pure decides 'does THIS repaint move the camera', so 'a group toggle must not reframe' cannot be a behavioural claim, only a DOM side effect no acceptance case can reach.
- [ ] **[MODIFY]** `unfold__ufReframe`  — reframeToFit today recomputes the full fit transform and is fired by render() on every structural repaint — including a group toggle, whose paint() case (bundled with reveal/hide) calls render(true). That is the exact code path that throws a zoomed-in user back to a full-canvas zoom-out when they close a parent group. Its own fm description ('after every structural change the world transform-scales so all visible content fits') is now the drift to correct.
