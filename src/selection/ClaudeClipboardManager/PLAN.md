# ClipboardManager — Plan

## Contract (reliable)

```
receiveEvent(eventData, reactEvent, trigger: string, shape: DocShape) -> DocShape
```

- `receiveEvent` is the ONLY public method.
- Return is always a `DocShape`.
- copy/cut return `shape` unchanged (they only fill the internal buffer).
- paste returns a NEW `shape` with pasted blocks merged in.

## What clipboard stores

A `DocShape` slice — NOT the html/tag `ClipboardBlockData` shape (that type is
not trusted). The buffer holds:

- `contentData`  — the selected `TextElement` records.
- `layoutData`   — the `LayoutItem` records for those blocks.
- `databaseData` — `DatabaseConfiguration` only if a selected block is a DatabaseArea.
- `file`         — NOT stored. Paste targets `shape.file` (the active file).

## Trigger routing (private)

```
trigger string  -->  receiveEvent  -->  one private path
  "copy"   -> copy(shape, selection)
  "cut"    -> cut(shape, selection)
  "paste"  -> paste(shape)
  "clear"  -> clear()
```

Trigger strings above are PLACEHOLDER — confirm the exact strings SM sends.

## File layout

```
ClipboardManager.ts   public class — only receiveEvent(), routes by trigger
clipboardStore.ts     internal buffer (held slice + mode), hold/read/clear
copy.ts               builds a DocShape slice from the selected ids
paste.ts              decides placement, merges buffer slice into shape
ids.ts                regenerateIds for pasted blocks (avoid collisions)
serialize.ts          slice <-> plain object (placeholder, future cross-tab)
```

## Responsibility per module

- `ClipboardManager.ts` — routing only, no logic.
- `clipboardStore.ts` — owns the buffer. hold / read / clear / hasContent (private use).
- `copy.ts` — read selected ids, pull records into a slice.
- `paste.ts` — placement decision lives here (clipboard decides where).
- `ids.ts` — new ids on paste so copies never collide with source.
- `serialize.ts` — only needed for JSON / cross-tab. Placeholder for now.

## STATE AFTER BUILD

Resolved during build (matched against reliable types):
- Storage shape — confirmed: buffer holds a `DocShape` slice minus `file`.
  `contentData` + `layoutData` (keyed `fileId:blockId`) + `databaseData`.
- Database blocks — `block.component === "DatabaseArea"` is the test for
  pulling a `DatabaseConfiguration`. Confirmed against TextElement.component.
- Keys — using `layoutKey(fileId, blockId)` and `databaseKey(blockId)` from
  types.ts, not hand-rolled strings.
- Immutability — paste shallow-copies all three datasets + the file before
  writing, returns a new shape. React diff sees new identities.

## OPEN PLACEHOLDERS (your decisions — not mine to invent)

1. SELECTION SOURCE — `KeyEventData` carries ONE `blockId`, not a set.
   Where does the list of selected block ids come from?
   - Option A: SM passes them inside `eventData`.
   - Option B: clipboard reads them off `shape` somehow.
   Currently: `readSelectedIds()` reads `eventData.selectedIds[]` if present,
   else falls back to `eventData.blockId`. Confirm the real field.

2. TRIGGER STRINGS — exact strings for copy / cut / paste / clear unknown.
   Using placeholder literals in the `TRIGGER` const in ClipboardManager.ts
   ("clipboard-copy" / "-cut" / "-paste" / "-clear").

3. PASTE PLACEMENT RULE — clipboard decides where. Current placeholder:
   stack pasted blocks below the anchor's bottom edge, `PASTE_Y_GAP = 40px`
   between each. Confirm the real rule (below caret? below selection? overlap
   push handled by LayoutManager instead?).

4. PASTE ANCHOR — paste needs a reference row. `eventData.blockId` is the
   block under the caret at paste time — used as anchor (placeholder).

5. CUT DELETION — does cut delete source on cut, or on the following paste?
   Current placeholder: cut copies + records sourceIds + mode="cut". NO
   deletion happens yet (cut.ts returns shape unchanged; paste cut-cleanup is
   a commented stub). Removing a block needs its layout + content-order entry
   pulled and the hole closed — that is LayoutManager's job, so clipboard
   should likely signal the delete, not perform it. Confirm the boundary.

6. ID FACTORY — `ids.ts newId()` uses a placeholder random id. Swap for the
   project's real id factory so pasted ids match the existing scheme.

7. NESTED REMAP — `children[]` (block nesting) and database row `cells` both
   hold ids that would need remapping through `idMap` on paste. Flat blocks
   only today (children null), so deferred. `idMap` is already returned by
   `regenerateIds` for when this lands.
