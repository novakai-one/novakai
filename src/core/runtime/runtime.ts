/* =====================================================================
   runtime.ts — shared mutable interaction flags
   ---------------------------------------------------------------------
   Responsibility: a tiny bag of cross-cutting transient flags that the
   render layer must read but the interaction layer owns/writes:
     • editingId — node currently in inline label edit (render keeps the
       contenteditable alive across re-renders),
     • linkSrc   — source node during click-click link mode (render adds
       the .linksrc highlight class).

   Kept separate from AppContext to make the render→interaction read
   relationship explicit and cycle-free. Interaction writes; render reads.
   ===================================================================== */

export interface Runtime {
  editingId: string | null;
  linkSrc: string | null;
  /** type name currently traced; render highlights every node/token using it */
  tracedType: string | null;
  /**
   * Focus-mode spine: the set of node ids in the active call spine. When
   * non-null, classFor dims every other rendered node (`focus-dim`) and
   * highlights the spine members (`focus-hit`). Null = focus mode off.
   */
  focusSpine: Set<string> | null;
}

export function createRuntime(): Runtime {
  return { editingId: null, linkSrc: null, tracedType: null, focusSpine: null };
}
