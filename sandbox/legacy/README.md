# legacy — the frozen spatial editor (pre-unfold direction)

A **built snapshot** of the original novakai editor UI, preserved the day the project
committed to the unfold direction. It is compiled output — it cannot drift when `src/`
changes, and deleting this folder affects nothing.

- Built from commit: `bc95bea` (main, 2026-07-02) — also tagged `legacy-editor`
- Rebuild the same thing any time: `git checkout legacy-editor && npm run build`

## Open it

```
npm run dev            # then http://localhost:5173/sandbox/legacy/  (port may differ)
```

It is fully self-contained (its own JS/CSS/wasm under `assets/`, plus the bodies.json
and plan.json that shipped with it), so it keeps working regardless of what happens to
the live app at `/`.
