

Claudes plan:

Updated missing list.
Now covered (scaffolded or done):
DOM root             -> setWorkspaceEl ✓
block order          -> shape.file.content ✓
full keyboard map    -> done (logic placeholders inside)
highlight paint      -> module exists (range resolve placeholder)
clipboard surface    -> scaffolded
Still missing:
1. block-selection store   -> rubber-band multi-block. subscribe/snapshot/clear.
                              useSyncExternalStore surface. NOT built.
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


## My input:

rubber-band multi-block. Does not need to be in state. CSS rubber band only for visual.
                        -> Drag features can be handled with a variable being passed back to WSA when the    
                        time comes. Placeholders for now.


Major architectural difference that leads to a significant change in code design quality.