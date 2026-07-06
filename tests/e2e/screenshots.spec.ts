import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { loadDiagram, waitForWires, FIXTURE_MMD, FIXTURE_LR_MMD, SHOWCASE_MMD, GROUPED_MMD } from './helpers';

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

test('fixture-td', async ({ page }) => {
  await loadDiagram(page, FIXTURE_MMD, 4);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 4);
  await toastGone(page);
  await expect(page).toHaveScreenshot('fixture-td.png');
});

test('fixture-lr', async ({ page }) => {
  await loadDiagram(page, FIXTURE_LR_MMD, 4);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 4);
  await toastGone(page);
  await expect(page).toHaveScreenshot('fixture-lr.png');
});

test('grouped', async ({ page }) => {
  await loadDiagram(page, GROUPED_MMD, 6);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 6);
  await toastGone(page);
  await expect(page).toHaveScreenshot('grouped.png');
});

test('shape-sampler', async ({ page }) => {
  await loadDiagram(page, SHOWCASE_MMD, 9);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 14);
  await toastGone(page);
  await expect(page).toHaveScreenshot('shape-sampler.png');
});

test('selected-node-inspector', async ({ page }) => {
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
  await expect(page).toHaveScreenshot('selected-node-inspector.png');
});

test('fit-with-minimap', async ({ page }) => {
  await loadDiagram(page, SHOWCASE_MMD, 9);
  await zoombarClick(page, '#zFit');
  await waitForWires(page, 14);
  // zoom in twice after fit so this golden is NOT identical to shape-sampler:
  // the canvas crops and the minimap viewport rectangle shrinks off-center,
  // attesting both the zoom transform and the minimap projection.
  await zoombarClick(page, '#zIn');
  await zoombarClick(page, '#zIn');
  await toastGone(page);
  await expect(page).toHaveScreenshot('fit-with-minimap.png');
});
