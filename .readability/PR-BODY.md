## Module totals: baseline (m6/setup) vs now (m6/integration)

| Module | Baseline | Now | Delta |
| --- | ---: | ---: | ---: |
| src/core | 199 | 199 | 0 |
| src/panel | 579 | 284 | -295 |
| src/interaction | 139 | 85 | -54 |
| src/render | 105 | 92 | -13 |
| src/io | 190 | 111 | -79 |
| src/main.ts | 7 | 7 | 0 |
| tools | 1060 | 960 | -100 |
| **Total** | **2279** | **1738** | **-541** |

## Pass list (`git log --oneline m6/setup..m6/integration`)

```
c326496 refactor(m6): src/render/wires.ts readability pass
18b55bd refactor(m6): src/panel/unfold.ts readability pass
d85c4ef refactor(m6): src/panel/unfold.ts readability pass
6aaed71 refactor(m6): src/io/layout.ts readability pass
8b712a4 docs(m6): failure reports
b2616ce refactor(m6): src/interaction/pointer.ts readability pass
dc94f63 refactor(m6): src/interaction/pointer.ts readability pass
ca5f03c refactor(m6): src/io/mermaid.ts readability pass
f9347dc refactor(m6): src/panel/unfold.ts readability pass
66f187a refactor(m6): src/panel/unfold.ts readability pass
1148e84 refactor(m6): tools/flowmap/bundle.mjs readability pass
03024c9 refactor(m6): src/render/wires.ts readability pass
44c069b refactor(m6): src/render/wires.ts readability pass
9b9e680 docs(m6): failure reports
99851b1 refactor(m6): src/render/wires.ts readability pass
f139c5f refactor(m6): tools/buildspec/mmd-parse.mjs readability pass
68c88d0 refactor(m6): src/io/layout.ts readability pass
891f11a test(m6): characterize src/io/layout.ts
08d7392 refactor(m6): tools/buildspec/diff-core.mjs readability pass
8649265 refactor(m6): src/panel/planner.ts readability pass
033d825 refactor(m6): src/panel/planner.ts readability pass
1d9b016 refactor(m6): src/interaction/pointer.ts readability pass
4fe951b refactor(m6): src/io/mermaid.ts readability pass
ffcf224 test(m6): characterize src/io/mermaid.ts
c41b05e refactor(m6): tools/buildspec/extract.mjs readability pass
ab5ab52 refactor(m6): src/panel/unfold.ts readability pass
85388ee refactor(m6): src/panel/unfold.ts readability pass
8338c97 refactor(m6): src/panel/unfold.ts readability pass
```

API surfaces are hash-verified identical, and all gates (typecheck, lint, full test suite, API hash, score ratchet) were re-run by an independent verifier per pass.

Skipped/unfixable: []

🤖 Generated with [Claude Code](https://claude.com/claude-code)
