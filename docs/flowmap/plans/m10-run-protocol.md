# M10 — run protocol: one real feature through the whole loop

This document is a **handover contract for the lead agent of the M10 session**. You (the lead)
execute it verbatim. It is not a design for the feature — designing the feature is Stage 2's job,
done by a subagent, not by you.

## Mission

Build one real UX fix in `src/` through the full flowmap loop —
understand → plan → review → approve → implement → re-sync — such that every handoff between
agents is a verifiable artifact, every verdict is a command exit code, and the run itself leaves a
machine-checkable record. M9 proved the tooling *chains*; M10 proves the loop *builds a real
feature* with subagents and zero drift. The run's outcome (PASS or FAIL) is recorded either way —
a red run with an honest manifest is a valid deliverable; a green narrative without one is not.

## The feature (symptom only — do not design here)

Today, opening or closing a group toggle on the canvas re-fits the view: a user zoomed into a
node who closes the parent group is thrown back to a full-canvas zoom-out. Required behaviour:
**toggling a group open/closed changes neither zoom nor focus** — the camera does not move, the
parent's on-screen location does not jump.

Starting pointers from the map (candidates, NOT the confirmed scope — the design subagent must
locate the real trigger path via `_bundle.mmd` + `public/bodies.json` and name it in the plan's
`intent` before proposing anything): `unfold` (its render-refit path calls `fitView` /
`reframeToFit` off `toggleExpand`), `viewspec` (the pure `toggleExpand` reducer), `camera`
(`zoomToFit`).

## Operating rules (non-negotiable)

1. **The lead is an orchestrator, nothing else.** The lead never opens a file under `src/`.
   The lead's inputs are: `docs/flowmap/_bundle.mmd` (after passing its own quiz), command exit
   codes, and JSON artifacts. The lead's only shell use is the gate commands listed per stage —
   verdicts must be received first-hand, because a subagent relaying a verdict re-introduces the
   prose trust hop this repo exists to kill.
2. **All reading, design and building is subagent work.** Design/audit judgment: opus.
   Build/mechanical work: sonnet. Every subagent starts with 0 context and is handed artifacts,
   never chat history.
3. **Proof, not prose.** No subagent's account of its own work is ever accepted. A stage passes
   when its command exits at the required code, run by the lead.
4. **Deviation = rejection.** The approved `.mmd` is the legal final shape. A builder whose diff
   leaves its contract's file set is reverted and replaced — the lead never "quickly fixes"
   anything itself (that is drift with extra steps).
5. **One branch.** All work on `m10/toggle-zoom` off current `main`. Never commit to main.
   One PR at the end; the human merges.
6. **Turn economy is a measured deliverable.** Target: lead ≤ ~20 tool calls total
   (≈ 4–6 spawns + the gate commands). Record the actual count in the manifest.

## Stage protocol

Every stage names WHO acts and the command + exit code that closes it.

### Stage 0 — lead onboards (lead)
- SessionStart already ran `flowmap:onboard`; confirm it printed MAP TRUSTWORTHY.
- Pass your own quiz (session-bound; nobody else's pass attests your read):
  `npm run flowmap:quiz -- generate --n 12 --seed <pick>` → answer from `_bundle.mmd` only →
  `npm run flowmap:quiz -- check --answers <file> --seed <same>` → required: 100%.
- `git checkout -b m10/toggle-zoom` from up-to-date main.

### Stage 1 — design (opus subagent, 0 context)
Spawn one design subagent. Its brief: the symptom block above, verbatim; locate the real trigger
path (map + `bodies.json`; source files only where those two leave a gap); author
`docs/flowmap/plans/m10.plan.json` to the plan schema — per change: `id`, `status`, `target`,
`phase`, `risk`, `dependsOn`, `intent{problem,approach,rationale}`, `fm{name,description,
interfaces}`, and a real `acceptance` block. Viewport behaviour is ctx/DOM-bound: acceptance uses
the projection pattern documented in `tools/buildspec/acceptance/acceptance.mjs` (pure lens over a
ctx slice — deterministic, no DOM). Worked example of a full plan with acceptance cases:
`docs/flowmap/demo/prep/plan.json`.
- Lead closes the stage with:
  `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m10.plan.json` → exit 0
  `npm run flowmap:cert -- --plan docs/flowmap/plans/m10.plan.json` → prints CERTIFIED, exit 0
- Either gate red → return the raw output to a FRESH design subagent (do not iterate the old one
  past two attempts; a fresh read is cheaper than a negotiated one).

### Stage 2 — human review on the .mmd (Chris + lead)
- Chris loads the plan in the flowmap app and reviews the **visual diff and blast radius** on the
  map — this is the custom-.mmd review the loop is built around.
- Chris records the decision as the artifact: `plan.verdicts[<id>] = "accept" | "reject"`.
- Lead closes the stage:
  `npm run flowmap:approve -- --plan docs/flowmap/plans/m10.plan.json --out docs/flowmap/plans/m10-approved --accepted-only` → exit 0.
  The emitted `approved.mmd` + `contracts/` are now the binding shape. Nothing before this stage
  touches `src/`.

### Stage 3 — schedule (lead)
- `npm run flowmap:waves -- --plan docs/flowmap/plans/m10.plan.json --strict --json` → wave 0 ids.

### Stage 4 — build (one sonnet subagent per change, 0 context)
For each change id in the current wave:
- Lead fetches the packet: `npm run flowmap:contract -- --change <id> --plan docs/flowmap/plans/m10.plan.json --json`.
- Spawn a builder whose prompt contains the sentinel line `FLOWMAP-CONTRACT:<id>` and
  `FLOWMAP-PLAN:docs/flowmap/plans/m10.plan.json` (the PreToolUse gate validates the packet at
  spawn and fails closed), plus the packet JSON itself. The builder gets NOTHING else — no chat
  history, no design discussion.
- The builder's first act is its own scoped quiz pass (the edit gate blocks `src/` writes
  without a fresh pass): `flowmap:quiz -- generate --scope <module> ...` → check → 100%.
- The builder implements to the contract's signature + acceptance cases, runs the checks locally,
  commits on the branch, and returns only its commit sha.

### Stage 5 — verdict per change (lead; deviation check is here)
- `npm run flowmap:verify-change -- --change <id> --plan docs/flowmap/plans/m10.plan.json --strict --json`
  → required verdict: `PASS`. `PASS_UNPROVEN` is a failure (it means no behavioural proof).
- Scope check: `git diff --name-only <branch-base>..HEAD` must be a subset of {files named by the
  contract packet's `source` + blast-radius refs} ∪ {`docs/flowmap/plans/m10*`}. Any other file →
  revert the builder's commit, record the violation in the manifest, respawn a fresh builder with
  the violation quoted.
- `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m10.plan.json` → exit 0.
- Repeat Stages 3–5 until `flowmap:waves` returns no unbuilt changes.

### Stage 6 — re-sync (lead runs; a sonnet subagent fixes anything red)
- `npm run flowmap:writeback -- docs/flowmap/plans/m10.plan.json --fragment <target fragment> --dry`
  first; then without `--dry` if the plan added nodes.
- `npm run flowmap:ship` → exit 0, then `git status --porcelain` shows only intended changes —
  the regenerated map must agree with `approved.mmd` for every touched node (drift here = a
  builder deviated and Stage 5 missed it; treat as Stage-5 failure).
- `npm run flowmap:status -- --plan docs/flowmap/plans/m10.plan.json` → exit 0 (all built, none
  drifted).

### Stage 7 — independent audit (opus subagent, 0 context)
Spawn a fresh auditor that is told ONLY: repo path, branch, plan path. It re-runs plan-check,
verify-change `--strict` per id, acceptance, ship + porcelain, status, and
`npm run flowmap:handoff:check`, and returns a command → exit-code table. The auditor never sees
the builders' or lead's account. Its table must match the lead's — any mismatch is itself a FAIL
to record.

### Stage 8 — human close (Chris)
- The 30-second check in the running app: zoom into a node, close the parent group, reopen it —
  the camera must not move. Optionally capture a GIF as the demo artifact.
- Chris's verdict goes in the manifest as `humanCheck: "pass" | "fail"`.

## The run manifest (the recorded result — commit it in the PR)

`docs/flowmap/plans/m10-run.json`, written by the lead as stages close:

```json
{
  "branch": "m10/toggle-zoom",
  "stages": [
    { "stage": "plan-check", "cmd": "...", "exit": 0, "attempts": 1 }
  ],
  "spawns": [ { "role": "design", "model": "opus", "attempts": 1 } ],
  "violations": [ { "change": "...", "files": ["..."], "action": "reverted+respawned" } ],
  "leadToolCalls": 0,
  "leadSrcReads": 0,
  "outcome": "PASS | FAIL",
  "frictions": ["one line per gate miss, retry, or protocol gap discovered"]
}
```

`attempts` counts honestly — retries are data, not embarrassment. `frictions` is the input to the
5–10 hour-run goal: which gate caught what, and how cheaply.

## Handover

- Update `docs/flowmap/SESSION_HANDOFF.md`: every claim a command, per protocol §5.
- Open ONE PR: feature commits + plan + approved export + manifest + handoff. The PR body lists
  the gate commands and their required exits so any 0-context reviewer can re-verify.
- The human merges. The lead never merges.

## Failure policy

If any stage cannot go green after two fresh-subagent attempts, STOP: set `outcome: "FAIL"`,
fill `frictions` with what blocked, commit the manifest and open the PR anyway (marked as a
protocol-run report, not a mergeable feature). A truthful FAIL manifest completes the M10
mission; forcing green does not.
