# Build plan — Flowmap as the contract loop

> The durable plan for turning Flowmap into the medium through which a human and an
> AI agent agree on *what gets implemented*, as an enforceable contract — not prose.
> Written to be returned to. Verified against running code on 2026-06-29.

## 0. The end-state product (precise)

The loop we are building, given that the agent has repo access:

1. **Human asks for a change** in English.
2. **Agent reads the fresh, gate-verified map.** `npm run flowmap:ship` regenerates
   `docs/flowmap/_bundle.mmd` from code and gate-checks it, so the base the agent
   authors against is always ≡ code. (Freshness is deterministic, not "trust the AI".)
3. **Agent produces two artifacts:**
   - an **updated `.mmd`** reflecting the repo today (the base), and
   - a **plan patch (`plan.json`)** — the proposed delta with *intent* and, for
     `add`/`modify` changes, the **proposed signature** (`fm` block).
   The agent dry-runs the patch (apply → `spec:stubs` → `tsc` → `gate`) and only
   surfaces patches that round-trip.
4. **Human reviews the patch in Flowmap** — an architectural diff overlaid on the real
   map, with *honest* impact analysis (transitive blast radius, real code bodies,
   before/after signatures) and dependency coherence.
5. **Human accepts/rejects per change.**
6. **Agent applies accepted changes to the spec** (the fragment `fm:meta`). The gate
   now flips to "unbuilt" — that red gate IS the build checklist. `spec-to-stubs`
   emits the stubs to fill.
7. **Code is written; gate goes green.** Green now *means* "built code matches the
   approved plan." Enforcement is deterministic — no AI in the loop.

The artifacts split by job: **`plan.json` = why + review UX**, **`.mmd` = what + enforcement.**

## 1. Current state (verified, not assumed)

Established by reading the code and *running* the pipeline:

- **The deterministic enforcement core is real and green at scale.**
  `npm run flowmap:gate` extracts **449 nodes** from the live ~7,600-line codebase and
  reports "✓ spec and code are in sync". `npm run spec:test` passes **7/7**, including
  "round-trip: generate → extract → gate is green, and a signature change fails it".
  `spec-to-stubs` generates stubs+contracts for **352 nodes**.
- **The planner exists** (`src/panel/planner.ts`) as a real review surface: loads a base
  `.mmd` + a `plan.json`, overlays status/intent on the real map, accept/reject with
  dependency-coherence, gated export.
- **`ctx.bodies`** is a `Map<id,{kind,body,...}>` loaded from `public/bodies.json`
  (300 real source bodies) — available to the planner.

### 1a. What the contract enforces TODAY (the key finding)

The generated `.contract.ts` files use `Parameters<typeof fn>`/`ReturnType<…>` — these
are **passive reflections, not assertions**. Type-node contracts are `keyof T` over an
**empty** emitted `interface`. So the *deterministic, discipline-free* guarantee is:

| Property | Frozen by the gate? |
|---|---|
| Node exists (unbuilt / unplanned) | ✅ |
| `kind`, drill-in `parent` | ✅ |
| Member **names** (class/function/hook/type) | ✅ |
| **Arity** (param count; class/function/hook only) | ✅ |
| Return **void-vs-value** | ✅ |
| Parameter **types** (e.g. string→number, same arity) | ❌ |
| Return **type** beyond void/value | ❌ |
| Type-node **field shape** | ❌ (interface emitted empty) |
| **Behaviour** | ❌ (Idea A) |

The README claim "if an argument type changes, the build fails" holds only at
stub-generation time / under the "never edit signatures" convention. The deterministic
contract is **structural**, not full-type or behavioural. Widening this is Phase 0.

### 1b. Known weaknesses in the review surface (author-flagged, `PLANNER_HANDOVER.md`)

1. **Blast radius is 1-hop** → highest-stakes changes look shallow → *false confidence*.
2. **Force-sim layout** overrides real coordinates → a "ball of nodes", not the familiar map.
3. **Shows prose `desc`, not real code** → can't judge a `modify`'s true impact.
4. **Structural ≠ behavioural** → shows *that* a node changes, not *what contract* changes.

### 1c. Architecture facts that shape the plan

- **Two implementations of one grammar**: `src/io/mermaid.ts`+`src/core/frontmatter.ts`
  (app) and `tools/buildspec/mmd-parse.mjs` (pipeline). A silent drift surface.
- **The spec is assembled from fragments** by `bundle.mjs`; the app loads the bundle
  read-only. There is **no writeback** from app/planner edits to fragment sources — so
  "apply approved change" must target the fragment/spec layer (the agent edits files),
  not an in-app mutation engine. Repo access makes this a normal file edit, not new software.
- The **plan schema has no field for a proposed signature** — `modify` changes carry
  intent prose only. To enforce types (not just structure), the schema must carry the
  proposed `fm`.

## 2. How repo access reshapes the work

Because the agent has repo access and the base map is deterministically regenerable:

- Base-map freshness — **dissolved** (`flowmap:ship`).
- "Does the patch target real ids" — **dissolved** (author reads the fresh map).
- The Phase-2 "verifier" — **de-risked from infrastructure to invocation** (the agent
  runs the existing `spec:stubs`/`tsc`/`gate` in its turn).
- The planner→spec "writeback engine" — **mostly dissolved** (agent edits the spec files).

The product's center of gravity is therefore: **Flowmap = the trustworthy review
surface** + the existing deterministic CLI + an agent protocol. The genuinely-hard
remaining work concentrates in **Phase 0 (freeze types)** and **Phase 1a (honest review)**,
with behaviour (Phase 3) as the research tail.

## 3. Phased plan

### Phase 0 — Harden the contract to match its promise *(buildable)*
- **0a.** Gate full parameter/return **types** for member-gated kinds, not just arity.
  `extract.mjs` already has the real type strings via ts-morph; compare normalized type
  strings in `diff-core.mjs`. Policy: gate only "clean" types; prose→`unknown` is a
  documented hole, never a silent pass.
- **0b.** Collapse the two grammars to one source of truth, or add a **conformance test**
  that runs one corpus through both parsers and asserts identical models.
- **0c.** Decide type-node field-shape gating (currently empty interfaces) — gate or
  explicitly scope out.

### Phase 1 — The trustworthy review-and-apply loop *(the app's core job)*
- **1a. Make the review honest** (author priority order):
  - **Transitive blast radius** (downstream cone with depth), not 1-hop.
  - **Surface real code** from `ctx.bodies` + before/after signature for `modify`.
  - **Layout fidelity** — render on real positions, not the force sim.
- **1b. Carry the proposed signature** in the plan schema (`fm` on add/modify), so an
  approved `modify` enforces a *new contract*, not just intent.
- **1c. Close the loop**: "apply accepted" produces the **approved spec `.mmd`** (base +
  adds/removes/fm-mutations) as a real downloadable artifact + a buildspec checklist,
  replacing the toast stub.

### Phase 2 — Authoring from intent (Idea B)
English → proposed `plan.json` (incl. `fm`) → dry-run verified → surfaced for review.
The agent (me) performs this with repo access; no in-app LLM needed.

### Phase 3 — Behaviour (Idea A) *(research)*
Upgrade `.contract.ts` from passive type-reflection to executable assertions an LLM drafts
from `desc`, the human approves once, CI enforces.

*(Phase 4 — Idea C advisory prose reviewer — additive, deferred.)*

## 4. This session's concrete deliverables

A coherent, tested vertical that makes the loop real and trustworthy:

- [x] This build-plan doc.
- [x] **Phase 1a**: transitive blast radius — `downstreamCone()` in `plan.ts`, wired into the
      planner panel. Verified live: `state` → "23 AFFECTED (17 direct, depth ≤ 3) · reaches 1 entry point".
- [x] **Phase 1a**: real code bodies + before/after signature in the modify panel. Verified live:
      `diffModels` shows BEFORE `(before, after) → MmdDiff` / AFTER `(before, after, opts: DiffOptions) → MmdDiff`,
      plus the real source body from `bodies.json`.
- [x] **Phase 1b**: plan schema carries proposed `fm` for add/modify (`PlanChange.fm`, normalized).
- [x] **Phase 1c**: real "apply accepted → approved spec `.mmd`" export (`applyPlan()` + `serializeSpec()`),
      replacing the toast stub. Verified live: export reports "1 new + 1 modified"; the produced spec
      was run through `spec:stubs` (emits `interface DiffOptions` + the 3-arg `diffModels`) and the gate
      (reports `unbuilt: diff__DiffOptions` + `arity mismatch: diffModels spec=3 code=2` — the build checklist).
- [x] **Phase 0a**: gate parameter/return **types** (extract carries real types; `skeleton.normType`
      canonicalizes unions + drops optionality; `diff-core` compares clean types, summarizes prose holes).
      Proven on the real repo: a `before: DiffInput → string` mutation fails the gate; reverting restores sync.
      27 prose types reported as a documented hole (not silent).
- [ ] **Phase 1a (stretch)**: layout fidelity (real positions) — NOT done. The planner still uses the
      force-sim layout (`forceLayout`). Author flagged this as priority #3 (after blast radius + bodies,
      both now done). Next session.
- [x] Tests green (`spec:test` 7/7, `tsc --noEmit` clean, real `flowmap:gate` in sync) + **Chrome manual
      test** of the full loop (loaded `_bundle.mmd` base + plans, clicked through review/accept/export
      with the mouse — not injected JS).

## 7b. Known gaps / next session

- **Layout fidelity** (Phase 1a stretch above): replace `forceLayout` with real `ctx.state` positions.
- **The two-grammar drift surface** (Phase 0b): `io/mermaid.ts`+`frontmatter.ts` vs `mmd-parse.mjs` still
  independent. Add a conformance test (or unify). The in-app `serializeSpec` and the pipeline parser agree
  in practice (verified via the export→stubs→gate run) but this is untested by CI.
- **Type-node field gating** (Phase 0c): `state` fields now flow into emitted `interface` bodies via
  `spec-to-stubs` (e.g. `DiffOptions { byLabel: boolean }`), but the gate's type comparison still only
  covers member-gated arity-kinds, not interface field shapes. Decide whether to gate fields.
- **Behaviour (Idea A)** and **authoring from English (Idea B, agent-side)**: Phases 2–3, not started.
- **Download in sandboxed automation**: the in-app export Blob download isn't retrievable under the
  automation browser; verified the artifact deterministically at the file level instead.

## 5. Assumptions made (fine-tune later)

- Review-then-apply with the agent editing spec files is the workflow (not an in-app
  mutation engine).
- "Curated diff proposal" is the planner→spec handoff style (human stays in the loop).
- Layout fidelity uses whatever positions `ctx.state` holds (grid or Tidy'd), matching the
  main canvas the user already arranged — not a new layout engine.
- Type gating covers "clean" TS types; prose types remain `unknown` and are reported, not
  silently passed.

## 6. How to verify (commands)

```
npm run spec:test          # 7-test pipeline suite (parser, extract, gate, round-trip)
npm run typecheck          # tsc --noEmit over the app
npm run flowmap:gate       # extract real code → diff vs committed spec (must be green)
npm run dev                # Vite dev server for the Chrome manual test
```
Manual test: open the app → **Plan** button → Load `docs/flowmap/_bundle.mmd` as base →
Load `public/plan.json` → click nodes/diff lines, verify blast radius is transitive and
shows real code → accept/reject → Export → confirm the approved spec artifact.
