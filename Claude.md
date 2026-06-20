# CLAUDE.md — Novakai

This file governs how you work in this repo. Read it fully before any task.
You are building an AI-first declarative workspace (Notion/Excel/Obsidian replacement).
Stack: React + Vite + TypeScript, Supabase (currently local storage).

---

## 0. THE WORKFLOW GATE (do this every task — no exceptions)

You do NOT start writing implementation code immediately. For ANY task that
creates or changes a module, you first output a **Design Block** and STOP for
my approval:

```
DESIGN BLOCK
- Module: <name>
- Single responsibility (one sentence): <...>
- Public surface (methods/props only): <...>
- Allowed callers (who may import this): <...>
- Shape it receives / returns: <...>
- Rules it could violate + how I avoid them: <...>
```

Only after I reply "approved" do you write code. If a task is trivial
(typo, comment, rename) say "trivial — skipping design block" and proceed.

When you finish ANY code, the task is NOT done until you have run:

```
npm run verify
```

and pasted the output showing it passes. "I believe it passes" is a failure.
Run it. If it fails, fix it and run again.
If you get stuck at a point for 2 failures on same point you can leave the error and report back once you have finished.

---

Do not spend more than 10 seconds planning without executing. You will get stuck when you already have enough information.

You have permission to make mistakes as we can then fix them

---

Execution Boundary

You have permission to make changes in knock-on modules.

E.g. changes in workspace area cause a knock on effect with errros in Drag Container that need fixing.

Fix them.

Do not step into secondary-knock on effects. Leave the error and report back after work session.

workspace area -> Drag Container -> Secondary knock-on. Causes error in another class / component. =  secondary. Stop at secondary.

---

## 1. ARCHITECTURE — THE NON-NEGOTIABLES

These are the rules you most often break. They are mechanically enforced by
`npm run verify`. Breaking them fails the build. Treat them as law.

### 1.1 WorkspaceArea is a CONDUIT. It makes ZERO decisions.
WorkspaceArea (and any "Area"/container) only forwards events. It NEVER
decides *what* should happen. It packages a uniform shape and hands it to the
managers, who decide.

❌ FORBIDDEN inside WorkspaceArea / container components:
- calling `.dispatch(`
- calling `getState()` to read app state and branch on it
- any function named like `createBlockAt`, `deleteX`, `placeY` — these are decisions
- `if` statements that choose a domain outcome

✅ REQUIRED pattern — uniform fan-out, no branching on outcome:
```ts
const route = (channel, data, trigger) => {
  let shape = buildShape()              // package only
  shape = bm.receiveMouseEvent(d, trigger, shape)
  shape = sm.receiveMouseEvent(d, trigger, shape)
  shape = dm.receiveMouseEvent(d, trigger, shape)
  shape = lm.receiveMouseEvent(d, trigger, shape)
  commit(shape)                          // hand off, never decide
}
```
The container forwards; the managers decide. If you find yourself making a
choice inside a container, the choice belongs in a manager. Move it.

### 1.2 Uniform shapes everywhere.
Every manager receives and returns the SAME shape type (e.g. `DocShape`).
No bespoke signatures per manager. Same in, same out. This is what makes the
fan-out above legal and bug-resistant.

### 1.3 Coupling: ≤ 1 caller by default.
A module should be imported by exactly one parent. If a module needs more than
one caller, you must STOP and put this in your Design Block:
`SHARED MODULE JUSTIFICATION: <why it must be shared>`.
Enforced by `depcruise`. Adding a second importer without justification fails
the build.

### 1.4 One responsibility per module.
If you cannot state a module's job in ONE sentence with no "and", it is doing
too much. Split it. A helper file/class that gets folded back into the parent
is correct and expected — prefer many small modules over one large one.

---

## 2. CODE STYLE — ENFORCED

| Rule | Mechanically checked by |
|---|---|
| Functions stay small (1 job) | eslint `max-lines-per-function`, `complexity` |
| Files stay small | eslint `max-lines` |
| No circular deps | `depcruise` `no-circular` |
| Coupling limits (1.3) | `depcruise` custom rules |
| Conduit purity (1.1) | grep gate in `verify` |
| Strict types, no `any` leak | `tsc --noEmit`, eslint `no-explicit-any` |

`npm run verify` runs ALL of the above. If it passes, your code is compliant.
If it fails, read the error — it tells you exactly which rule you broke.

---

## 3. STYLE RULES NOT YET MECHANIZED (still law)

You must follow these even though no tool catches them. I check by reading.

1. **Named intent.** Every data transform/retrieval/creation uses a named
   function whose name states intent. A reader skims top-to-bottom and
   understands without reading line-by-line.
2. **One action set per function**, matching its name. No side errands.
3. **Meaningful variable names.** `file.content.map((block) => ...)`,
   never `(b) =>`.
4. **Encapsulation.** Public surface must match the module's intent. Nothing
   public that shouldn't be.
5. **Comments enhance, not crutch.** If a comment exists only because the code
   is unclear, rename the code instead.
6. **Readability over brevity.** A junior dev must follow it. Keep behaviour
   high-quality; keep the prose simple.
7. **CSS in separate `.css` files**, themed via CSS variables in root.
8. **Types live in `types.ts`.**
9. **State is a last resort.** Do NOT reach for a hook/store/stateful var
   unless it is 100% necessary. Default to an instance variable or plain
   value. If you add state, justify it in one line.

---

## 4. HOW TO BEHAVE DURING LONG RUNS

- Work in small verifiable chunks. One module → design block → code → verify →
  next. Do not batch five modules before verifying.
- When in doubt about a design choice, STOP and ask in one line. Do not guess
  and build 300 lines on a wrong assumption.
- Never weaken or delete a rule in `npm run verify` to make your code pass.
  If a rule blocks you and you think it's wrong, say so and wait. Editing the
  guardrail to pass is the single worst thing you can do here.
- If you broke a rule, fix the code, not the check.

---

## 5. PRODUCT CONTEXT (so your designs fit the vision)

- Databases hold all information. UX containers render it.
- Visual/spatial layout IS data (like a DOM tree). Block position is stored.
- User describes outcomes in natural language; the AI builds the workspace UI
  and writes the formulas. Declarative, not formula-authoring by hand.
- Keep modules clean because Stage 2 (multi-user AI agents) and Stage 3
  (integrations) build directly on this core. Sloppy coupling now = breakage
  later.