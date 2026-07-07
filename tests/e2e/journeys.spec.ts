import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { loadDiagram, waitForWires, waitForStableWires, gotoLegacy, revealMmdAndApply, FIXTURE_MMD, GROUPED_MMD } from './helpers';
import { LS_KEY } from '../../src/core/config/config';

// ① apply-mermaid: text -> canvas, counts land correctly.
test('apply-mermaid: node/wire/status counts match the parsed model', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4); // 4 model nodes (g1,n1,n2,n3), 2 edges
  await expect(page.locator('#status')).toHaveText('4 nodes · 2 edges');
  await waitForWires(page, 4); // 2 <path> per edge (hit + main) — see src/render/wires.ts drawEdge
  expect(await page.locator('#wires path').count()).toBeGreaterThanOrEqual(4);
});

// ② create-link-undo: toolbar add x2 -> link mode -> wire two nodes -> undo removes only the edge.
// Wiring confirmed in src/main.ts (linkBtn.onclick toggles pointer.setLinkMode) and
// src/interaction/pointer.ts (handleLinkModeClick sets a pending link src, then on the
// 2nd node click calls nodes.makeEdge and auto-exits link mode via setLinkMode(false)).
test('create-link-undo: link two toolbar-added nodes, then undo the link', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4);
  await expect(page.locator('#status')).toHaveText('4 nodes · 2 edges');

  await page.locator('[data-shape="rect"]').click();
  const idA = await page.locator('#world .node').last().getAttribute('data-id');
  await page.locator('[data-shape="rect"]').click();
  const idB = await page.locator('#world .node').last().getAttribute('data-id');
  expect(idA).toBeTruthy();
  expect(idB).toBeTruthy();
  expect(idA).not.toEqual(idB);
  // addNode auto-selects the new node (selection.selectOnly), so the status
  // bar carries a "· N selected" suffix here — assert the counts, not the tail.
  await expect(page.locator('#status')).toContainText('6 nodes · 2 edges');

  await page.locator('#linkBtn').click();
  await expect(page.locator('#linkBtn')).toHaveClass(/active/);
  await page.locator(`#world .node[data-id="${idA}"]`).click();
  await page.locator(`#world .node[data-id="${idB}"]`).click();

  // link mode auto-exits after one completed link
  await expect(page.locator('#linkBtn')).not.toHaveClass(/active/);
  await expect(page.locator('#status')).toContainText('6 nodes · 3 edges');

  await page.locator('#undoBtn').click();
  await expect(page.locator('#status')).toHaveText('6 nodes · 2 edges');
});

// ③ persistence: an added node survives a reload from the autosave key.
// Deliberately does NOT use loadDiagram() here: it registers a localStorage-
// clearing addInitScript that would also fire (and wipe the autosave) on the
// page.reload() below. gotoLegacy()/revealMmdAndApply() apply the diagram
// without ever registering that script.
test('persistence: an added node survives a reload', async ({ page }) => {
  await gotoLegacy(page);
  await revealMmdAndApply(page, FIXTURE_MMD);
  await expect(page.locator('#world .node')).toHaveCount(4);

  await page.locator('[data-shape="rect"]').click();
  await expect(page.locator('#world .node')).toHaveCount(5);

  // persist() (src/core/persistence/persistence.ts) debounces 400ms before writing LS_KEY
  await page.waitForFunction((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try { return Object.keys(JSON.parse(raw).nodes ?? {}).length === 5; } catch { return false; }
  }, LS_KEY);

  // reload WITHOUT clearing storage (no loadDiagram/addInitScript here on purpose)
  await page.reload();
  await page.locator('#ufCompare').click();
  await expect(page.locator('#world .node')).toHaveCount(5);
});

// ④b rail-at-boot: the K3 IDE shell rail must sit above the boot overlay
// (z-index 80 > the unfold overlay's 70, src/panel/unfold/unfold.ts:83) so it
// is visible and usable BEFORE the legacy editor is ever revealed via
// #ufCompare (docs/ide-vision/SPEC_SHELL.md §2/§3). Deliberately does not
// call gotoLegacy() — this asserts the state the boot overlay is still open.
test('rail-at-boot: the rail is visible and clickable before the legacy editor is revealed', async ({ page }) => {
  await page.goto('/');
  const rail = page.locator('#rail');
  await expect(rail).toBeVisible();
  const contractsItem = page.locator('.rail-item[data-tab="contracts"]');
  await expect(contractsItem).toBeVisible();
  await contractsItem.click();
  await expect(page.locator('#host')).toBeVisible();
  await expect(page.locator('.empty-cmd')).toContainText('novakai:contract');
});

// ④ wire-geometry: the structural regression guard the pixel goldens can't
// provide. A 0-context verifier proved that at maxDiffPixelRatio: 0.01 the 6
// golden screenshots do NOT catch wire-geometry regressions — shifting every
// wire +40px in y stayed under the 1%-of-1280x800 diff-pixel gate (6/6 green
// under mutation). This test instead extracts the actual `#wires path` `d`
// geometry (the async WASM router's settled polyPath output — see
// src/render/wires.ts edgePath/polyPath), rounds to integers to kill
// cross-render float noise, sorts deterministically, and deep-equals it
// against a committed expected file. Runs on ALL platforms (unlike
// screenshots.spec.ts, which is linux-only), so it guards wiring everywhere.
// Regenerate DELIBERATELY when wiring intentionally changes:
//   UPDATE_WIRE_GEOMETRY=1 npm run test:e2e
const WIRE_GEOMETRY_PATH = fileURLToPath(new URL('./wire-geometry.expected.json', import.meta.url));

async function wireGeometry(page: Page): Promise<number[][]> {
  const ds = await page.locator('#wires path').evaluateAll((els) => els.map((el) => el.getAttribute('d') ?? ''));
  return ds
    .map((d) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map((n) => Math.round(Number(n))))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test('wire-geometry: settled wire paths match committed geometry', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4);
  await waitForStableWires(page, 4);
  const fixtureTd = await wireGeometry(page);

  await loadDiagram(page, GROUPED_MMD, 6);
  await waitForStableWires(page, 6);
  const grouped = await wireGeometry(page);

  const observed = { 'fixture-td': fixtureTd, grouped };

  if (process.env.UPDATE_WIRE_GEOMETRY === '1') {
    writeFileSync(WIRE_GEOMETRY_PATH, JSON.stringify(observed, null, 2) + '\n');
    return;
  }

  const expected = JSON.parse(readFileSync(WIRE_GEOMETRY_PATH, 'utf8'));
  expect(observed).toEqual(expected);
});
