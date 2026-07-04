# M10 turn-discipline — what the phases are and how each one proves its point

> **Anti-rot contract for this doc:** it explains *intent and method* — never current
> status. Every number quoted here is a snapshot of `docs/flowmap/turn-baseline.json`
> (that file is authoritative; re-derive live numbers with the commands below). Every
> claim of behaviour is paired with the command that reproduces it. If prose and a
> command's output ever disagree, the command wins.

## The problem being attacked

Agents working in this repo were inefficient in one specific, mechanical way. Every
assistant API turn re-sends the whole accumulated conversation context (the "cache
read"). An agent that performs one lone file-read per turn therefore pays the full
multi-million-token context bill over and over to gain one file's worth of new
information per payment. Measured over 18 real session transcripts (medians recorded
in `turn-baseline.json`): ~1.28 tool calls per tool-bearing turn, cache re-reads ≈99%
of all tokens processed, and ~3.18M context tokens burned before the first `src/`
edit. The remedy under test: force *batching* of independent reads into one turn, and
push work to subagents so the main thread stays lean.

Re-derive the numbers yourself, any time:

```
npm run --silent flowmap:turns -- summary     # per-session table + medians, live
cat docs/flowmap/turn-baseline.json           # frozen baseline + targets + protocol
```

## Phase 0 — measure the problem, build the enforcement

Two tools were built (both under `tools/flowmap/`, mapped in `_tooling.mmd`):

- **MEASURE** — `turns.mjs` parses the real session transcripts on this machine and
  computes, per session: batch ratio, cache-read tokens, tokens-to-first-src-edit,
  subagent tokens. The pre-enforcement medians were frozen into `turn-baseline.json`
  together with the targets (batch ratio ≥ 2.0; tokens-to-first-src-edit < 50k).
- **FORCE** — `turn-gate.mjs`, a PreToolUse hook on `Read|Grep|Glob` (wired in
  `.claude/settings.json`). After a streak of consecutive turns each containing
  exactly one lone read, it denies the next lone read with an actionable message:
  batch the reads. A marker file (`.flowmap-turn-gate.json`) is meant to grant one
  free retry for a read that genuinely had nothing to batch with.

**How it proves its point:** the baseline was not taken on faith — an independent
parser written *before* this tooling existed measured a near-identical session set
(17 of the 18) and got concordant numbers (1.26 vs 1.28 batch ratio; see `independentCrossCheck` in
`turn-baseline.json`). Two implementations agreeing is the evidence the measurement
itself is trustworthy.

Verify: `cat docs/flowmap/turn-baseline.json` · `grep -n "turn-gate" .claude/settings.json`

## Phase A — prove the mechanism works in principle

Question: *does the gate machinery behave exactly as specified?* Deny at the streak
threshold, write the marker, fail **open** on malformed input (a blocked read would
wedge the whole session, unlike a blocked edit), log only deny / allow-after-deny
events. Proven by automated tests, and independently executed by a **0-context
agent** — a fresh agent with no memory of building the tool, so it cannot confirm its
own work by wishful thinking. That is this repo's standard: the builder never attests
its own build.

Phase A also produced a code-derived *prediction*: the free-retry check
(`marker.streak >= streak`) may never pass on a live transcript, because the denied
call's message persists in the transcript — the retry recomputes a streak one longer
than the marker recorded, fails the check, and is denied again (an infinite deny loop
that only batching escapes). Synthetic test transcripts did not grow the way live
ones do, which is why the tests alone could not settle this.

Verify: `node --test tools/flowmap/turn-gate.test.mjs tools/flowmap/turns.test.mjs tools/flowmap/metrics.test.mjs`

## Phase B — settle the prediction with a live experiment

A prediction from reading code is not an observed fact. Phase B is a controlled
live-fire run in a real session: trip the gate deliberately (a streak of lone reads
in one uninterrupted assistant chain), then retry the identical read once, and
observe which outcome reality picks — retry denied again (defect confirmed → fix the
comparison and pin the new semantics in a growing-transcript regression test), retry
allowed with the marker consumed (no fix needed), or a false positive where a turn
boundary reset the streak (re-run properly). The code is not changed until the live
behaviour is observed. The experiment ends with a batch-escape check (a call with 2+
reads must pass) and mandatory deletion of the leftover marker, which would otherwise
grant the next streak a silent free pass.

**How it proves its point:** the same session's event log is the evidence — the gate
records every deny and allow-after-deny, and the counts distinguish the outcomes
unambiguously.

Verify: `npm run --silent flowmap:metrics` (gate table, `turns` row) · protocol and
recorded outcome: `docs/flowmap/SESSION_HANDOFF.md` (and its archive).

## Phase C — prove the gate changes behaviour, not just that it fires

Phases A and B only show the mechanism works. Phase C asks the question that
matters: do gated sessions actually get cheaper? It is an A/B comparison over about
a week of real sessions. Only *post-gate* transcripts count — the pre-gate sessions
would dilute the signal. Success criteria were written down **before** the results
exist (in `turn-baseline.json` → `reassessment.workingMeans`): batch-ratio median
≥ 2.0, main-thread cache-read median at or below half of 7.0M, tokens-to-first-src-edit
< 50k on continue-track sessions, subagent-tokens median > 0. The observed block gets
recorded in `turn-baseline.json` dated, **whether or not the numbers improved** — a
failed enforcement is a finding, not an embarrassment.

### How to re-measure (the exact commands)

```
# one-session smoke check, right after a work session:
npm run flowmap:turns -- check --file ~/.claude/projects/-Users-christopherdasca-Programming-novakai/<session-id>.jsonl

# the real A/B verdict — post-gate sessions only (gate went live 2026-07-04):
mkdir -p /tmp/postgate
find ~/.claude/projects/-Users-christopherdasca-Programming-novakai -name '*.jsonl' -newermt 2026-07-04 -exec cp {} /tmp/postgate/ \;
npm run flowmap:turns -- summary --dir /tmp/postgate
# compare the medians against the "baseline" block in docs/flowmap/turn-baseline.json,
# then add a dated "observed" block to that file either way.
```

Caveat baked into the tooling: `batchRatio` also penalises legitimately serial
Bash-heavy sessions — read the per-session row, not just the exit code.

## The shape of the whole thing

This is the flowmap philosophy applied to the agents themselves: measure first (with
an independent cross-check), test the mechanism (verified by someone who didn't build
it), test predictions empirically before fixing (Phase B), and define success
criteria before looking at the results (Phase C). No step trusts the previous step's
prose — each one is a command anyone can re-run.
