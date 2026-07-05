# M9 recording protocol

## (a) Capture method — no new deps, mac-native only

Two legs, two capture tools, both already on the machine:

- **Browser leg (human-driven: planner review/approve, unfold verifying the
  landed status readout)** — macOS screen recording. `Cmd+Shift+5` (Screenshot
  app's recording mode) or QuickTime Player → File → New Screen Recording.
  Save as `docs/novakai/demo/browser-recording.mov`. **Genuine mouse input
  only** — see pitfall below.
- **CLI legs (onboard, quiz, plan-check, approve, contract, verify-change,
  orchestrate, acceptance, writeback, ship)** — `script`, the BSD terminal
  transcript tool already at `/usr/bin/script` (verified present, no
  asciinema on this machine and none needed):
  ```
  script -q docs/novakai/demo/cli-session.typescript
  # ...run every CLI step inside this shell...
  exit    # closes the transcript
  ```
  If the raw typescript's control characters are unwanted, fall back to
  per-command `tee`: `npm run novakai:onboard | tee docs/novakai/demo/logs/onboard.log`
  for each step instead of one wrapping session. Either is acceptable; the
  predicates in (c) check the structured JSON/log artifacts, not the
  transcript itself — the transcript is corroborating evidence.

## (b) Artifact set — `docs/novakai/demo/` after the run

One run, one directory, one `manifest.json` at its root indexing every file
below with the exact command that produced it (the manifest itself is the
first thing a 0-context verifier reads).

| File | Produced by |
|---|---|
| `manifest.json` | hand-written index: `[{ step, file, command }]` |
| `quiz-pass.json` | `npm run novakai:onboard` then `npm run novakai:quiz -- --check` (100%) → `cp .novakai-quiz-pass.json docs/novakai/demo/quiz-pass.json` |
| `english-request.txt` | the exact sentence handed to the demo agent (verbatim, no paraphrase) |
| `plan.json` | the demo agent's freshly hand-authored plan — **its own file** (e.g. `docs/novakai/plans/m9-demo.plan.json`), never `public/plan.json` (pitfall below) |
| `plan-check.json` | `npm run novakai:plan-check -- --plan docs/novakai/demo/plan.json --json > docs/novakai/demo/plan-check.json` |
| `approved-plan.json` | `plan.json` + a `verdicts` map (`{ changeId: "accept" \| "reject" }`) added by the human's review/approve action in the planner UI |
| `approve-export/` | `npm run novakai:approve -- --plan docs/novakai/demo/approved-plan.json --out docs/novakai/demo/approve-export --accepted-only` → contains `approved.mmd`, `contracts/`, `plan.json`, `CHECKLIST.md` |
| `approved-spec.mmd` | `cp docs/novakai/demo/approve-export/approved.mmd docs/novakai/demo/approved-spec.mmd` (stable top-level name for the exported spec; byte-identical to the file inside `approve-export/`) |
| `contracts/<id>.contract.json` | one per accepted change: `npm run novakai:contract -- --change <id> --plan docs/novakai/demo/approved-plan.json --json > docs/novakai/demo/contracts/<id>.contract.json` |
| `verify-change/<id>.pre.json` | run BEFORE implementing, expected `verdict: "FAIL"` (red): `npm run novakai:verify-change -- --change <id> --plan docs/novakai/demo/approved-plan.json --strict --json > docs/novakai/demo/verify-change/<id>.pre.json` |
| `verify-change/<id>.post.json` | same command run AFTER implementing, expected `verdict: "PASS"` (green) — **must use `--strict`**, see pitfall below |
| `orchestrate.json` | `npm run novakai:orchestrate -- --plan docs/novakai/demo/approved-plan.json --strict --json > docs/novakai/demo/orchestrate.json` |
| `acceptance.json` | `npm run novakai:acceptance -- --plan docs/novakai/demo/approved-plan.json --json > docs/novakai/demo/acceptance.json` (post-implementation, all cases green) |
| `writeback.diff` | `git diff -- '*.novakai.mmd' > docs/novakai/demo/writeback.diff` captured immediately after `npm run novakai:writeback` |
| `ship.log` | `npm run novakai:ship 2>&1 \| tee docs/novakai/demo/ship.log` — must end with the `DONE: ...` line `novakai:ship:steps` prints on success |
| `cli-session.typescript` (or `logs/*.log`) | the `script`/`tee` transcript from (a) |
| `browser-recording.mov` | the screen recording from (a) |

## (c) Machine predicates (replace M9's current `manual` check)

`docs/novakai/mvp-roadmap.json`'s M9 item today has a single `manual` check
("Recording exists + each spine step verifiable by command from the
recording's session artifacts"). Once the artifact set in (b) lands, replace
it with (predicate `kind`s match the M0/M4 vocabulary — `file`/`grep`/`cmd`):

```json
{
  "id": "M9",
  "checks": [
    { "kind": "file", "path": "docs/novakai/demo/manifest.json" },
    { "kind": "file", "path": "docs/novakai/demo/quiz-pass.json" },
    { "kind": "grep", "path": "docs/novakai/demo/quiz-pass.json", "pattern": "\"score\": \"12/12\"" },
    { "kind": "file", "path": "docs/novakai/demo/english-request.txt" },
    { "kind": "file", "path": "docs/novakai/demo/plan.json" },
    { "kind": "cmd", "run": "npm run -s novakai:plan-check -- --plan docs/novakai/demo/plan.json" },
    { "kind": "file", "path": "docs/novakai/demo/approved-plan.json" },
    { "kind": "grep", "path": "docs/novakai/demo/approved-plan.json", "pattern": "\"verdicts\"" },
    { "kind": "file", "path": "docs/novakai/demo/approve-export/approved.mmd" },
    { "kind": "file", "path": "docs/novakai/demo/approve-export/CHECKLIST.md" },
    { "kind": "file", "path": "docs/novakai/demo/orchestrate.json" },
    { "kind": "grep", "path": "docs/novakai/demo/orchestrate.json", "pattern": "\"fail\":0" },
    { "kind": "file", "path": "docs/novakai/demo/acceptance.json" },
    { "kind": "cmd", "run": "! grep -q '\"pass\":false' docs/novakai/demo/acceptance.json" },
    { "kind": "file", "path": "docs/novakai/demo/writeback.diff" },
    { "kind": "file", "path": "docs/novakai/demo/ship.log" },
    { "kind": "grep", "path": "docs/novakai/demo/ship.log", "pattern": "^DONE:" },
    { "kind": "file", "path": "docs/novakai/demo/browser-recording.mov" }
  ]
}
```

Notes on the two `grep`/`cmd` verdict checks: `orchestrate.json`'s summary
field is `{ total, pass, passUnproven, fail }` (see `tools/novakai/orchestrate.mjs`
line ~175) — `"fail":0` after JSON serialization (adjust the exact spacing to
match `JSON.stringify` output, or switch to a `cmd` check that greps a spaced
variant / uses `node -e`). `acceptance.mjs`'s per-case objects carry
`"pass": true|false` (see `tools/buildspec/acceptance.mjs` line ~160) — the
negated grep is the cheap proxy for "every case passed"; a `jq`-free `cmd`
check works because macOS ships `grep` but not `jq` by default.

## (d) Known pitfalls to honor on camera

1. **Genuine mouse input only.** `unfold.ts` (~line 952) calls
   `stageEl.setPointerCapture` on pointerdown; a synthetic
   `dispatchEvent(new PointerEvent('pointerdown', …))` carries no OS-backed
   pointer id and throws a `pageerror` (KNOWN_EDGES, isolated + reproduced
   2026-07-03, `docs/novakai/probes/m5-tabs2-verbs.probe.js` header). A human
   driving the browser by hand for the recording is real input and is fine;
   if any step is scripted (e.g. a Playwright probe used to double-check
   behaviour before recording), it must drive via `page.mouse`, never
   `dispatchEvent`.
2. **`verify-change` must be run `--strict`.** Without it, `PASS_UNPROVEN`
   exits 0 exactly like `PASS` (KNOWN_EDGES) — a caller that only checks the
   exit code cannot tell "shaped but unproven" from "behaviourally proven".
   Every `verify-change` invocation in the artifact set above passes
   `--strict`; the JSON body is byte-identical with or without the flag, so
   this costs nothing.
3. **The demo runs on its own fresh plan, never `public/plan.json`.**
   `public/plan.json` is the plan CI's `novakai:verify:full` targets
   (`npm run novakai:cert -- --plan public/plan.json`, etc.) — overwriting it
   for a one-off demo would break CI and corrupt a checked-in artifact. The
   demo agent authors and commits its plan under `docs/novakai/plans/` (or
   keeps it scratch-only if the demo is never meant to land), and every
   command above points at that path explicitly via `--plan`.
4. **Plan-lifecycle**: per KNOWN_EDGES, once an `add` change lands its row
   must be hand-flipped to `modify` to keep `novakai:plan-check` green
   against the new base map, and a landed `remove` has **no** workaround
   (permanent REAL-IDS failure). The recommended demo feature
   (`w5/plan.json`) is `add` + `modify` only — no `remove` — so this
   class of pitfall does not apply to it, but any substitute feature chosen
   later should keep that constraint.
5. **`.novakai-quiz-pass.json` is gitignored, session-scoped, and
   map-hash-bound.** It must be copied into the demo dir on the same
   `_bundle.mmd` the quiz was scored against — if the map changes (e.g. the
   `novakai:ship` re-sync at the end) after the quiz pass and before the copy,
   re-run `novakai:quiz -- --check` to confirm it still matches, or copy it
   before any map-changing step.
