# Novakai

AI-first declarative workspace (Notion/Excel/Obsidian replacement).
React + Vite + TypeScript; Supabase storage (local for now).

- Architecture + style law: `src/CLAUDE.md` (auto-loads on `src/` edits).
- Per-unit design: that folder's `flowmap.mmd`, co-located at `src/<folder>/flowmap.mmd`
  (grammar: `src/flowmap-mermaid/README-SyntaxCreator.md`; bundle/authoring rules: `docs/flowmap/FRAGMENT_SPEC.md`, `docs/flowmap/AUTHORING_GUIDE.md`).

## Every task
- Done only when `npm run verify` passes. Run it; paste the output.
- Fix direct knock-on errors one level out; stop and report at the second level.
- Ask one question only when a missing decision blocks correctness. Otherwise
  pick the obvious option, note it in one line, continue.

## After any module change
- Update the touched folder's `src/<folder>/flowmap.mmd` (author from code; any pre-existing `.mmd` is stale), then re-bundle: `npm run flowmap:bundle && npm run flowmap:validate` -> PASS.
- Put the last-updated date on line 2 of the mermaid code.
- include date modified date using date in Melbourne, Australia GMT+10 //Last modified: 
