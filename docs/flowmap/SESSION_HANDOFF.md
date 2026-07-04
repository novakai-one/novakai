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
## 0·now (2026-07-04, session 6) — M10 residuals closed on `m10/gate-residuals`: bounce fixed (frozen-window grace), sidechains BIND (two stacked root causes found live), non-blocking reminder hooks live; NEXT: merge PR, then M9 demo (Phase C postponed per Chris)

All four session-5 residuals landed, each live-fire proven in THIS session. Two findings the
plan's premises did not predict:
**(1) The post-retry bounce could not be fixed by a plain one-shot token** — every read of a
still-unpersisted batch fires against a frozen transcript, so a single token just moves the
bounce to the batch's 2nd read. Fix: allow-after-deny rewrites the marker as a grace snapshot
`{session, grace, calls, streak}`; any call whose transcript state advanced ≤1 from the
snapshot passes as `allow-grace` (whole frozen window), any further lone-read turn re-arms
deny. Ceiling (documented in-code): defiant lone-read streams now see deny-1-in-3, not 1-in-2.
**(2) Sidechain non-binding had TWO stacked causes**, root-caused via a new flag-file payload
capture (`touch .flowmap-gate-debug`): (a) sidechain payloads carry the MAIN transcript path —
the gate now remaps to `<dir>/<sessionId>/subagents/agent-<agent_id>.jsonl` (live payload has
`agent_id`; the documented `isSidechain` field DOES NOT EXIST); (b) sidechain transcripts
persist the in-flight message's zero-tool lines BEFORE PreToolUse fires (opposite of main) —
without trailing-partial trimming the streak reads 0 forever. Both fixed; deny → retry →
allow-grace observed live inside a real subagent. Markers are now per-agent. Reminder hooks
(subagent-priority / batch-reads, rotating, every 2nd main-thread Bash, `FLOWMAP_REMINDER_EVERY`)
were picked up by the settings watcher mid-session and observed injecting live, schema-valid,
zero permission side effects. New durable edges promoted to KNOWN_EDGES.md. Session-5 entry
archived verbatim in handoff-archive.md.

| What | Verify it yourself | Expect |
|---|---|---|
| bounce fixed + cadence pinned | `node --test tools/flowmap/turn-gate.test.mjs` | 14 pass, incl. bounce-repro (allow-grace where the deny bounced) + defiant cadence deny,allow,allow,deny |
| sidechain binding pinned | same suite | T3 sidechain deny + T3b trailing-partial (the live silent-allow shape) + T3c main-thread contrast |
| sidechain deny observed live | `grep 'turn-gate.mjs' docs/flowmap/metrics/session-log.jsonl \| grep '"agent":"ac2' \| tail -3` | deny → allow-after-deny → allow-grace at 2026-07-04T10:44, agent ac20153a728253a74 |
| reminder hook non-blocking by construction | `node --test tools/flowmap/reminder-hook.test.mjs` | 9 pass, incl. schema-safety (only hookSpecificOutput/additionalContext, never a decision field) |
| reminder hook registered | `grep -n "reminder-hook" .claude/settings.json` | PreToolUse matcher Bash |
| new tool mapped | `npm run flowmap:tooling:verify` | green, reminder-hook node present |
| payload-capture knob | `grep -n "flowmap-gate-debug" tools/flowmap/turn-gate.mjs` | flag-file guarded, never affects decisions |
| sidechain root-cause recorded | `node -p "JSON.parse(require('fs').readFileSync('docs/flowmap/turn-baseline.json','utf8')).validation.sidechainBinding"` | falsified → root-caused → fixed, dated |
| full suites | `npm run spec:test:all` | 0 fail (346 tests) — on THIS branch's commit (mutate corpus-freshness diffs vs HEAD, red only while uncommitted) |

**Simple working check (one command):**
`node --test tools/flowmap/turn-gate.test.mjs tools/flowmap/reminder-hook.test.mjs` → 23 pass, 0 fail.

**Next 1 — merge:** review + merge the `m10/gate-residuals` PR. Sidechain binding and the
reminder hooks arm for every session after the merge (and immediately in any session whose
settings watcher reloads).

**Next 2 — M9 demo (carried, now unblocked):** recorded demo per
docs/flowmap/demo/prep/recording-protocol.md.

**Postponed (Chris, 2026-07-04): Phase C effectiveness A/B** — non-blocking for MVP. When
resumed: only sessions started AFTER this merge count (earlier sessions blend non-binding
denies AND unbound sidechains); recipe unchanged in handoff-archive.md session-5 entry +
turn-baseline.json `reassessment`.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
