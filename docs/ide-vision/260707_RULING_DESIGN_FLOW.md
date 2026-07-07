# Ruling — the Design tab flow (Chris, 2026-07-07)

Chris's ruling, given after reviewing the shipped K5 Design tab. This OVERRIDES the K5 roadmap
definition's flow summary and EXTENDS KEY_DECISIONS wherever they conflict. The prototype HTML's
Prototypes-tab flow is directionally correct at 75-80% per Chris — closer to intent than the
shipped K5 — but details remain filtered through PROTO_MANIFEST.md (FAKE content still never
ports; real artifacts only in the finished product).

## The flow (binding, in Chris's words, lightly structured)

The Design tab is about creating prototype features — like the Claude Code desktop app's design
experience.

1. The tab opens with a chat box, like talking to AI. The user types the feature or prototype
   they want to build.
2. The AI asks: "Any specifics in mind, or should I put together a draft to refine?" (this copy
   already shipped in K5 and stays).
3. User selects "put together a draft" → the AI creates a list of key assumptions going into the
   build (design choices etc.).
4. User hits "create build" → an HTML window design opens — a rendered, viewable design prototype
   of the feature.
5. Once the user approves the design prototype, they "add to contract" — choosing either an
   EXISTING contract instance or a NEW one.
6. The prototype object is now attached to that contract instance object.

## What this means for in-flight and future work

- K5 as shipped is the correct foundation (one-question copy, assumptions surface, hand-off
  boundary) but is NOT the finished tab. A follow-up work order (K5.1) delivers: chat-box entry,
  assumptions-as-AI-output, "create build" → rendered HTML prototype, approve → "add to contract
  (new or existing)". Whether the AI plumbing is staged (deterministic draft first, real AI via
  the Agents/Home plane later) is decided in K5.1's own design round — the FLOW above is what's
  binding, not the implementation staging.
- K4 (Contracts): a contract instance must be able to carry attached prototype objects, and the
  "add to contract" entry path implies contracts can be CREATED from the Design tab, not only
  from plans. K4's spec must leave this attachment surface open even if K4's first slice doesn't
  render it.
- K8 (Home): the Design tab now has its own scoped chat (prototype-building). K8's spec must
  define Home-chat relative to this: Home is the general "what would you like to know?" entry,
  not the prototype-drafting conversation.
- The open DEFAULT_ASSUMPTIONS ruling (SPEC_DESIGN.md §1 step 3) is superseded in shape: assumptions
  become AI-proposed per-draft content (step 3 of the flow), not a fixed hand-authored dimension set.
  The shipped toggles remain as the interim mechanism until K5.1.

## Amendment 1 (Chris, 2026-07-07): page layout + nomenclature

Reference: `260707_design_tab_prototypes_reference.png` (screenshot of the prototype's page for
this tab (old 'Prototypes' naming), committed alongside this doc).

- Opening the Design tab is NOT just a chat. One page, top to bottom:
  1. Page title (the prototype used "Prototypes").
  2. The chat/outcome input box ("describe an outcome..." with a dim mono `try: ...` hint line).
  3. A saved-designs section (labelled "SAVED PROTOTYPES" in the old screenshot) at the bottom: one row per saved prototype — name on the left;
     on the right a status chip plus a date. Chips seen in the prototype: `in build →` (amber dot,
     links onward to its build/contract) and `draft`.
- Nomenclature (binding): the saved objects are DESIGNS — "designs" is the new name Chris chose,
  and the shipped K5 copy is correct. The prototype HTML predates this ruling and labels them
  "Prototypes" / "SAVED PROTOTYPES"; read the screenshot's labels as historical naming only.
  The rail tab label stays "Design". No rename happens in K5.1.
- Chris flags the screenshot's naming and spacing as "off" — the STRUCTURE is binding (title →
  outcome/chat input with hint line → saved-designs list with status chips and dates), not the
  pixel geometry and not the old labels.
