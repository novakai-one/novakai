# Session handoff — verifiable, not prose

> **New agent: do not trust this document. Run `npm run flowmap:onboard` first.**
> Everything below is either a *runnable claim* (a command + expected result you
> can execute) or clearly-labelled *intent* (the remaining roadmap). The verified
> state of the app lives in the tools, not in this file.

## 0. Start here

```
npm run flowmap:onboard
```

Proves the map is true + complete as of HEAD, prints the 3 invariants, hands you the
quiz. Prove your read before any design claim:

```
npm run flowmap:quiz -- generate --n 12 --seed 1
# answer each from docs/flowmap/_bundle.mmd only, write answers.json, then:
npm run flowmap:quiz -- check --answers answers.json --seed 1   # 100% = handover trusted
```
## 0·now (2026-07-04, session 3) — M10 turn-discipline: MEASURE (flowmap:turns) + FORCE (turn-gate PreToolUse hook), baseline recorded

Branch `m10/turn-discipline` (7 commits on top of c43b460, red-then-green per tool; src/
untouched). Measured driver: agents ran ~1.26 tool calls per API turn and ~99% of session
tokens were cache re-reads; median 3.18M context tokens burned before the first src/ edit.
The session-2 entry (M9 prep, PRs #42-#45) is archived verbatim in handoff-archive.md;
its Next still stands and is carried below.

| What | Verify it yourself | Expect |
|---|---|---|
| MEASURE over real sessions | `npm run --silent flowmap:turns -- summary` | per-session table + medians (batchRatio ~1.28, self-describing target lines) |
| FORCE hook wired | `grep -n "turn-gate" .claude/settings.json` | PreToolUse matcher Read\|Grep\|Glob |
| gate behavior proven | `node --test tools/flowmap/turn-gate.test.mjs` | pass: deny at streak 4, one-free-retry marker, fail-open cases |
| one parser, no drift | `grep -l "lib/transcript.mjs" tools/flowmap/turns.mjs tools/flowmap/turn-gate.mjs` | both files |
| baseline + reassessment protocol | `cat docs/flowmap/turn-baseline.json` | methodology, targets (batchRatio >=2.0, toFirstSrcEdit <50k), validation record |
| dashboard integrated | `npm run --silent flowmap:metrics` | gate table gains `turns` row + turn-discipline tail line |
| tooling map complete | `npm run flowmap:tooling:verify` | DONE (new modules mapped under co_metrics) |
| full suites | `npm run spec:test:all` | pass (includes turns + turn-gate) |

**Next:** (carried from session 2) merge #45, then M9 (W6) recorded demo per
docs/flowmap/demo/prep/recording-protocol.md. New: review + merge `m10/turn-discipline`;
the gate goes live for the next session in this repo. After ~1 week of sessions, run the
reassessment in turn-baseline.json (`npm run flowmap:turns -- summary` vs its baseline
block) — record the observed numbers in that file whether they improved or not.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
