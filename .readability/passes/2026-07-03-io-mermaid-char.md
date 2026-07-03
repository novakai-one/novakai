# M6 characterization pass — src/io/mermaid.ts

Exports covered (all 3, none skipped):
- `parseGroupDirective` — group decl, group decl+parent, group-member, non-match.
- `fromMermaid` — empty input; basic nodes/edges with auto-placement; full
  metadata (`fm`, `kind`, `parent`, `root`, edge ortho/bend/labelpos, group);
  subgraph block + `end` popping the group stack; dangling group-parent and
  dangling group-membership pruning; 4-column auto-placement wrap.
- `initMermaid` (`toMermaid`, `sync`, `applyText`) — exercised with a fake
  `ctx`/`selection` (plain objects, no real DOM needed since the module only
  reads `ctx.state`, `ctx.dom.mmd.value`, and calls three `ctx.hooks`):
  metadata-then-nodes-then-edges emission order, `only` filter, group/
  subgraph + ortho/bend/labelPos edge output, `sync` writing into
  `mmd.value`, and `applyText`'s three branches (success, "No nodes
  parsed", and the catch-all "Parse error" path).

No exports skipped — none require a real DOM element beyond a plain
`{ value }` object already covered above.

Test count: 17, all green. `npm run test:src` added as
`node --import tsx --test tests/characterization/*.test.ts` (directory-only
discovery didn't find `.ts` files, so switched to an explicit glob).
