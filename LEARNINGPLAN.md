
9th June:
- Types -> make them as uniform as possible -> create similar interfac using id, name, kind etc. so there are commonalities.
- Narrow the type using the "kind" property to simplify things.
- When changing types and rebuilding -> trying to patch things in can make it worse. Sometimes its easier to open a new file and start from scratch otherwise it becomes a mess thats impossible to follow (obviously depends on file size and size of type change)

8th June:
Difficulties with CSS:
- Flex: 1 on left-panel but trying to set animations for smooth in and out.
- Setting width: 200px seems to clash with flex as 2 things controlling. Unsure on proper design.

Position absolute fixed on toggle so that it went to ancestor. Learnt that absolute requires root to ahve relative.
Don;t understand the implcaiton of of what MDN docs are saying:
- This value creates a new stacking context when the value of z-index is not auto. The margins of absolutely positioned boxes do not collapse with other margins.

Unclear why header font size is not adjusting to what I write -> shows up in dev tools and yet never changes.
