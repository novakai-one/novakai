# Novakai

AI-first declarative workspace (Notion/Excel/Obsidian replacement).
Stack: React + Vite + TypeScript. Storage: Supabase (currently local storage).

Architecture + code-style law lives in `src/CLAUDE.md`. It loads automatically
when you read or edit files under `src/`. Do not duplicate it here.

---

## Workflow (every task)

Default to autonomous execution. Do not stop for approval on a clear task.

For a task that creates or changes a module, work through this Design Block in
your head (do NOT print it and wait for me), then go straight to code:

```
DESIGN BLOCK
- Module: <name>
- Single responsibility (one sentence): <...>
- Public surface (methods/props only): <...>
- Allowed callers (who may import this): <...>
- Shape it receives / returns: <...>
- Rules it could violate + how I avoid them: <...>
```

Trivial task (typo, comment, rename): skip the design block, proceed.

Stop and ask ONE specific question only when a missing decision blocks
correctness — something the code cannot be written without. A naming choice or
a default value is not such a case: pick the obvious option and note it in one
line, then keep going.

A task is NOT done until `npm run verify` passes. Run it and paste the output.
"I believe it passes" is a failure. If it fails twice on the same point, leave
that error and report back after the session.

## Execution boundary

Fix knock-on errors one level out. Stop at the second level.

```
your change  ->  direct knock-on (FIX)  ->  secondary knock-on (STOP, report)
```

Example: a change in WorkspaceArea breaks DragContainer — fix DragContainer.
If fixing DragContainer breaks a third component, leave it and report back.

## Working style

- Work in small verifiable chunks: one module → design block → code → verify → next.
- Mistakes are fine; we fix them. Don't get stuck.

## The guardrails are law

`npm run verify` enforces the architecture and style rules. Read its error — it
names the rule you broke. Never weaken or delete a verify rule to make code pass.
If a rule blocks you and you think it's wrong Fix the code, not the check.

Review against coding standards includes reviewing against coding standards in Claude.md docs && the lint rules.

## Frozen code (spec-driven edits)

Some specs mark code "unchanged", "byte-for-byte", or "frozen".

- Edit by find/replace. Never rewrite a file to regenerate a frozen body.
- The read-checked style rules in `src/CLAUDE.md` (named functions, small
  functions, meaningful names) do NOT apply to a frozen body. Keep it exactly.
- A deliberate cast or `eslint-disable` written into the spec is intentional.
  Keep it verbatim.
- This is not weakening a verify rule. If a frozen body actually fails
  `npm run verify`, do not restyle it to pass — report the failing rule and stop.

## Deeper docs

- `docs/VERIFY_SETUP.md` — what `npm run verify` runs and why.
- `docs/SUPABASE_SETUP.md` — storage setup.
- `docs/BuildPlan/` — roadmap.

## Mandatory updates

- After completion, ensure that novakai.mmd is updated with the correct details.
- Only make changes to .mmd based on the modules that you created or edited.
- file location: /Users/christopherdasca/Programming/NovaKai/Novakai/src/flowmap-mermaid/novakai.mmd
- mnandatory to include last updated date at the 2nd line of mermaid code.

## flowmap-mermaid instructions

2 x Readme located at /Users/christopherdasca/Programming/NovaKai/Novakai/src/flowmap-mermaid/