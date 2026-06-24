# Novakai

AI-first declarative workspace (Notion/Excel/Obsidian replacement).
React + Vite + TypeScript; Supabase storage (local for now).

- Architecture + style law: `src/CLAUDE.md` (auto-loads on `src/` edits).
- Per-unit design: the unit's `.mmd` in `src/flowmap-mermaid/`
  (grammar: `README-SyntaxCreator.md`).

## Every task
- Done only when `npm run verify` passes. Run it; paste the output.
- Fix direct knock-on errors one level out; stop and report at the second level.
- Ask one question only when a missing decision blocks correctness. Otherwise
  pick the obvious option, note it in one line, continue.

## After any module change
- Update `src/flowmap-mermaid/novakai.mmd` for the modules you touched.
- Put the last-updated date on line 2 of the mermaid code.
