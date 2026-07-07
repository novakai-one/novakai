import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { loadDiagram, waitForWires, gotoUnfold, FIXTURE_MMD, FIXTURE_LR_MMD, SHOWCASE_MMD, GROUPED_MMD } from './helpers';

// goldens are linux-only — generate/verify via the playwright docker image
// (see the docker recipe in the session handoff / build notes), so darwin
// and CI's ubuntu runner never diff each other's font rendering.
test.skip(process.platform !== 'linux', 'goldens are linux-only — generate via the playwright docker image');

// applyMmd toasts "Applied" for 1400ms (src/panel/chrome/tabs.ts) — longer
// than the setup steps take, so whether the toast is in-frame would be a
// timing race. Wait it out before every screenshot.
const toastGone = (page: Page) =>
  expect(page.locator('#toast')).not.toHaveClass(/show/, { timeout: 5000 });

// The zoombar sits INSIDE #stage, whose pointerdown handler starts a marquee
// and calls stage.setPointerCapture (src/interaction/pointer.ts startMarquee)
// — capturing retargets the subsequent click away from the button, so a real
// pointer click on #zFit/#zIn never fires its onclick (verified empirically:
// locator.click() leaves #zLevel at 100%; dispatchEvent('click') works).
// dispatchEvent triggers the main.ts onclick handler directly.
const zoombarClick = (page: Page, sel: string) => page.locator(sel).dispatchEvent('click');

// The 6 tests below all go through gotoLegacy() (helpers.ts), which clicks
// #ufCompare to dismiss the unfold overlay boot always opens — so every one
// of these captures the LEGACY reference surface, never the product. Named
// `legacy-*` so that's obvious from the test list / snapshot filenames alone.

test('legacy-fixture-td', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 4);
  await toastGone(page);
  await expect(page).toHaveScreenshot('legacy-fixture-td.png');
});

test('legacy-fixture-lr', async ({ page }) => {
  await loadDiagram(page, FIXTURE_LR_MMD, 4);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 4);
  await toastGone(page);
  await expect(page).toHaveScreenshot('legacy-fixture-lr.png');
});

test('legacy-grouped', async ({ page }) => {
  await loadDiagram(page, GROUPED_MMD, 6);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 6);
  await toastGone(page);
  await expect(page).toHaveScreenshot('legacy-grouped.png');
});

test('legacy-shape-sampler', async ({ page }) => {
  await loadDiagram(page, SHOWCASE_MMD, 9);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 14);
  await toastGone(page);
  await expect(page).toHaveScreenshot('legacy-shape-sampler.png');
});

test('legacy-selected-node-inspector', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 4);
  await page.locator('#tabInsp').click();
  // click a specific NON-group node: group interiors are pointer-events:none
  // (css/styles.css .node.shape-group), so a click there falls through to the
  // stage and playwright refuses it.
  await page.locator('#world .node[data-id="n2"]').click();
  await toastGone(page);
  // Viewport (not fullPage): fullPage's document-width measurement jittered
  // 1367<->1357px between docker runs (scrollbar-ish) — a size mismatch that
  // hard-fails regardless of maxDiffPixelRatio. The inspector panel sits
  // inside the 1280x800 viewport, so fullPage bought nothing here.
  await expect(page).toHaveScreenshot('legacy-selected-node-inspector.png');
});

test('legacy-fit-with-minimap', async ({ page }) => {
  await loadDiagram(page, SHOWCASE_MMD, 9);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 14);
  // zoom in twice after fit so this golden is NOT identical to shape-sampler:
  // the canvas crops and the minimap viewport rectangle shrinks off-center,
  // attesting both the zoom transform and the minimap projection.
  await zoombarClick(page, '#zIn');
  await zoombarClick(page, '#zIn');
  await toastGone(page);
  await expect(page).toHaveScreenshot('legacy-fit-with-minimap.png');
});

// The 2 tests below capture the actual product surface: boot's unfold
// overlay, left open (never dismissed via #ufCompare). `unfold.theme` is a
// plain localStorage key read at open() time — dark ONLY when the stored
// value === 'dark' (src/panel/unfold/unfold.ts:2608), so the default with
// a cleared localStorage is LIGHT. Each test pre-seeds its theme explicitly
// via addInitScript before nav.

test('unfold-boot-dark', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('unfold.theme', 'dark');
  });
  await gotoUnfold(page);
  await expect(page).toHaveScreenshot('unfold-boot-dark.png');
});

test('unfold-boot-light', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('unfold.theme', 'light');
  });
  await gotoUnfold(page);
  await expect(page).toHaveScreenshot('unfold-boot-light.png');
});
