# contract-slice arc — end-to-end build plan (phases 1→5) — REV 2

**Rev 2 changelog (0-context challenger incorporated):** dropped `verify-strict-lens` as a
standalone change (redundant vs source — folded into acceptance-path); moved the "spawn a real
builder" leg out of the deterministic `orchestrate.mjs` into the agent-protocol layer; added the
**slice-completeness gate** (the missing keystone); added a walking-skeleton acceptance for the
loop-closing leg; added a writeback/re-sync step for wave output; named the `.mjs` dogfooding hole
honestly; deferred `onboard-slice`; added test-registration + CI + builder-safety to DoD.

**Status:** buildable. A next agent runs `npm run novakai:onboard`, passes `npm run novakai:quiz`,
then executes in the order below. Every work item carries target, the exact edit locus from source,
a runnable acceptance, and its dependency.

**Thesis (why this arc):** the sliced `.mmd` sub-map + bodies cone IS the agent→subagent contract —
**and it is only a contract if it is provably *sufficient*, not merely smaller.** Today the
plan/review/approve half of the loop is verifiable; the *implement* handoff still hands a subagent
the whole repo. This arc makes the handoff a scoped, **completeness-gated**, executable contract so
subagents can be driven at wave parallelism with confidence (CLAUDE.md durable goal).

**Source plan:** `docs/novakai/plans/contract-slice.plan.json` (idea-stage). Coherence re-check:
`npm run novakai:plan-check -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd`

---

## Load-bearing facts (verified from source; do NOT re-derive)

- **Targets are `.mjs`** under `tools/novakai/` + `tools/buildspec/` → INVISIBLE to the ts-morph
  `src` gate (`allowJs:false`). `novakai:status`/`gate` report these BUILT meaning only "map node
  exists", NOT implemented. **Real verification = `node --test <file>.test.mjs` + `novakai:replay`.**
- **`novakai:contract`** (`contract.mjs`): `--change <id>` REQUIRED, `--plan`, `--map`, `--json`.
  Packet → **stdout** with `--json` (:145-147); no `--out`. Today packet = pure metadata pointer,
  **no sub-map/bodies** (:123-143). Blast radius already computed via `downstreamCone` over
  `mapModel.edges` **which already includes the 244 function-level edges** (:78-116).
- **Slice funcs DORMANT — built, tested, unwired:** `sliceModel` (`tools/buildspec/core/
  slice-core.mjs:72`), `filterBodies` (`:127`); only importer is `slice-core.test.mjs:13`.
  `sliceModel` is a **blind edge-walk — it asserts smaller, never *sufficient*** (this is G1's gap).
  **Direction matters (approver SF-1):** `sliceModel({down:true})` = descendants = what the target
  **CALLS** (its dependency cone); `{up:true}` = ancestors = **consumers** = `downstreamCone`'s blast
  radius. A *sufficient* contract needs the **dependency cone (down)**, NOT the blast radius (up).
  `filterBodies` returns a **`Map`** — convert Map→object before `canonicalJSON`, else it serializes
  as `{}`.
- **`novakai:verify-change`** (`verify-change.mjs`): `--change` REQUIRED, `--plan/--map/--tsconfig/
  --json/--strict`. Verdict `PASS|PASS_UNPROVEN|FAIL` folded at **:92-104** — **agnostic to how a
  case resolved** (`PASS` iff `structuralOk && all cases green`; there is NO lens-vs-src branch).
  Structural verdict from a `status.mjs` subprocess (`cwd:ROOT`, :68-71); behavioural in-process
  `runAcceptance()` (:35,84). `verdictHash=hashOf(body)` byte-stable.
  → **m10 was PASS_UNPROVEN because the case could not RUN (`behaviouralOk===null`), not because a
  lens was distrusted.** Fix the resolution (acceptance-path) and verify-change already returns PASS.
- **`acceptance.mjs:93`**: `const src = srcMap[ref] || (acc.path ? {...} : null)` — `%% src` wins
  over `acc.path`; the pure-lens hatch is dead. THIS is the acceptance-path bug.
- **`novakai:orchestrate`** (`orchestrate.mjs`): a plain node script **bound to byte-deterministic
  stdout by `novakai:replay`** (docstring :30-33) — it has **no access to the Agent tool**. Today:
  `git worktree add --detach <wt> HEAD` (:95), drop `CONTRACT.json` (:97), verdict computed in the
  **MAIN** repo (`cwd:ROOT`, :142-146) because the worktree lacks `node_modules` (WHY :21-28).
- **`node_modules`**: gitignored, 119M, no pre/postinstall/native build → **symlink** suffices, no
  `npm ci`. Precedent `loop-e2e.test.mjs:235`. **Safety note (G6):** symlink points at the MAIN
  repo's deps and the worktree shares `.git` — a mutating builder can write through it; assert main
  clean after any real builder runs.
- **m10 wasm FAIL:** `src/panel/unfold/unfold.ts` imports `libavoid.wasm?url` (Node can't import) →
  acceptance can't prove that module. Escape hatch = point `acc.path` at a pure symbol.
- **Real change ids** (`public/plan.json`): `frame-transform` (PASS, 3 cases), `fit-clamp`,
  `render-lod` (both PASS_UNPROVEN).
- **`.mjs` DOGFOODING HOLE (G4 — stated honestly):** because these targets carry no ts-morph-visible
  `fm`+`acceptance`, `contract.mjs` emits `signature:null, acceptance:null,
  hasBehaviouralContract:false` and `verify-change` returns `PASS_UNPROVEN` for EVERY change in this
  arc. **novakai cannot yet drive its own `.mjs` tooling changes through its own contract.** This
  arc's verification therefore runs through `node --test` + `replay` — a DIFFERENT harness than the
  one it builds. This is a KNOWN, NAMED hole, not papered over. `acceptance-path` is the plausible
  eventual fix (an `acc.path` lens pointing at a `node --test`/pure symbol would let a `.mjs` change
  be behaviourally proven through the contract) — call that out as the follow-on, do not silently
  rely on `status`.

## PROBE RESULT — phase-4 plumbing already de-risked this session
`orchestrate-exec`'s only genuine unknown (can `verify-change` run INSIDE a worktree?) is PROVEN
YES on a throwaway `probe/orchestrate-spike` worktree (torn down; main untouched):
- verify-change from `cwd=<wt>` → ROOT resolves to worktree (`ROOT=join(HERE,'..','..','..')`,
  :39-40), verdict **byte-identical** to main: `27fdb27224a3e3280b01fc818fe8ea5c91352628dec82a0320e679e312913553` (`frame-transform`).
- Negative control: remove symlink → `ERR_MODULE_NOT_FOUND: ts-morph`, exit 2. Deps genuinely
  worktree-local.
- **The deterministic parts of orchestrate-exec are wiring, not research.** What was NOT probed: a
  real builder producing a real change (that's the agent-layer leg + walking skeleton, G2 below).

---

## Build order (revised topology)

```
acceptance-path ──(absorbs verify-strict-lens check)
fn-edges-derive ──> fn-edges-verify
                └──> slice-completeness-gate ──┐
contract-slice ───────────────────────────────┴──> orchestrate-exec (det. parts)
                                                        └──> builder-spawn + walking skeleton (agent layer)
                                                                └──> writeback/re-sync of wave output
cli-door (independent)         onboard-slice (DEFERRED, out of this arc)
```
**Sequence:** acceptance-path → fn-edges-derive → fn-edges-verify → contract-slice →
slice-completeness-gate → orchestrate-exec(det) → builder-spawn walking skeleton → writeback →
cli-door.

---

## WI-1 · acceptance-path  [medium · deps: none · target: novakaiBuildspec__acceptance]
**Problem:** `acceptance.mjs:93` lets `%% src` win over `acc.path`, so the pure-lens hatch is dead;
wasm/DOM (m10) can't be behaviourally proven.
**Change:** honor `acc.path`+`acc.symbol` FIRST at `acceptance.mjs:93` before the map `%% src`
fallback.
**Absorbs verify-strict-lens (C1):** after this lands, run `verify-change --strict` on the m10/lens
fixture and CONFIRM it returns PASS (verify-change is already lens-agnostic at :92-104). Only if a
residual cap is observed, make the 1-line verdict tweak — do NOT build a standalone change on spec.
**Acceptance (runnable):** fixture change with `acc.path` at a pure symbol → `node --test
tools/buildspec/.../acceptance.test.mjs` green; the m10 case reaches PASS via the lens; `node
tools/novakai/contract/verify-change.mjs --change <lens-fixture> --strict --json` → PASS, exit 0.
**Verify:** `node --test` + `novakai:replay`.

## WI-2 · fn-edges-derive  [medium · deps: none · target: novakaiBuildspec__extract]
**Problem:** the 244 function edges are hand-authored; no derived intra-body call graph → G1 has no
ground truth.
**Change:** in the extractor (`novakaiBuildspec__extract`; find via `_tooling.mmd` `%% src`), walk
each function body with ts-morph, collect callee symbols, add `calls[]` per node to
`public/bodies.json` + emit a derived function-edge artifact.
**Acceptance (runnable):** `node --test <extract>.test.mjs` asserts a known function's `calls[]`
includes an expected callee; `bodies.json` gains `calls[]`. `npm run novakai:ship` regenerates clean.

## WI-3 · fn-edges-verify  [low · deps: WI-2 · target: novakaiIntegrity__edges]
**Change:** triage the 244 hand-authored edges vs derived `calls[]`; report **phantom** + **missing**.
**Report-only, no hard gate** until triaged clean.
**Acceptance:** `node --test <edges>.test.mjs` asserts the report CONTENT (a known phantom or missing
edge appears), not merely exit 0 — a no-op checker also exits 0, so assert on the triage output.

## WI-4 · contract-slice  [medium · deps: none for basic packet (today's edges) · target: novakaiContractSpine__contract]
**Change:** wire `sliceModel` (`slice-core.mjs:72`) + `filterBodies` (`:127`) into `contract.mjs`.
**Slice the DEPENDENCY cone, not the blast radius (approver SF-1):** seed `sliceModel` from the
change target with **`{down:true}`** (the target's callees / what it uses) so the packet is
*sufficient* by construction; the existing `downstreamCone` blastRadius (:78-116, = consumers/up)
stays as advisory context, NOT the slice basis. `contract.mjs` does NOT read `public/bodies.json`
today — **WI-4 must add that read**. Slice `_bundle.mmd` → sub-map and `bodies.json` → dependency
cone; **convert `filterBodies`' `Map` → object**; ADD `subMap` + `slicedBodies` to the `--json`
packet. Do NOT mutate existing metadata fields (the hash test `contract.test.mjs:39-41` recomputes
`hashOf(body)`, so added fields are fine as long as existing ones are untouched).
**Acceptance (runnable):** `node tools/novakai/contract/contract.mjs --change frame-transform --json`
→ packet `subMap` contains the target node, `slicedBodies` ⊂ bodies.json and contains the target's
callees, size << full. `node --test tools/novakai/contract/contract.test.mjs`.

## WI-5 · slice-completeness-gate  [HIGH VALUE — the keystone · deps: WI-2 + WI-4 · target: novakaiContractSpine__contract]
**Problem (G1):** a smaller packet is not a *sufficient* one. Without this, "100% confidence" is
unfounded — a subagent could need a symbol outside the cone.
**Change:** in `contract.mjs`, after slicing, ASSERT every symbol in the target's `calls[]` (from
WI-2) is present in `slicedBodies`/`subMap` OR explicitly listed as an out-of-scope dependency.
Fail the packet (non-zero) if a called symbol is silently missing. This is the A1 completeness gate,
projected onto the slice.
**Acceptance (runnable):** `node --test` with (a) a change whose cone is complete → gate passes;
(b) a synthetic change whose `calls[]` references an excluded symbol → gate FAILS with that symbol
named. This test is the proof that the packet-as-contract claim holds.

## WI-6 · orchestrate-exec (deterministic parts)  [low after probe · deps: WI-4, WI-5 · target: novakaiContractSpine__orchestrate]
**Change (stays in the replay-deterministic `.mjs`):**
1. After `git worktree add` (:95): `symlinkSync(join(ROOT,'node_modules'), join(wt,'node_modules'),
   'dir')`. PROVEN sufficient.
2. Route the verify-change call to `cwd:<wt>` using the worktree's own script copy (:142-146) so
   ROOT resolves to the worktree. PROVEN byte-identical.
3. Drop the sliced packet (WI-4) as CONTRACT.json instead of the metadata-only one.
4. Aggregate per-change verdicts via existing `waves.mjs` (G5, built).
**Acceptance (runnable):** `node orchestrate.mjs <args> --keep-worktrees` provisions a worktree WITH
node_modules, verifies INSIDE it, returns a verdict matching a main baseline for an unchanged change,
and a divergent verdict for a worktree-edited change. `node --test orchestrate.test.mjs` +
`novakai:replay`. Regression: re-run the probe pattern (symlink→PASS identical; no symlink→exit 2).

## WI-7 · builder-spawn walking skeleton  [the loop-closing proof · deps: WI-6 + WI-9-setup · AGENT-PROTOCOL layer, NOT orchestrate.mjs (C3)]
**Problem (G2):** the headline "closes the loop" is the one thing never tested; and per C3 the
builder cannot live in the deterministic node script.
**Change:** document + execute an agent-protocol step: the lead Claude reads the sliced packet, spawns
ONE Sonnet builder into a worktree given ONLY the packet (no repo browse), the builder implements one
real change, then the deterministic `verify-change` (WI-6) runs inside the worktree.
**Subject = cli-door, and it MUST be built here, not by hand (approver SF-3):** split WI-9 into
**setup** (author the `cli-door` change ENTRY — add the node to `public/plan.json` + its target to
the understand fragment so `contract.mjs` can emit its packet; done BEFORE WI-7) and **implement**
(the spawned builder writes `tools/novakai/cli.mjs` from the packet, DURING WI-7). **Do NOT
hand-write `cli.mjs`** — if the lead builds it, the walking-skeleton proof is void.
**Acceptance (walking skeleton, runnable-as-protocol):** a spawned builder, packet-only, implements
cli-door in a worktree; verify-change returns the contracted verdict. Record the run as an explicit
artifact `docs/novakai/plans/contract-slice-run.json` (like the m10 run artifacts) since it can't be
a pure `node --test`. **Safety (G6):** assert `git status` in MAIN is clean AFTER the real builder
runs (not just after the mechanism); teardown removes the worktree.

## WI-8 · writeback / re-sync of wave output  [closes implement→re-sync · deps: WI-7 · target: E3 writeback + ship]
**Problem (G3):** orchestrate stops at "verdict leaves the sandbox"; nothing lands the built code or
re-syncs the map after a wave passes.
**Change:** wire a passing worktree's result back. Exact invocation (approver SF-4, corrected):
`novakai:writeback` (package.json) = `node tools/buildspec/scaffold/scaffold.mjs --add-from-plan`
(E3 appends plan nodes to a fragment; it does NOT synthesize signatures from implemented code — the
plan path is a POSITIONAL to `--add-from-plan`, there is NO `--plan` flag). Steps: (1) merge the
passing worktree branch into the arc branch; (2) land the cli node in the fragment:
`npm run novakai:writeback -- docs/novakai/plans/contract-slice.plan.json --fragment
tools/novakai/onboard/understand.novakai.mmd`; (3) `npm run novakai:ship` to re-sync map+bodies.
Reuse E3; do not reinvent.
**Acceptance:** after WI-7's skeleton passes, the built `cli-door` code is on the branch, the cli
node is in the fragment (not a hand-edit), `npm run novakai:ship` clean, `_tooling.mmd` regenerates
with the new node. `git status` clean.

## WI-9 · cli-door  [low · SPLIT: setup before WI-7, implement DURING WI-7 · target: novakaiUnderstand__cli (NEW node: kind=service, parent=novakaiUnderstand)]
**WI-9-setup (before WI-7, by the lead):** author the change entry only — add the `cli-door` node to
`public/plan.json` and its target `%% src novakaiUnderstand__cli tools/novakai/cli.mjs` to the
**understand FRAGMENT** (`tools/novakai/onboard/understand.novakai.mmd`, since parent=novakaiUnderstand),
NOT a hand-edit of `_tooling.mmd` (which is REGENERATED by `novakai:tooling:bundle` and would wipe the
edit, then `tooling-coverage` fails). `tools/novakai/cli.mjs` MUST carry the `%% src` directive or
`tooling-coverage` exits 1.
**WI-9-implement (DURING WI-7, by the spawned builder):** thin `tools/novakai/cli.mjs` dispatcher over
EXISTING scripts: `onboard|plan|contract|verify|ship|status|help`; `help` narrates the loop stage.
Shells to `npm run novakai:*`, no new behaviour.
**Acceptance:** `node tools/novakai/cli.mjs help` lists verbs+stages; `... onboard` runs onboard;
`node --test tools/novakai/cli.test.mjs` (registered in `spec:test:all`); `npm run
novakai:tooling:verify` green (cli node resolves from the fragment).

## DEFERRED (out of this arc)
- **onboard-slice** (C4): a token optimization for the continue-session lead, not the subagent
  contract. Reuses `filterBodies`; revisit only if lead-context cost is measured to hurt.
- **verify-strict-lens**: dropped as standalone (C1); its check is absorbed into WI-1.

---

## Definition of done (whole arc)
- Every WI: its `node --test` green AND `npm run novakai:replay` deterministic (the real gate for
  `.mjs`; NOT status/gate). **Register each new `*.test.mjs` in `spec:test:all`** (G5 — the session-8
  trap: an unregistered test silently never runs).
- **WI-5 slice-completeness gate passes** and its negative test fails-closed (the keystone proof).
- **WI-7 walking-skeleton run artifact** exists and shows packet-only build → contracted verdict.
- **WI-8 writeback** landed the skeleton's output + `npm run novakai:ship` clean.
- `npm run novakai:tooling:verify` green (new `cli` node; I1 intact).
- `npm run novakai:plan-check -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd` coherent.
- CI (E4/F4): wire the slice-completeness gate into the loop-enforcement job; `SESSION_HANDOFF.md`
  updated command-anchored; F4 handoff-falsifiability passes.

## Scope honesty / open holes (stated, not hidden)
- **G4 dogfooding hole:** `.mjs` tooling changes cannot yet be attested through novakai's own
  contract (`status`/`verify-change` return PASS_UNPROVEN for them); this arc verifies via `node
  --test`+`replay`. Named as a standing hole; WI-1 (`acc.path` lens) is the plausible follow-on fix.
- **WI-7 is the only leg resting on the Agent primitive** (not a pure `node --test`) — that is why
  it's an explicit protocol run artifact, and why it's proven on the smallest real change (cli-door).
- **G6 builder isolation:** worktree shares `.git` + symlinks main's `node_modules`; the DoD's
  clean-check after a real builder run is the guard. A stronger boundary (copy vs symlink, read-only
  deps) is a future hardening, noted not built.
- fn-edges-verify is report-only by design until the 244 edges triage clean.
