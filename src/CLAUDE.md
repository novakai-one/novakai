# src/ — Architecture & code-style law

These rules govern code under `src/`. Most are enforced by `npm run verify`;
breaking them fails the build. Treat them as law. Fix the code, never the check.

---

## Architecture — non-negotiables

### Containers are conduits. They make ZERO decisions.
WorkspaceArea and any "Area"/container only forwards events. It packages a
uniform shape and hands it to the managers. The managers decide what happens.

Forbidden inside a container:
- `.dispatch(`
- `getState()` to read state and branch on it
- functions named like `createBlockAt`, `deleteX`, `placeY` (these are decisions)
- `if` statements that choose a domain outcome

---
A choice inside a container belongs in a manager. Move it.

### Uniform shapes everywhere.
Every manager receives and returns the SAME shape type.
No bespoke signatures per manager. Same in, same out.

### Coupling: ≤ 1 caller by default.
A module is imported by exactly one parent. A second importer needs a line in
the Design Block: `SHARED MODULE JUSTIFICATION: <why>`. Enforced by `depcruise`.

### One responsibility per module.
If you can't state a module's job in one sentence with no "and", split it.
Prefer many small modules over one large one.

---

## Door / Worker / Payload — method-level law

This governs how a manager routes the uniform shape DOWN into its own methods.
It is the inner half of "uniform shapes everywhere": the boundary is enforced
mechanically; this layer is read-checked (and warned by `verify:conduit`).

### Vocabulary (use these exact words)

- **Payload** — the one uniform shape a manager receives and returns (`DocDraft`;
  its flat view is `DocShape`). Same in, same out.
- **Conduit** — `WorkspaceArea`. Routes events. Makes no decision. Never unpacks
  the Payload.
- **Door** — a manager's public `receive*` method. Takes the Payload, hands it to
  the Switch, returns the Payload. Does NOT unpack. Holds no domain logic.
- **Switch** — the private router a Door calls. Reads the trigger to pick the
  intent. One line per case, each line passing the Payload to one Translator.
  Does NOT unpack.
- **Translator** — a private method for ONE action. Receives the Payload and
  reads only the Fields that action needs off it (`draftToFlat` for the slices,
  `event.data` for the event), calls a Worker, hands the result to a Committer,
  then repacks with `foldIntoDraft`. It may be private; it is the inner Door.
- **Worker** — a pure builder. Takes narrow **Fields**. Returns a block /
  placement / value / slice. NEVER takes the Payload.
- **Committer** — the single method that folds a built piece back into the shape
  (e.g. `_addBlock`).
- **Field** — one value pulled from the Payload (`fileId`, `contentData`, a
  geometry number).
- **Wiring** — mapping Fields to a Worker's params. Lives in the Translator. It
  is not logic.
- **Coupling** — number of importers (repo rule: ≤ 1). **Tightness** — depending
  on internals; cross-module code depends only on the Door, never the internals.

### The shape of every flow

```
Conduit --Payload--> Door.receive*
  Door:        Payload  ->  Switch  ->  Payload          (no unpack at the Door)
    Switch:    trigger  ->  one Translator               (passes the Payload)
      Translator:  draftToFlat (unpack what it needs)  ->  Worker(Fields)
                   ->  Committer(shape, piece)  ->  foldIntoDraft (repack)
        Worker:    Fields in, piece out. Never sees the Payload.
```

### Rules

- **D1** The Conduit never unpacks the Payload. (gated: `verify:conduit`)
- **D2** A manager's public surface is uniform: Payload in, Payload out. No
  bespoke public signatures.
- **D3** Only Doors and Translators touch the Payload. A Worker takes Fields.
  (warned: `verify:conduit` `WORKER_PAYLOAD`; flips to error once the managers
  are triaged — same bootstrap as the eslint caps.)
- **D4** Domain logic lives in Workers. Doors and the Switch route only.
- **D5** One Committer folds a built piece back. A Translator does not re-spread
  the whole shape ad hoc when a Committer fits.
- **D6** A Worker's signature names its real inputs. The Translator may hold the
  Payload and decide what it needs; a Worker may not — no god shape passed into a
  Worker.
- **D7** Caret / created-id intent flows through the Payload channels
  (`selection.caret`, `created.newBlockIds`), never a side-channel store write.

---

## Code style enforced by `npm run verify`

Small functions, small files, no circular deps, coupling limits, conduit purity,
strict types with no `any` leak. The build names the exact rule if you break one.

## Code style I check by reading (not yet mechanized)

1. **Named intent.** Every transform/retrieval/creation uses a named function
   whose name states intent. Readable top-to-bottom without reading line-by-line.
2. **One action set per function**, matching its name. No side errands.
3. **Meaningful variable names.** `file.content.map((block) => ...)`, never `(b) =>`.
4. **Encapsulation.** Public surface matches the module's intent. Nothing public
   that shouldn't be.
5. **Comments enhance, not crutch.** If a comment exists only because the code is
   unclear, rename the code instead.
6. **Readability over brevity.** A junior dev must follow it.
7. **CSS in separate `.css` files**, themed via CSS variables in root.
8. **Types live in `types.ts`.**
9. **State is a last resort.** Don't reach for a hook/store/stateful var unless
   100% necessary. Default to an instance variable or plain value. If you add
   state, justify it in one line.

---

## Product context (so designs fit the vision)

- Databases hold all information. UX containers render it.
- Visual/spatial layout IS data (like a DOM tree). Block position is stored.
- User describes outcomes in natural language; the AI builds the UI and writes
  the formulas. Declarative, not hand-authored formulas.
- Stage 2 (multi-user AI agents) and Stage 3 (integrations) build on this core.
  Clean coupling now prevents breakage later.
