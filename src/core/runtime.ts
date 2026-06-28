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

// @flowmap-node Runtime kind=type
export interface Runtime {
  editingId: string | null;
  linkSrc: string | null;
  /** type name currently traced; render highlights every node/token using it */
  tracedType: string | null;
}

// @flowmap-node runtime kind=module
export function createRuntime(): Runtime {
  return { editingId: null, linkSrc: null, tracedType: null };
}
