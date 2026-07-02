# M4 design contract — Read (unfold) becomes the primary surface

> Scope: the P1 promotion flip recorded in `SESSION_HANDOFF.md` §0a — "app opens into unfold;
> dense editor becomes the secondary surface" — executed through the standard loop
> (fragments → bundle → plan → red acceptance → code → green). Companion plan:
> `docs/flowmap/plans/m4-read-primary.plan.json`.

## 1. Purpose & scope

Today the app always boots into the dense editor; reading mode is an overlay behind `#readBtn`
(`main.ts` binds `$('readBtn').onclick = unfold.toggle`). M4 makes reading mode the surface the
app opens into, with the editor one keystroke away — and makes the boot decision a **pure,
acceptance-tested function**, not an inline conditional.

What already exists and is deliberately reused, not rebuilt:
- The unfold overlay covers the whole editor when shown (`.uf-overlay.show`, fixed inset:0,
  z-index 70); the editor keeps rendering underneath, so `close()` **is** the switch to the editor.
- `open()` is idempotent, needs only a populated `ctx.state`, and restores the per-diagram
  ViewSpec via `persistView('load')`.
- `#readBtn` → `unfold.toggle` is the editor→read affordance; `#ufClose` / Escape-chain is the
  read→editor affordance.

The only genuinely new facts: (a) a persisted **surface choice**, (b) a **boot-time decision**
that consumes it, (c) the map/plan/acceptance artifacts that make both verifiable.

## 2. The surface contract (design judgments, with rejected alternatives)

`AppSurface = 'read' | 'edit'` — a two-value union in `src/core/viewspec/viewspec.ts` (the view
contract module: pure, zero imports; M3 precedent). The stored value lives in localStorage under
`SURFACE_KEY = 'flowmap.surface.v1'` (a `config.ts` export next to `LS_KEY`/`PREF_KEY`, allowlisted
as a key string like both of them — not a map node).

**Judgment 1 — sticky surface, default read.** The boot surface is the last surface the user was
on; when nothing is stored (fresh profile, cleared storage, garbage) the default is **read**.
That is the P1 flip: read is primary because it is the *default*, not because the editor is
locked away. *Rejected: unconditional read on every boot* — punishes a user who deliberately
left off in the editor and makes the editor feel modal; *rejected: default edit with an opt-in*
— that is today's behavior, not a promotion.

**Judgment 2 — empty model always boots the editor.** Reading nothing is useless; with zero
nodes the reading view renders an empty stage. `resolveBootSurface` returns `'edit'` whenever
the model has no nodes, regardless of the stored value. (In practice `seed()` populates a demo
model on first run, so the empty branch guards cleared/corrupt autosave, not the common path.)

**Judgment 3 — normalization is strict, not clever.** `normalizeSurface` accepts exactly the two
canonical strings and maps everything else (case variants, numbers, objects, null) to `null` —
the same tolerant-boundary posture as `normalizeViewSpec`: garbage in storage can never crash or
mis-drive boot. *Rejected: case-insensitive coercion* — nothing ever writes non-canonical values,
so accepting them would only mask a corrupted store.

**Judgment 4 — the writes live in `open()`/`close()`, not `persistView`.** `open`/`close` are the
surface transitions themselves; `persistView('save'|'load')` is the ViewSpec trio and may
plausibly gain other call sites (e.g. beforeunload) where a surface write would be wrong.
*Rejected: wrapping the returned `UnfoldApi` in `main.ts`* — the Escape-chain and `#ufClose` call
the internal `close()` closure directly, so a wrapper would miss every in-overlay exit.

## 3. The pure functions (`src/core/viewspec/viewspec.ts`)

```ts
export type AppSurface = 'read' | 'edit';

export function normalizeSurface(raw: unknown): AppSurface | null {
  return raw === 'read' || raw === 'edit' ? raw : null;
}

export function resolveBootSurface(stored: unknown, hasNodes: boolean): AppSurface {
  if (!hasNodes) return 'edit';
  return normalizeSurface(stored) ?? 'read';
}
```

Both are exported, mapped (`viewspec__normalizeSurface`, `viewspec__resolveBootSurface`,
`viewspec__AppSurface`), and carry H1 pure acceptance cases in the plan — red before the code
exists. The decision table `resolveBootSurface` implements:

| stored | hasNodes | result | why |
|---|---|---|---|
| absent / garbage | true | `read` | the P1 default flip |
| `'edit'` | true | `edit` | sticky — user left in the editor |
| `'read'` | true | `read` | sticky |
| anything | false | `edit` | empty-model guard (Judgment 2) |

## 4. Surface writes (`src/panel/unfold.ts`)

- `open()` → `localStorage.setItem(SURFACE_KEY, 'read')`
- `close()` → `localStorage.setItem(SURFACE_KEY, 'edit')`

Both closures become mapped drilled nodes (`unfold__ufOpen`, `unfold__ufClose`, subgraph
`uf_session`) — the same closure-at-`file#symbol`, structure-only convention as
`ufSelectGroup`/`ufGroupConns`. `toggle` is untouched (it delegates to both).

## 5. Boot wiring (`src/main.ts`)

One addition at the end of the boot block (after the history baseline, so the editor underneath
is fully painted and `close()` reveals a ready editor):

```ts
if (resolveBootSurface(localStorage.getItem(SURFACE_KEY), state.nodes.length > 0) === 'read')
  unfold.open();
```

`#readBtn` keeps its binding; `tabs.showTab('insp')` and the rest of boot are untouched. The
conceptual map node `main__firstRender` gains the surface decision in its description.

## 6. Persistence & keys

| key | owner | content |
|---|---|---|
| `flowmap.surface.v1` | `config.ts#SURFACE_KEY` (allowlisted export) | `'read'` \| `'edit'` |
| `flowmap.autosave.v1` | existing | model (unchanged) |
| `unfold.view` | existing | per-diagram ViewSpec (unchanged) |

## 7. Roadmap predicate conversion (M4 `manual` → machine)

The single `manual` note in `docs/flowmap/mvp-roadmap.json` (M4) is replaced by:
design doc present (`file` + minBytes) · plan present (`file` + minBytes) ·
`resolveBootSurface(` wired in `src/main.ts` (`grep`) · `viewspec__resolveBootSurface` mapped in
the bundle (`grep`) · `SURFACE_KEY` written in `unfold.ts` (`grep`, count 2) · the plan's
acceptance suite green (`cmd`).

## 8. Build order in this PR (test-first)

1. This design doc (commit 1, doc-first per M3 precedent).
2. Fragments: 3 viewspec nodes + 2 unfold nodes + `main__firstRender` desc → `flowmap:bundle`
   (map-first, so every plan change is a `modify` against real ids — the add→modify lifecycle
   flip is avoided by construction).
3. Re-pass the quiz against the new bundle (the map bytes changed; the edit-gate demands a
   fresh pass before any `src/` edit).
4. Author the plan; `flowmap:plan-check` green; **`flowmap:acceptance` red** (7 cases, symbols
   absent).
5. Implement §3–§5 (+ `SURFACE_KEY` + allowlist line); acceptance green; property tests for the
   new functions join `tools/buildspec/viewspec.test.mjs`; `typecheck` + `spec:test:all` green.
6. Convert the roadmap predicates (§7); `flowmap:mvp` computes M4.
7. Runtime browser verification on the dev server (boot→read on fresh profile; ✕→editor;
   reload→editor sticky; Read→reload→read sticky; zero console errors).
8. `flowmap:ship` + handoff.

## 9. Out of scope / future (M5+)

- Restoring `sel`/`stage`/`query` from the stored ViewSpec on boot (M4 boots the surface; the
  per-diagram view restore stays exactly what `persistView('load')` already does).
- Any change to the editor surface, toolbar order, or the `#readBtn` affordance.
- Per-feature migration items (import, mmd sync, slice, plan view, diff workspace, export,
  frontmatter) — M5, one plan per feature.
- A visible "you are in read / edit" mode indicator beyond the existing dock — a design-review
  item for Chris, not silently invented here.
