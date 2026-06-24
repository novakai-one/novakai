# src/ — architecture law

`npm run verify` enforces most of this. Read its error; it names the rule.
Fix the code, never the check.

## Non-negotiables
- Containers are conduits. WorkspaceArea and any "Area" only forward events.
  Zero decisions. (gated: depcruise import boundary)
- Uniform shape in/out. Every manager takes and returns the same Payload
  (`DocDraft`; flat view `DocShape`). No bespoke signatures.
- ≤1 caller per module. A second importer needs a one-line
  `SHARED MODULE JUSTIFICATION` in code. (read-checked — no dependents-count gate)
- One responsibility per module. If its job needs an "and", split it.
- `types.ts` holds types only. Values, factories, helpers live in a module.
- State is a last resort. Prefer an instance var or plain value; justify any
  store/hook in one line.

## Door / Worker / Payload — how a manager routes the shape inward
- Payload — the one shape in and out (`DocDraft`; flat `DocShape`).
- Door — a public `receive*`. Takes the Payload, calls the Switch, returns it.
  No unpack, no logic.
- Switch — private router. Reads the trigger, picks one Translator per case.
- Translator — one action. Unpacks with `draftToFlat`, reads only the Fields it
  needs, calls a Worker, folds the result with one Committer, repacks with
  `foldIntoDraft`.
- Worker — pure builder. Takes narrow Fields, returns a piece. Never the Payload.
- Committer — the one method that folds a built piece back.

```
Conduit --Payload--> Door -> Switch -> Translator
  Translator: draftToFlat -> Worker(Fields) -> Committer -> foldIntoDraft
```

- D1 The conduit never unpacks the Payload. (read-checked; depcruise blocks the
  decision-module imports that would let it)
- D2 Public surface is uniform: Payload in, Payload out.
- D3 Only Doors and Translators touch the Payload; Workers take Fields.
  (read-checked)
- D4 Domain logic lives in Workers. Doors and the Switch route only.
- D5 One Committer folds a piece back. A Translator does not re-spread the whole
  shape ad hoc.
- D6 A Worker's signature names its real inputs. No god shape into a Worker.
- D7 Caret + created-id intent flow through the Payload channels
  (`selection.caret`, `created.newBlockIds`), never a side-channel store write.

## Read-checked style
- Named intent: every transform/creation is a named function whose name says it.
- Meaningful names: `(block) =>`, never `(b) =>`.
- CSS in `.css` files, themed via root CSS variables.
