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
