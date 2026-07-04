# What flowmap is

Flowmap is an **end-to-end tool for understanding a repo, planning changes, and reviewing,
approving, executing and testing them — with zero error in the handover, the change blast radius,
and the human's understanding, and zero reliance on stale prose.** Everything load-bearing is
testable, verifiable and objective; prose is an aid, never the source of truth.

Flowmap vision is that agent-subagent use of flowmap creates an enforceable, repeateable, provable contract,
allowing subagents to be heavily utilised with a 100% degree of confidence in execution.

It rests on two artifacts and two aspects.

**Artifacts**
- A **custom syntax** — an extended `.mmd` language — that captures a whole repo's functional
  connections and relationships in *one file*, at a fraction of the tokens of reading the source.
  This repo's own map is `docs/flowmap/_bundle.mmd`.
- **`public/bodies.json`** — function-body-level detail per node, for when you need the intricate
  internals behind a map node rather than just its shape.

**Two aspects**
1. A **visual drag-and-drop spatial editor** the human uses to review `.mmd` files — to understand
   a codebase spatially and, critically, to review a *plan*: the AI emits a patch + an updated map,
   the human reaches full understanding of the plan, approves it, and gains confidence it will
   execute with **0 drift, verified by tests**.
2. A **set of tools and tests** (`tools/`) that generate the flowmap files, the tests and the
   handover — and keep them in sync with the code.

Today the AI has full repo access, and any patch ships with an updated flowmap `.mmd`, so the patch
and the map are provably in sync.

# What flowmap is working towards (the durable goal)

I must be able to start a new Claude instance with **0 context** → have it use the flowmap
features (e.g. read `_bundle.mmd`) → reach **verifiable, testable understanding, not a prose
subjective yes/no** → the handover is trusted, understanding verified enough to have a meaningful
design discussion. Then it splits into two scenarios:

- **Scenario 1 — continue where the last session left off.** Today the *only* carrier of
  "where we are" must be derived state, never prose (prose here is the high-risk break point).
- **Scenario 2 — build a feature / fix a bug from human language.**

Either way Claude builds a plan and emits the flowmap files → I paste those into the flowmap app
to **see the visual diff vs today, the changes, the blast radius** → I approve → approval creates
an **export handed back to Claude to implement, with verifiable tests** → and the flowmap data in
the app stays up to date and maintained.

That is the workflow flowmap is built for: **end-to-end codebase understanding, design, planning
and implementation — error-free.**

The loop, named: **understand → (continue | design) → plan → review → approve → implement → re-sync.**
Every handoff is a verifiable artifact, never prose. Two keystones make it trustworthy:
**Keystone 1 — testable understanding** (the handover is trusted) and **Keystone 2 — behavioural
acceptance tests in the contract** (implementation is error-free, not just correctly-shaped).

## The one rule that keeps this doc from rotting

**This file holds INTENT, never STATUS.** A hand-written "✅ done / ❌ missing" marker is stale the
moment code lands — that drift is the exact failure flowmap exists to kill, so it is banned *here too*.
Roadmap status is **computed from the repo**, not written down:

```
npm run flowmap:roadmap          # live built / partial / unverified / missing, per phase item
npm run flowmap:roadmap -- --json
```

Each item's verdict comes from a machine **predicate** (file exists / pattern present / command exits 0 /
declared-manual) declared in `docs/flowmap/roadmap.json`. Want to know what's done? Run the command —
do not trust a sentence in this file. The audit below makes the ban enforceable:

```
npm run flowmap:roadmap:audit    # fails if any prose status marker creeps back into CLAUDE.md
```

## The roadmap — phase *definitions* (what each item means; status is computed, see above)

> Phase A makes the map a trustworthy substrate; until "green" means *true AND complete*, no
> downstream step can be trusted. B is verifiable onboarding (Keystone 1). C is continuity +
> planning. D is the visual review surface. E is approval → implementation → re-sync (Keystone 2).
> F makes the *agent protocol itself* verifiable, so the loop is followed, not just followable.

- **A1 — Symbol-level completeness gate.** Every exported symbol is a node or an audited curation exclusion.
- **A2 — Code↔map freshness in CI.** CI regenerates the node set + signatures from code and fails on divergence.
- **A3 — Two-parser conformance.** App parser (`io/mermaid`) and pipeline parser (`mmd-parse`) provably agree.
- **A4 — Verification-tier metadata.** Every claim tagged verified / advisory / unverified (PROVEN vs NARRATED).
- **A5 — Edge verification.** Every edge is code-backed (import / co-located) or an audited advisory edge, so the blast-radius the review trusts cannot rest on an unaccounted dependency.
- **B1 — Single onboarding command** (`flowmap:onboard`): one verifiable door in.
- **B2 — Keystone 1: comprehension self-test** (`flowmap:quiz`): understanding becomes pass/fail.
- **C1 — Verified work-state** (`flowmap:status`): "where we left off" derived from the live gate.
- **C2 — Plan authoring + one-command dry-run cert**: English → `plan.json` → `apply → stubs → tsc → gate`.
- **C3 — Authoring-time coherence**: real ids, acyclic deps, coherent accepted set — at authoring, not just review.
- **D1 — Layout fidelity**: the overlay renders on the human's real `ctx.state` positions, not a force-sim.
- **D2 — Unified review surface**: collapse `diffWorkspace` + `planner` into one path.
- **E1 — Single approval export**: approved `.mmd` + stubs/contracts + the gate flipped to the build checklist.
- **E2 — Keystone 2: behavioural acceptance tests in the contract**: approved criteria generate failing tests.
- **E3 — Writeback**: approved/implemented code updates the fragments automatically (no manual fragment edit).
- **E4 — CI enforces the whole loop**: map fresh+complete AND plan gate-green AND acceptance tests pass.
- **F1 — Session protocol in CLAUDE.md**: the agent working-protocol recorded as durable intent, not re-explained each chat.
- **F2 — SessionStart onboard hook**: the harness runs `flowmap:onboard` at session start, so onboarding is forced, not remembered.
- **F3 — Stop handoff-freshness hook**: a Stop-hook nudge when a session ends with the handoff lagging the code.
- **F4 — Verifiable meta-loop predicate**: the handoff must make no claim the committed tree falsifies; CI blocks a merge whose handoff lies about the code. Timestamp staleness is a non-blocking Stop-hook nudge to re-sync, not a per-PR merge blocker.
- **F5 — End-to-end loop run**: the whole spine runs as one chained sequence on the real plan, proving the loop executes, not just that each link passes alone.
- **I1 — Tooling self-map**: the dev-time `.mjs` tooling that runs the loop is itself represented in a flowmap map (`docs/flowmap/_tooling.mmd`, a sibling bundle kept out of the ts-morph `src` gate) — architectural (not a file-mirror), complete (every load-bearing module is a node or an audited exclusion) and symbol-true (every `%% src` resolves), proven by `flowmap:tooling:verify`. The map now documents its own generator, not just the app.

The handover entry note is `docs/flowmap/SESSION_HANDOFF.md` — command-anchored: every claim is a
command the next agent runs, not prose to trust.

---

# flowmap — orientation for a new contributor (human or AI)

Read this first. It is a thin **index of intent and pointers**, not a description of the app.
It holds three things and nothing else: the goal/roadmap (above), the repo's one structural fact
(app vs tooling, below), and where to go to learn how the app actually works (the verified map).
Everything that can be regenerated from code — modules, signatures, data model, call graph — lives
in the flowmap, not here, so this file stays short and rarely needs editing.

## Two things live in this repo — do not conflate them
1. **The app** — `src/`. A client-side canvas diagram editor. **Vanilla TypeScript + Vite,
   no framework** (no React/Vue/Svelte). The DOM is built by hand.
2. **The flowmap-spec tooling** — `tools/`. A *separate* dev-time system that turns a repo
   into a reviewable `.mmd` architecture map and lints it (it rejects flat "file-mirror"
   maps). It documents *other* repos — and this one. It is **not** part of the app runtime.
   Entry point: `tools/BUILD_FLOWMAP.md`. This app's own map is `docs/flowmap/_bundle.mmd`.
   `flowmap-scaffold` (`tools/buildspec/scaffold.mjs`) bootstraps draft fragments from TS
   (`--init`) and backfills interface declarations with real types (`--backfill`).
   How it is packaged, how other repos consume it (a local `file:` dependency, by
   design — not copy-paste, not on npm), and the exact publish recipe if that is ever
   needed: `tools/DISTRIBUTION.md`.

Everything below is about **the app**.

## How the app works — read the verified map, not this file
This file deliberately does **not** describe the app's modules, signatures, data model, runtime
loop or call graph. That prose is exactly what drifts, and it is exactly what
`docs/flowmap/_bundle.mmd` already holds — regenerated from code and gate-checked (every unit,
kind, signature, `desc` and edge). Re-narrating it here would duplicate the map and rot: the same
failure the roadmap rule above forbids, one layer down. So to understand the app, in order:

1. `npm run flowmap:onboard` — proves the map is true + complete as of HEAD, then states the **3
   durable invariants** (composition root in `main.ts`; modules never import each other — they call
   `ctx.hooks`; one shared `ctx` whose `ctx.state` is the source of truth). Those invariants are the
   *only* prose about app internals worth trusting, and their **single source is
   `tools/flowmap/onboard/onboard.mjs`** — not copied here, so the two cannot drift.
2. Read `docs/flowmap/_bundle.mmd` (or `docs/flowmap/root.mmd`) — the precise architecture: each
   module's interface + one-line `desc`, the data model, the call/runtime edges, the 13 heaviest
   units drilled to function level. `public/bodies.json` is the real source body per node.
3. `npm run flowmap:quiz` — turn your read into a pass/fail score before making any design claim.
4. In-flight plan? `npm run flowmap:status -- --plan <plan.json>` for verified work-state; the
   `docs/flowmap/SESSION_HANDOFF.md` note is command-anchored, not prose.

Quick answers without reading everything: *what module X exposes* → its `initX` return type / its
frontmatter in the map. *how X reaches Y* → it doesn't directly; find the hook in
`core/context.ts` and the wiring in `main.ts`. *minimum read before a change* → `main.ts` +
`core/context.ts` + the one module you're touching.

## Conventions (durable rules, not facts that drift)
- Theming is CSS variables set from `prefs` by `theming.ts` — don't hard-set colours on nodes.
- `%% ...` comment directives (including `%% src`) belong to the tooling, not the app.

## Keeping this current (low-maintenance by design)
- This file = **intent + pointers only**. Edit it to refine the goal/phase *definitions* above;
  **never** to record status (computed by `flowmap:roadmap`; `flowmap:roadmap:audit` fails the build
  if a status marker creeps back in) and **never** to describe app internals (those live in the map;
  the 3 invariants' single source is `tools/flowmap/onboard/onboard.mjs`).
- The **precise** map regenerates from code: `npm run flowmap:ship` (bundle → validate → lint
  → bodies). `flowmap-lint` fails the build if the map ever degrades into a flat file-mirror,
  so the architecture doc cannot silently rot.

## Working rules (non-negotiable)
- Before writing ANY documentation or making claims about how code works, READ the **bodies.json** file and **_bundle.mmd**. If there is a gap in these 2 files, THEN READ actual source files. Never synthesize from narrative docs or memory. 
WRITE and EDIT of code is obviously updated in source files.
- Batch your reads: read all relevant files in one turn before responding.
- After writing, VERIFY: run the commands you documented, cat the files you cited. Correct discrepancies before showing the result.
- If you're about to describe a script's behavior, cat package.json and quote it.

## Session protocol (how an agent works the loop)

These five behaviors apply to every agent session — builder, verifier, or continuity — without exception.

**1. Onboard before any design claim.**
Run `npm run flowmap:onboard` first. It proves the map is true and complete as of HEAD, and emits the 3 durable invariants. No design claim or architecture statement is made until that command exits clean. The invariants live in `tools/flowmap/onboard/onboard.mjs`; they are not reproduced here.

**2. Make understanding testable.**
Run `npm run flowmap:quiz` — generate questions, answer from `docs/flowmap/_bundle.mmd` alone, then check. A score below 100% means re-read the map before proceeding. The quiz is the gate for Keystone 1; passing it is a precondition for design work, not a courtesy. The pass is bound to THIS session — another agent's (or subagent's) pass never attests your read.

**2b. Two tracks: continue-sessions onboard scoped, design-sessions onboard full.**
Resuming an in-flight plan? Run `npm run flowmap:onboard -- --continue --plan <plan.json>` — it scopes the read (root.mmd + the plan modules' fragments) and the quiz (`--scope`) to the plan's blast radius; the edit gate then unlocks only that proven scope. Design questions outside the proven scope require either reading the relevant fragments and re-quizzing that scope, or re-running full onboard. Whole-app design work always takes the full track.

**3. Build with subagents; verify with a 0-context agent.**
Use SONNET for search, scaffolding, and build work (token-cheap). Use OPUS for verification and design judgment (accuracy matters most). Every new feature must be proven by a fresh agent that starts with 0 context and reads only the new command's output — never the builder's account of what happened. A feature is considered delivered when the gate is green AND a 0-context agent independently confirms the feature works from its output alone.

**4. Continuity is derived state, never prose.**
To resume in-progress work (Scenario 1), run `npm run flowmap:status -- --plan <plan.json>`. The work-state comes from the live gate, not from any written summary. Do not treat `SESSION_HANDOFF.md` as the source of truth for work-state — treat it as a pointer to the commands that produce the truth.

**5. Every session ends with a re-sync and a command-anchored handoff.**
Before closing, run `npm run flowmap:ship` to regenerate the map from code (bundle → validate → lint → bodies). Then update `docs/flowmap/SESSION_HANDOFF.md` so that every claim in it is a command a 0-context agent can run — never a prose assertion. A handoff that cannot be verified by a command is not a handoff.
