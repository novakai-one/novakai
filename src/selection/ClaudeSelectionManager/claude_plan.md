Version 1
Last updated: 20th June 2026


Done. All inside ClaudeSelectionManager. Nothing outside touched.
Built this round:
highlightRenderer.ts -> CSS.highlights paint (no re-render). buildResolvedRange placeholder
caretNavigation.ts   -> plain arrows × 4 directions (placeholders)
selectionExtend.ts   -> shift × 4, cmd-shift × 4, selectAll (placeholders)
keyHandlers.ts       -> full command map: Tab/Esc/copy/paste/selectAll/arrows. owns preventDefault
clipboard.ts         -> ClipboardController scaffolding (copy/paste/insertAtCaret/selectedText)
router.ts            -> threads blockOrder + key hooks
NEWSelectionManager.ts -> setWorkspaceEl, blockOrder from shape.file.content, paint per event, key hooks
Design decisions held:

Block order = shape.file.content. No DOM order reads.
Highlight paints pixels, not state. Blocks never told.
keyHandlers pure for selection; impure clipboard/clear passed as hooks.
Paste deferred to BlockManager via BlockEvent (placeholder), not done in SM.

---

Original work list updated.

Updated missing list:
Now covered (scaffolded or done):
DOM root             -> setWorkspaceEl ✓
block order          -> shape.file.content ✓
full keyboard map    -> done (logic placeholders inside)
highlight paint      -> module exists (range resolve placeholder)
clipboard surface    -> scaffolded


Still missing:
1. block-selection store   -> rubber-band multi-block. Does not need to be in state. CSS rubber band only for visual.
                        -> Drag features can be handled with a variable being passed back to WSA when the    
                        time comes. Placeholders for now.
2. programmatic focus       -> focusBlockStart / focusBlockEnd (post-edit caret). NOT built.
3. structural callbacks     -> registerPastedBlocksHandler etc. Deferred to BlockEvent path.
4. mouse rubber-band        -> mouseHandlers only does text-range drag, not block select.

Still placeholder (built, logic empty):
- domHelpers: pointToPosition / positionToCoords / getElementText
- buildResolvedRange (cross-block range flatten)
- all caret + extend movement math
- clipboard: all four methods
- buildShape: edit application
Deliberately excluded (your call):
- blur content commit (_commitContent) — you flagged as bad design
One open design question stands.

Rubber-band block selection (item 1 + 4) needs a store that React subscribes to. That store is stateful and does trigger re-render — unlike the highlight. It is the one selection concern that crosses back into React. Decide later whether it lives in SM or in a separate store WSA owns.