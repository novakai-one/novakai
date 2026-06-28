# flowmap-spec-tools — how it's distributed and consumed (read me before "packaging" work)

`tools/` is a self-contained npm package: **`flowmap-spec-tools`**. It is NOT the app
(the app is the repo root, a Vite project — a different `package.json`). The package ships
six CLI bins — `flowmap-bundle`, `flowmap-validate`, `flowmap-lint`, `flowmap-extract`,
`flowmap-gate`, `flowmap-stubs` — and declares `ts-morph` as a real `dependency`, so
installing it pulls ts-morph automatically.

> If an analysis claims the tooling "isn't package-ready", it read the **root** package.json
> and never opened `tools/package.json`. The package has `bin`, `files`, `dependencies`,
> `engines`, `license`, and a `prepublishOnly` test gate. It is ready.

## How a consumer repo uses it (current, and correct)
NovaKai depends on it locally:

    // NovaKai package.json
    "devDependencies": { "flowmap-spec-tools": "file:../../flowmap/tools" }

This is the right setup for the current reality: both repos sit side-by-side under
`~/Programming/`, and NovaKai is the only consumer. `file:` gives a single source of truth
(edit the tooling here, nowhere else — no copy-paste). After changing anything under
`tools/`, refresh the consumer once: `cd <consumer> && npm install`. That is the only
maintenance, and it is why the bins can never silently drift.

## Why it is NOT published to npm (a decision, not a TODO)
Publishing is a *deployment* step, justified only when there is CI or an off-machine
consumer — neither exists yet. Publishing now would add an irreversible public action and a
registry to maintain for zero current benefit, while the local `file:` path already works.

**Decision: stay on `file:` until there is a real off-machine consumer. Nothing is pending.**

## When that day comes — the exact recipe (~2 minutes, requires your npm login)
The package is already publish-ready (the name `flowmap-spec-tools` is free on the registry;
`npm test` runs the lint suites via `prepublishOnly`; `npm pack` = 19 files at 0.1.0).

Public npm:

    npm login                                        # your npm account, one time
    cd tools && npm publish                          # prepublishOnly runs the lint tests first

Then point each consumer at the registry instead of the path:

    cd <consumer>
    npm pkg set devDependencies.flowmap-spec-tools="^0.1.0"
    npm install && npm run flowmap:verify            # confirm the registry-installed bin passes
    git commit -am "chore: consume flowmap-spec-tools from the registry"

Private/org instead: scope the name to `@novakai-one/flowmap-spec-tools`, add `.npmrc` with
`@novakai-one:registry=https://npm.pkg.github.com` and a PAT (`write:packages`), then
`cd tools && npm publish`. Same outcome. Do not bother with a bundler (tsup/esbuild) or a
monorepo/submodule — the `.mjs` bins run directly on Node >=18; those add maintenance for no gain.

## Source viewer bodies
A consumer populates the inspector's source pane via `%% src` directives in their `.flowmap.mmd` fragments +
`flowmap-extract --map` (shipped in this package). Both this repo and consumers use the same
`extract.mjs --map` — it reads `%% src` from the bundle, locates declarations via ts-morph, captures real
signatures + bodies, and writes `bodies.json`.
