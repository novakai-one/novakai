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
## 0·now (2026-07-04, session 5) — Phase B executed → Outcome W (unlisted): ALL gate denies were silently non-binding; fixed + proven binding live; subagent metering repaired; NEXT: merge this PR, then Phase C

Phase B ran per the session-4 protocol and found an outcome its X/Y/Z taxonomy didn't list.
**Outcome W:** every flowmap gate (turn, edit, contract, plan) emitted stdout JSON
`decision:"deny"`; the current harness accepts only `approve|block`, fails schema validation,
and downgrades the deny to a non-blocking note — the tool call proceeds. No flowmap gate had
ever actually blocked a live call. Also falsified: the in-flight assistant message is NOT in
the transcript at PreToolUse time (the deny fired on the 5th lone read, naming a streak of 4).
Fixes on branch `m10/phase-b-livefire`: all 4 gates emit `block`; turn-gate retry `>=` → `<=`
(alternating-throttle semantics pinned by a growing-transcript test); turns.mjs subagent-token
parsing handles the new `<subagent_tokens>` form, deduped by tool-use-id. After the fix, the
full cycle — binding deny on the 5th lone read → identical retry allowed via marker → batch
passes — was observed live in this session. Durable edges promoted to KNOWN_EDGES.md
(harness `block` vocabulary; hook-fires-before-message timing; transcript format drift).
Session-4 entry archived verbatim in handoff-archive.md.

| What | Verify it yourself | Expect |
|---|---|---|
| gates speak harness vocabulary | `grep -n "decision: 'block'" tools/flowmap/*-gate.mjs` | 4 gates, 1 hit each |
| retry semantics pinned | `node --test tools/flowmap/turn-gate.test.mjs` | 8 pass, incl. growing-transcript test |
| binding deny observed live | `grep '"gate":"turns"' docs/flowmap/metrics/session-log.jsonl \| tail -5` | deny → allow-after-deny pairs at 2026-07-04T08:2x |
| hookTiming falsification recorded | `node -p "JSON.parse(require('fs').readFileSync('docs/flowmap/turn-baseline.json','utf8')).validation.hookTiming"` | original claim + FALSIFIED 2026-07-04 |
| subagent tokens meter again | `npm run flowmap:turns -- check --file ~/.claude/projects/-Users-christopherdasca-Programming-novakai/870eb983-2e01-478a-b206-3c5244de9ad1.jsonl --json` | subagentTokens ≥ 295208 (≥6 spawns) |
| phase narrative doc | `cat docs/flowmap/turn-discipline.md` | phases 0/A/B/C, command-anchored, re-measure recipe |
| full suites | `npm run spec:test:all` | green — on THIS branch's commit (mutate corpus-freshness diffs vs HEAD, red only while uncommitted) |

**Measured this session (subagent economics, from the usage tags):** 6 spawns ≈ 295k subagent
tokens total — small read-only audits ≈ 29-36k, medium build/fix tasks ≈ 52-77k — vs the 7.0M
median cache-read bill of a main-thread session. **Limit found (probe, this session):** the
turn-gate does NOT bind subagent sidechains (7 consecutive lone reads, 0 denials, no marker)
— the gate disciplines the main thread only; delegation itself is measured (subagentTokens),
never forced by any hook.

**Next 1 — merge:** review + merge the `m10/phase-b-livefire` PR. The BINDING gates go live
for every session started after that merge — before it, denies are decorative.

**Next 2 — Phase C effectiveness A/B (over ~1 week of sessions started AFTER the merge):**
- n=1 smoke after a real work session: `npm run flowmap:turns -- check --file ~/.claude/projects/-Users-christopherdasca-Programming-novakai/<session>.jsonl` (exit 0 = targets met; caveat: batchRatio also penalizes legitimately serial Bash-heavy sessions — read the row, not just the exit code).
- Real verdict: copy ONLY post-merge transcripts (mtime after the PR merge — the earlier
  2026-07-04 cut is WRONG now: it includes sessions where denies did not bind) to a scratch
  dir, then `npm run flowmap:turns -- summary --dir <dir>`; compare medians vs the baseline
  block in docs/flowmap/turn-baseline.json (working means: batchRatio ≥2.0 · cacheRead ≤~3.5M ·
  toFirstSrcEdit <50k continue-track · subagentTokens >0). Do NOT judge from the unscoped
  summary — it blends the pre-gate sessions.
- Record a dated `observed` block in turn-baseline.json either way (the file mandates keeping
  poorer numbers as findings).

**Carried:** M9 (W6) recorded demo per docs/flowmap/demo/prep/recording-protocol.md.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
