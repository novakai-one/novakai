# Onboarding-cost design contract — session-bound, module-scoped quiz pass

Approved direction (Chris, 2026-07-03): keep the compliance guarantee — an agent may not
edit `src/` before its read of the map is machine-verified — while cutting what that
guarantee costs per session. Evidence base recomputed before design (metrics log,
2026-07-02 window): 2 quiz attempts vs 55 edit-gate decisions; the cost is not quiz
re-runs but (a) whole-bundle reads riding in context all session, (b) whole-map staleness
forcing full re-onboards after any code change, (c) a 932-line handoff read each session
(rotated separately, commit `db168ac`).

## The three changes (one artifact schema migration)

The pass artifact `.flowmap-quiz-pass.json` moves to v2, designed once, landed across
two commits (session binding first, then per-fragment hashes — the gates never see two
competing schemas because verify treats any missing v2 field as "re-take"):

```
{
  "v": 2,
  "map": "docs/flowmap/_bundle.mmd",
  "seed": 1, "n": 12, "score": "12/12",
  "mapHash": "<sha256 of bundle bytes>",          // full-track binding (unchanged)
  "session": "<claude session id>" | null,        // item 4
  "scope": "all" | ["<module>", ...],             // item 3 — what was actually quizzed
  "fragments": { "<module>": "<sha256 of fragment bytes>", ... }  // item 2 — ALL fragments at pass time
}
```

### Item 4 — session binding

- `quiz check` records `session` = `--session <id>` flag, else `CLAUDE_CODE_SESSION_ID`
  env (verified present in harness Bash and equal to the PreToolUse payload's
  `session_id` — checked live this session), else `null`.
- `quiz verify` gains `--session <id>`. Session checking activates ONLY via the flag —
  never implicitly from env — so manual CLI runs and existing tests keep deterministic,
  environment-independent hash-only semantics. Decision table when the flag is present:
  artifact `session` equals the flag → the other checks decide; anything else (different
  id, `null`, or a pre-v2 artifact) → fail, "pass belongs to another session — re-take".
- `edit-gate` passes `--session <payload.session_id>` when the payload carries one; a
  payload without `session_id` verifies without the flag (the harness always sends one;
  the flagless path exists for synthetic callers and keeps every existing deny path
  intact — no deny is removed, one is added).
- Documented no-session boundary: outside a harness session (manual CLI, CI) there is no
  identity to bind, so verify without `--session` stays hash-only. The enforcement point
  is the gate, and the gate always has the payload id.
- Consequence, accepted deliberately: a fresh session no longer inherits the previous
  session's pass — each agent proves its own read. Items 2–3 make that re-proof cost
  ~20–30k tokens (scoped read + scoped quiz) instead of ~500k.

### Item 2 — per-module staleness

- `quiz check` also records `fragments`: sha256 per colocated fragment
  (`src/**/*.flowmap.mmd` + `src/main.flowmap.mmd`), keyed by the fragment's
  `%% root <id>` module id. Recording covers ALL fragments regardless of quiz scope —
  the hashes are "the world as it was when understanding was proven".
- `quiz verify` gains `--file <src path>`: resolve the file's owning module from the
  bundle's `%% src` directives (fallback: colocated fragment basename — covers
  `src/main.ts`, whose boot code is module-level); then require (1) the module is inside
  the artifact's proven `scope` (or scope is `"all"`), (2) the module's fragment hash is
  current, and (3) every direct edge-neighbour module's fragment hash is current
  (neighbours derived from the bundle's module-level edge adjacency, both directions —
  edges are code-backed or audited per A5). Whole-bundle `mapHash` mismatch alone no
  longer denies a `--file` verify; it still governs flagless (full) verify unchanged.
- Fail closed: a file that resolves to no module and no colocated fragment, or a module
  with no recorded fragment hash, denies.
- `edit-gate` passes `--file <target>` (plus `--session`); its deny reason names the
  stale module(s) and the scoped re-take command.

### Item 3 — two-track onboarding

- `quiz generate|check --scope <m1,m2,...>` draws questions only from nodes owned by
  the named modules; `check --scope` records that list as the artifact's `scope`.
  A scoped pass therefore unlocks edits only inside the proven scope (+current
  neighbours); a full pass records `"all"`.
- `onboard --continue [--plan <plan.json>]`: proves map trust (same STEP 1), then points
  at `root.mmd` + the 3 invariants + the handoff's `0·now` + the in-flight plan's target
  modules' fragments, and emits the scoped quiz commands for exactly those modules.
  It must print verbatim: "Design questions outside the proven scope require either
  reading the relevant fragments and re-quizzing that scope, or re-running full onboard."
  The same rule is added to the session protocol in CLAUDE.md (F1). The full track is
  unchanged. The advice-side rule is protocol (prose, F1); the edit side is enforced by
  the gate (item 2).

## Test-first order

Each item lands red-then-green in its own commit; the full suite, `flowmap:ship`
cleanliness and `flowmap:roadmap:audit` are re-proven per commit.

1. quiz.test.mjs: check records session (flag beats env, absent → null); verify
   --session match / mismatch / legacy-artifact / flagless-manual cases.
   edit-gate.test.mjs: payload session matching artifact → allow; mismatched → deny;
   sessionless payload → hash-only (existing cases pinned green).
2. quiz.test.mjs: fragments recorded keyed by `%% root`; verify --file: current module +
   current neighbours → pass; neighbour stale → fail; unrelated module stale → pass;
   unmapped file → fail; missing fragment hash → fail. edit-gate.test.mjs: the same
   through the gate with payloads, plus deny-reason names the scoped re-take.
3. quiz.test.mjs: generate --scope draws only in-scope refs; check --scope records
   scope; verify --file outside proven scope → fail. onboard.test.mjs: --continue emits
   the verbatim out-of-scope rule + scoped quiz commands; full track byte-stable.

## Non-goals

- No change to what the quiz measures per question (kind/owner/parent/arity/returns).
- No CI/repo predicate for the pass artifact — it stays personal session state
  (gitignored), surfaced by onboard, enforced by the PreToolUse gate.
- No weakening of any existing deny path in any gate.
- Same-map answer replay within one session remains mathematically inherent (the key
  derives from the map; stated in the tool header since F-03).
