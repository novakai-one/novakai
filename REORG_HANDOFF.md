# src/ reorg — handoff (branch `reorg/src-responsibilities`)

Goal: **filesystem-only** reorg — responsibilities as subdirectories, every `.ts` < 400 lines.
NO behaviour change. Decision (Chris): land the **code split now**; the novakai **map resync is
DEFERRED** to a follow-up (so CI's map gate is expected RED until then).

Everything below is a command to run — do not trust this prose for state.

## See the truth (run these)
```
git log --oneline 975d06f..HEAD          # what has landed
npx tsc --noEmit                          # MUST be exit 0 (code is green)
git status --porcelain | grep -v '^?? contracts/\|^?? designs/draft-name'   # should be empty
for f in $(git diff --name-only 975d06f HEAD | grep '\.ts$'); do wc -l "$f"; done | awk '$1>=400'  # any file still >=400
```

## Done
- `975d06f` — the contract: `docs/novakai/reorg.plan.json` (3 changes: `reorg-unfold`,
  `reorg-io-render`, `reorg-core-ide` — each carries the exact seams + `touches` scope).
- `2fb5ec5` — **Region 1 (unfold)**: `src/panel/unfold/unfold.ts` (was 2683) split in-place into
  `unfold-view*.ts` / `unfold-wires.ts` / `unfold-inspect*.ts` / `unfold-session*.ts` /
  `unfold-stage*.ts`. tsc-green, all < 400. **Map fragment `unfold.novakai.mmd` NOT repathed** (deferred).

## Left to do
1. **Region 2 — io+render**: split `io/layout.ts` `io/mermaid.ts` `render/avoidRouter.ts`
   `render/wires.ts` in place. Seams: `reorg.plan.json` change `reorg-io-render`.
   ⚠ keep `new Worker(new URL('./avoidWorker.ts', import.meta.url))` string verbatim.
2. **Region 3 — core/ide**: split `core/plan/plan.ts` `interaction/pointer.ts`
   `panel/planner/planner.ts` `ide/contracts/contracts-doc.ts` `ide/design-loop-render.ts`.
   Seams: change `reorg-core-ide`.
3. **Phase B — folder moves**: `git mv` the split files into responsibility subdirs + rewrite the
   matching import lines in `src/main.ts` (the ONLY file that imports every module).
4. **Map resync (deferred, required for green CI)**: every `%% src <node> <file>#<sym>` in a
   touched `*.novakai.mmd` must repoint to the symbol's new file, then `npm run novakai:ship`.
   Grep is AMBIGUOUS (e.g. `commit` now lives in 3 files) — have each split-agent EMIT a
   symbol→file manifest and repath from that, do not guess.

## Dispatch recipe that works (hard-won — follow it)
- Subagent Edit/Write is gated by `tools/novakai/gates/edit-gate.mjs`. The spawn prompt MUST carry:
  `NOVAKAI-CONTRACT: <id>` and `NOVAKAI-PLAN: docs/novakai/reorg.plan.json` (else every write is DENIED).
- Run agents in the **main working tree** (NOT `isolation: worktree`) — worktrees branch from base
  `fd211ef` which lacks the contract, so the gate can't resolve it and blocks all writes.
- Keep each agent **small** (one region, or one seam-file for the big ones). Big files (unfold 2683,
  planner 875) balloon an agent past 300k tokens and it drifts/emits off-plan garbage. Tell it to
  **commit the instant `tsc --noEmit` is green — no polish pass**.
- Verify from the tree + `tsc`, never from the agent's final message (contracted-builder reports are
  content-free).
- Regions are disjoint and none touch `main.ts` in the split phase → run them **sequentially** in the
  main tree (parallel-in-one-tree races `tsc`/git index).

## Final gate before PR
```
npm run build        # tsc + vite build — connections + types
npm run test:src     # characterization (deterministic; goldens prove no behaviour change)
npm run novakai:ship # ONLY after map resync — regenerates + gates the map
```
DONE = PR (branch `reorg/src-responsibilities`). Chris merges; do not merge yourself.
Remove this file + `docs/novakai/reorg.plan.json` is a keep-or-drop call at PR time.
