# M2b — Compliance metrics collector: design

This document is the reviewed design contract for M2b. It names every file, command and
predicate before any code exists, so the build session that follows it has a machine-checkable
target (`npm run flowmap:mvp` computes how much of it has landed — this doc never says).

The roadmap intent it serves, quoted from `docs/flowmap/mvp-roadmap.json`:

> Quantified trust: quiz pass rate, cert pass rate, gate-deny count, PASS_UNPROVEN ratio over
> N loop runs. Converts trust from one green run to a number.

## 1. Purpose & scope

Today every compliance signal in the loop is transient: the four gates exit 0/2 and print;
`quiz.mjs check` overwrites a single pass marker (`.flowmap-quiz-pass.json`) and a failed
attempt leaves no record; a `flowmap:ship` run leaves only its regenerated artifacts. One green
run proves one green run. M2b adds an append-only event log plus one summarizer command so that
trust becomes a rate over N runs instead of an anecdote.

Three deliverables (all future-session build work; this session delivers only this doc and the
roadmap predicate conversion):

- `tools/flowmap/lib/metrics-log.mjs` — the emitter (one function, fail-silent).
- `tools/flowmap/metrics.mjs` — the CLI: `summary` (the `npm run flowmap:metrics` entry) and
  `wrap` (the ship-run recorder).
- Instrumentation call-sites in the four gates, `quiz.mjs`, `verify-change.mjs` and
  `plan-cert.mjs`.

## 2. Event taxonomy & JSONL schema v1

One JSON object per line in `docs/flowmap/metrics/session-log.jsonl`. Every line carries the
common fields; the `event` value selects one extension block.

```jsonc
// common — every line
{
  "v": 1,                                  // schema version; bump = detectable, never guessed
  "ts": "2026-07-03T18:04:11.000Z",        // new Date().toISOString(), always UTC
  "event": "gate" | "quiz" | "ship" | "verdict",
  "source": "edit-gate.mjs",               // basename of the emitting tool
  "session": "sess-abc" | null             // hook payload session_id when present
}

// event: "gate" — one line per gate decision
{ "gate": "edit" | "plan" | "ship-staleness" | "contract",
  "decision": "allow" | "deny",
  "reason": "…",                           // deny only — the same string the gate prints
  "target": "src/main.ts" }                // when the hook payload names one

// event: "quiz" — one line per `quiz.mjs check`
{ "cmd": "check", "pass": true, "score": "12/12", "seed": 1, "n": 12,
  "mapHash": "b93bd7…" }                   // quiz already computes it; free provenance

// event: "ship" — paired lines from the wrap subcommand
{ "phase": "start" }
{ "phase": "end", "ok": true, "durationMs": 41200 }

// event: "verdict" — one line per closed-form verdict
{ "tool": "verify-change" | "plan-cert",
  "verdict": "PASS" | "FAIL" | "PASS_UNPROVEN",
  "change": "C3", "strict": true }
```

The summarizer tolerates unknown fields and unknown `event` values (counted under "other"), so
a `v` bump degrades gracefully instead of crashing the reader.

## 3. Emitter contract — `tools/flowmap/lib/metrics-log.mjs`

One export:

```js
recordEvent(fields, root)   // root defaults to FLOWMAP_ROOT || repo root
// -> mkdirSync(docs/flowmap/metrics, { recursive: true })
// -> appendFileSync(session-log.jsonl, JSON.stringify(line) + '\n')
```

The invariant, and the reason the whole body is one try/catch that swallows everything:

**Logging may never change any gate's decision, exit code, stdout, or latency class.**

This mirrors the gates' own fail-open rule (edit-gate allows when `quiz.mjs` is unspawnable —
a gate must not block work on its own bug). A broken emitter therefore silently undercounts;
that cost is accepted and named here. `FLOWMAP_METRICS_DEBUG=1` prints emit errors to stderr
for development. `FLOWMAP_ROOT` is honored so the existing hermetic-fixture test pattern
(mkdtemp + env seam) works unchanged.

The emitter is **imported, not spawned** — `lib/canonical.mjs` is the precedent for gates
importing a lib module, and spawning a recorder CLI inside a PreToolUse hook would add process
start-up latency to every Edit/Write.

## 4. Instrumentation points

| Tool | Event emitted | Call-site |
| --- | --- | --- |
| `tools/flowmap/edit-gate.mjs` | `gate` (`gate:"edit"`) | at each allow/deny exit path |
| `tools/flowmap/plan-gate.mjs` | `gate` (`gate:"plan"`) | at each allow/deny exit path |
| `tools/flowmap/ship-staleness.mjs` | `gate` (`gate:"ship-staleness"`) | at the block / fresh exit paths |
| `tools/flowmap/contract-gate.mjs` | `gate` (`gate:"contract"`) | at each allow/deny exit path |
| `tools/flowmap/quiz.mjs` | `quiz` | end of `check`, pass or fail |
| `tools/flowmap/verify-change.mjs` | `verdict` | where the closed-form verdict is printed |
| `tools/flowmap/plan-cert.mjs` | `verdict` | where the cert verdict is decided |
| `package.json` `flowmap:ship` | `ship` | via `metrics.mjs wrap` (section 5) |

All **four** gates are instrumented, not only the three M2 hooks: a "gate-deny count" scoped to
3 of 4 gates would misreport by omission, and the call is identical.

Explicit non-goals:

- `quiz.mjs verify` is **not** logged. Edit-gate spawns it on every `src/` edit, so logging it
  would duplicate the edit-gate event at high volume — and the intent's "quiz pass rate" means
  the *attempt* (`check`) pass rate.
- `quiz.mjs generate` is **not** logged (no outcome to record).

## 5. Ship run recording

The current `flowmap:ship` chain moves verbatim to a new script `flowmap:ship:steps`, and
`flowmap:ship` becomes a transparent wrapper:

```jsonc
"flowmap:ship":       "node tools/flowmap/metrics.mjs wrap --event ship -- npm run flowmap:ship:steps",
"flowmap:ship:steps": "npm run flowmap:bundle && … (today's chain, unchanged)"
```

`wrap` records `{phase:"start"}`, spawns the command after `--`, records
`{phase:"end", ok, durationMs}`, and **exits with the child's exit code** — callers cannot tell
the wrapper is there. An unmatched `start` line means an aborted/killed run; the summarizer
reports that count rather than hiding it.

The name `flowmap:ship` is preserved deliberately: `ship-staleness.mjs` demands it by name in
its block message, and SESSION_HANDOFF rows plus CI reference it.

Rejected alternatives: logging ship from the Stop hook (fires once per session, not per run,
and cannot observe the run's outcome); injecting record calls into the `&&` chain (a failing
middle step skips the tail call so start/end cannot be paired, and switching to `;` would break
fail-fast).

## 6. Summarizer CLI spec — `tools/flowmap/metrics.mjs`

Wired as:

```jsonc
"flowmap:metrics": "node tools/flowmap/metrics.mjs summary"
```

House style throughout: shebang + header docblock with Usage and Exit codes, hand-rolled
`arg(flag, fallback)` parsing, `--json` machine mode, ✓/✗/· glyphs.

Windowing: `--since <ISO>` (events at/after the instant), `--last <N>` (last N events),
default all-time. The active window is echoed in the output.

Human output — the four intent metrics plus provenance counters:

- quiz pass rate: `check` passes / `check` attempts
- gate denies: count per gate, alongside allow counts (deny ratio per gate)
- ship runs: n, ok rate, aborted count (unmatched starts), median durationMs
- cert pass rate: `plan-cert` verdicts, PASS / total
- PASS_UNPROVEN ratio: `verify-change` verdicts with PASS_UNPROVEN / total
- footer: total events, window, malformed-line count

**0/0 renders as "n/a" (JSON `null`), never as 0%.** "No data" and "perfect compliance" must be
distinguishable — a fake zero would be exactly the kind of unearned green M2b exists to kill.

Exit codes: `0` = summary produced, **including when the log is absent or empty** (graceful
n/a — required so the roadmap `cmd` predicate passes on a fresh clone, and so the metrics
reader is never itself a gate); `1` = log present but unreadable at the file level (EACCES and
kin); `2` = usage error. Malformed lines never affect the exit code (section 8).

## 7. Storage & git

Log path: `docs/flowmap/metrics/session-log.jsonl`. The whole `docs/flowmap/metrics/` directory
is **gitignored** (the emitter mkdirs it on first write; nothing is committed).

Rationale:

- It is session/machine-local telemetry, exactly like `.flowmap-quiz-pass.json` and
  `.quiz-answers.json`, which `.gitignore` already excludes with reasoned comments — same
  precedent, same comment style.
- A committed append-only log guarantees an EOF merge conflict between any two concurrent
  branches, plus unbounded repo growth.
- Trust story: M2b quantifies *this working copy's* compliance. Cross-machine aggregation is
  future work (a `summary --log <path>...` merge is the natural extension; not v1).

Consequence, embraced: **roadmap predicates target the tool and its wiring, never the log
file** — a fresh clone has no log, and the predicates (section 9) plus the summarizer's exit-0
on-empty rule are designed around that.

No rotation in v1: `--since` windowing keeps reads cheap as the log grows; a `prune`
subcommand is listed as future work.

## 8. Failure semantics

- **Malformed JSONL lines**: skip, count, report the count in both output modes; exit code
  unaffected. A summarizer that dies on one torn line hides every other metric.
- **Concurrent appends**: each event is a single `appendFileSync` of one complete
  `\n`-terminated sub-1KB line on an `O_APPEND` fd — atomic in practice on macOS/Linux. If a
  torn line ever occurs anyway, the malformed-line skip absorbs it: the log is self-healing by
  construction, so no lockfile.
- **Clock**: `new Date().toISOString()` (UTC) always. Boundary with the determinism rule: the
  canonical-output discipline (no wall-clock in tool stdout, enforced by replay) governs
  contract tools' *stdout*; this side log is not tool output and must never leak into stdout —
  `verify-change`'s JSON body stays byte-identical.
- **Fail-silent cost, named honestly**: a broken emitter silently undercounts. Accepted,
  because the alternative — metrics I/O influencing a gate decision — violates the gates'
  fail-open rule. `FLOWMAP_METRICS_DEBUG=1` is the escape hatch.

## 9. Roadmap predicate conversion

The M2b `manual` note is replaced by machine predicates in `docs/flowmap/mvp-roadmap.json`
(this session):

```json
"checks": [
  { "kind": "file", "path": "tools/flowmap/metrics.mjs" },
  { "kind": "file", "path": "docs/flowmap/m2b-metrics-design.md" },
  { "kind": "grep", "path": "package.json", "pattern": "\"flowmap:metrics\":" },
  { "kind": "grep", "path": "tools/flowmap/edit-gate.mjs", "pattern": "lib/metrics-log" },
  { "kind": "grep", "path": "tools/flowmap/quiz.mjs", "pattern": "lib/metrics-log" },
  { "kind": "grep", "path": "package.json", "pattern": "metrics\\.mjs wrap --event ship" },
  { "kind": "cmd",  "run": "node tools/flowmap/metrics.mjs summary --json" }
]
```

Design of the set: the two grep checks on `lib/metrics-log` plus the ship-wrap grep prove
**instrumentation** of the three brief-named event families (a gate, the quiz, ship) — not
merely that a file exists; the `cmd` check proves the summarizer degrades gracefully on
whatever log the machine has (including none). The doc-file check makes this reviewed design
itself part of the computed score.

The `manual` note is dropped entirely rather than kept alongside: `roadmap.mjs` treats a
manual check as never-passing, so keeping it would cap M2b below its ceiling forever even
after every predicate is met. Its content lives on here.

`npm run flowmap:mvp` computes where M2b stands against these checks at any moment — that
command, not this doc, is the status.

## 10. Build plan for the follow-up session (test-first)

1. `tools/flowmap/lib/metrics-log.test.mjs` — append shape, fail-silent on unwritable dir,
   `FLOWMAP_ROOT` seam. Then the lib.
2. `tools/flowmap/metrics.test.mjs` — summary on: no log, empty log, well-formed log,
   log with malformed lines (skip + count), `--since` / `--last` windows, n/a-vs-zero rule;
   `wrap` exit-code transparency (child exit 0 / 1 / killed) and start/end pairing. Then the CLI.
3. Instrumentation call-sites in the four gates, `quiz.mjs check`, `verify-change.mjs`,
   `plan-cert.mjs` — extend each tool's existing test file with a grep/behavioural check that
   the emitter is wired and that exit codes are unchanged.
4. `package.json`: add `flowmap:metrics`, split `flowmap:ship` / `flowmap:ship:steps`,
   register `metrics.test.mjs` (and the lib test) in `spec:test:all`.
5. `.gitignore`: `docs/flowmap/metrics/` with the standard reasoned comment.
6. Tooling self-map: `%% src` nodes for `metrics.mjs` and `lib/metrics-log.mjs` in a
   `.flowmap.mmd` fragment, regenerate `_tooling.mmd`, `npm run flowmap:tooling:verify`.

## 11. Out of scope / future

- Log rotation / `prune` subcommand.
- Cross-machine log aggregation (`summary` over multiple `--log` paths).
- Sampling or rate-limiting of high-volume events (nothing currently qualifies once
  `quiz verify` is excluded).
