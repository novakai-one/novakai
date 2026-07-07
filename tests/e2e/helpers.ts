import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// Mermaid dialect confirmed against src/io/mermaid.ts (shapeWrap + parseShapeLine)
// and mirrored by tests/characterization/io-mermaid.test.ts — not guessed.
// FIXTURE_MMD: 4 model nodes (1 group + 3), 2 edges.
export const FIXTURE_MMD = `flowchart TD
subgraph g1 ["Group One"]
  n1["Alpha"]
end
n2("Beta")
n3{"Gamma"}
n1 --> n2
n2 --> n3
`;

// FIXTURE_LR_MMD: same graph as FIXTURE_MMD but flowing LR with explicit
// `%% fm` layout metadata — auto-placement ignores direction, so without fm
// lines an LR golden would be pixel-identical to the TD one. This also makes
// it the one golden exercising the fm position/size parse path.
export const FIXTURE_LR_MMD = `flowchart LR
%% fm g1 40 40 240 170 group null
%% fm n1 80 95 160 56 rect null
%% fm n2 360 95 160 56 round null
%% fm n3 600 80 150 88 diamond null
subgraph g1 ["Group One"]
  n1["Alpha"]
end
n2("Beta")
n3{"Gamma"}
n1 --> n2
n2 --> n3
`;

// SHOWCASE_MMD: every shape kind + a group. 9 model nodes, 7 edges.
export const SHOWCASE_MMD = `flowchart TD
subgraph g1 ["Container"]
  n1["Rect"]
end
n2("Round")
n3(["Stadium"])
n4[("Cylinder")]
n5{"Diamond"}
n6(("Circle"))
n7{{"Hex"}}
n8>"Note"]
n1 --> n2
n2 --> n3
n3 --> n4
n4 --> n5
n5 --> n6
n6 --> n7
n7 --> n8
`;

// GROUPED_MMD: two sibling groups with cross-group edges. 6 model nodes
// (2 groups + 4 members), 3 edges.
export const GROUPED_MMD = `flowchart TD
subgraph g1 ["Frontend"]
  n1["UI"]
  n2("Router")
end
subgraph g2 ["Backend"]
  n3{"API"}
  n4[("DB")]
end
n1 --> n2
n2 --> n3
n3 --> n4
`;

/**
 * Navigate to the app in a deterministic state, apply the given mermaid
 * text, and wait for it to land on canvas.
 *
 * Boot notes (verified in src/main.ts / src/panel/unfold/unfold.ts):
 * - localStorage carries autosave (novakai.autosave.v1) + prefs; clearing it
 *   via addInitScript (before any page script runs) kills seed/autosave
 *   nondeterminism.
 * - Boot unconditionally calls `unfold.open()`, a fixed full-viewport overlay
 *   (z-index 70) that covers the legacy toolbar/stage. The only way out is
 *   the `#ufCompare` ("legacy") button in the overlay's dock — Escape does
 *   NOT close it. Every journey needs the legacy surface, so this always
 *   clicks it first.
 * - The `#mmd` textarea/`#applyMmd` button live in the panel's "mermaid" tab
 *   (`#paneMmd`/`#footMmd`), hidden (display:none) until `#tabMmd` is clicked
 *   (src/panel/chrome/tabs.ts showTab()).
 */
export async function loadDiagram(page: Page, mmd: string, expectedNodes: number): Promise<void> {
  // NOTE: addInitScript persists for every future navigation on this page,
  // including a later page.reload() — fine for journeys that never reload,
  // but the persistence journey (which does reload) applies the diagram via
  // gotoLegacy()/revealMmdAndApply() directly instead, so it never registers
  // this clearing script.
  await page.addInitScript(() => localStorage.clear());
  await gotoLegacy(page);
  await revealMmdAndApply(page, mmd);
  await expect(page.locator('#world .node')).toHaveCount(expectedNodes);
}

/**
 * Navigate to '/' and dismiss the "unfold" overlay that boot always opens
 * (src/panel/unfold/unfold.ts open() — a fixed full-viewport layer, z-index
 * 70, covering the legacy toolbar/stage). `#ufCompare` ("legacy") is the only
 * way out; Escape does not close it. Does NOT touch localStorage, so it is
 * safe to call again after a page.reload() without wiping autosave.
 */
export async function gotoLegacy(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#ufCompare').click();
}

/**
 * Reveal the mermaid tab (`#paneMmd`/`#footMmd` are display:none until
 * `#tabMmd` is clicked — src/panel/chrome/tabs.ts showTab()), fill `#mmd`,
 * and click `#applyMmd`.
 */
export async function revealMmdAndApply(page: Page, mmd: string): Promise<void> {
  await page.locator('#tabMmd').click();
  await page.locator('#mmd').fill(mmd);
  await page.locator('#applyMmd').click();
}

/**
 * Wait for the SVG wire layer to reach at least `n` <path> elements.
 * The avoid-router (WASM) routes edges asynchronously (src/render/avoidRouter.ts);
 * a render can land on a stable "nodes placed, wires not yet (re)routed" frame,
 * which toHaveScreenshot's built-in two-frame stability check would happily
 * accept as "stable" — so screenshots explicitly wait on wire count first.
 */
export async function waitForWires(page: Page, n: number): Promise<void> {
  await page.waitForFunction((count) => document.querySelectorAll('#wires path').length >= count, n);
}

/**
 * Like waitForWires, but also waits for the routed `d` geometry itself to
 * stop changing. The async libavoid router (src/render/avoidRouter.ts)
 * re-routes whenever its obstacle-field signature changes — which, on first
 * load, can fire more than once as measured frontmatter-card footprints
 * settle — so wire count alone is not proof the geometry is final. Polls
 * until two consecutive reads of every path's `d` attribute are identical.
 * Used only by geometry-sensitive checks (structural wire-geometry test);
 * pixel goldens tolerate the residual jitter via their diff-pixel threshold.
 */
export async function waitForStableWires(page: Page, n: number, tries = 40, delayMs = 100): Promise<void> {
  await waitForWires(page, n);
  let prev: string | null = null;
  for (let i = 0; i < tries; i++) {
    const cur = JSON.stringify(
      await page.locator('#wires path').evaluateAll((els) => els.map((el) => el.getAttribute('d'))),
    );
    if (cur === prev) return;
    prev = cur;
    await page.waitForTimeout(delayMs);
  }
}

/**
 * Navigate to '/' and wait for boot's unconditional unfold overlay
 * (src/panel/unfold/unfold.ts open(), the LAST line of boot per src/main.ts:239)
 * to be visible and settled — the product surface, never dismissed via
 * `#ufCompare`. Unfold routes its own wires (`#ufWires path`, same async
 * libavoid router as the legacy `#wires` — see waitForStableWires above), so
 * settling on wire geometry is required before a screenshot the same way.
 */
export async function gotoUnfold(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#unfoldOverlay.show')).toBeVisible();
  await waitForStableUnfoldWires(page);
}

/** Like waitForStableWires, but scoped to the unfold overlay's wire layer. */
export async function waitForStableUnfoldWires(page: Page, tries = 40, delayMs = 100): Promise<void> {
  let prev: string | null = null;
  for (let i = 0; i < tries; i++) {
    const cur = JSON.stringify(
      await page.locator('#ufWires path').evaluateAll((els) => els.map((el) => el.getAttribute('d'))),
    );
    if (cur === prev) return;
    prev = cur;
    await page.waitForTimeout(delayMs);
  }
}
