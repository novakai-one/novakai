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
## 0·now (2026-07-04, session 7) — PR3: `tools/flowmap/` reorganised into 6 sub-folders (onboard/verify/plan/contract/status/gates + lib/, tests colocated), stacked on `reorg/buildspec`; NEXT: merge PR2 then this PR3 (retarget to main)

Pure `git mv` reorg — no logic or formatting changes, only path strings. Every file under
`tools/flowmap/` moved into `onboard/ verify/ plan/ contract/ status/ gates/` (tests
colocated with their source); `lib/` is unchanged except `canonical.test.mjs` moved in
beside `canonical.mjs`. Every authored edit is a path string: intra-flowmap relative
imports (`./lib/…` → `../lib/…`), flowmap→buildspec imports (one extra `../` for the new
depth), CLI-spawn args in both forms — string-literal (`'tools/flowmap/x.mjs'`) and
multi-arg (`join('tools','flowmap',...)`, which a plain string grep does not catch and
needed a second pass), `HERE`-relative `ROOT` computations (`join(HERE,'..','..')` →
one more `'..'` for every file now one folder deeper — caught a handful of cross-folder
CLI refs this way, e.g. `edit-gate.mjs` spawning `quiz.mjs`, now `../onboard/quiz.mjs`),
`%% src` pointers in the moved `*.flowmap.mmd` fragments plus `docs/flowmap/_tooling.mmd`
(regenerated via `flowmap:tooling:bundle`, never hand-edited — hand-editing it first did
not byte-match the real bundler and had to be redone), `docs/flowmap/roadmap.json`
predicates (including one bracket-escaped regex a plain-string pass missed — F5's
`tools/flowmap/loop-e2e[.]test[.]mjs` check), `docs/flowmap/tooling-curation-allowlist.txt`,
root `package.json` (~40 `flowmap:*` scripts + `spec:test:all`), and every
`tools/flowmap/*` hook `command` in `.claude/settings.json`.

Three tests are unavoidably red until this reorg is committed — they assert against
**committed** git state (`git log -1 -- <path>`, `git show HEAD:<path>`, a
`git worktree add … HEAD`), so a pre-commit HEAD (still holding the old paths) cannot
satisfy them: `handoff-fresh.test.mjs`'s "flags a real committed file" fixture,
`mutate.test.mjs`'s corpus-freshness check, and `onboard.test.mjs`'s F-17 doctored-worktree
test. This is the same documented pattern the session-6 entry's full-suite row already
carried ("red only while uncommitted") — not a new problem, just the same one hitting a
different set of tests this time. All three are expected to flip green on this branch's
first commit.

| What | Verify it yourself | Expect |
|---|---|---|
| moves are pure renames | `git diff -M --stat HEAD~1` (after this session's commit) | every moved file shows as a `{old => new}` rename |
| full suite (post-commit) | `npm run spec:test:all` | 0 fail |
| map trustworthy | `npm run flowmap:onboard` | reaches "Onboarding ready. The map is trustworthy" |
| tooling self-map, freshly regenerated | `npm run flowmap:tooling:verify` | DETERMINISTIC + FRESH + VALID + ARCHITECTURAL + COMPLETE |
| roadmap predicates all resolve | `npm run flowmap:roadmap` | all items BUILT (post-commit; A4/F4/F5/H5 show PARTIAL pre-commit only, for the reason above) |
| no stale hook paths | `grep -n "tools/flowmap/" .claude/settings.json` | every command carries a sub-folder (`gates/`, `verify/`, `status/`) |
| no stale script paths | `grep -n "tools/flowmap/" package.json \| grep -vE "flowmap/(onboard\|verify\|plan\|contract\|status\|gates\|lib)/"` | empty |

**Next 1 — merge order:** PR2 (`reorg/buildspec`) lands first; this PR3 (`reorg/flowmap`,
stacked on it) is retargeted to `main` and merged second.

**Next 2 — M9 demo (carried from session 6, still open):** recorded demo per
docs/flowmap/demo/prep/recording-protocol.md.

**Postponed (Chris, 2026-07-04): Phase C effectiveness A/B** — non-blocking for MVP;
unchanged by this reorg. Recipe in handoff-archive.md session-5 entry + turn-baseline.json
`reassessment`.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
