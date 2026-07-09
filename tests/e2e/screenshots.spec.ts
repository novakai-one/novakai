import { test, expect } from '@playwright/test';
import { gotoUnfold } from './helpers';

// goldens are linux-only — generate/verify via the playwright docker image
// (see the docker recipe in the session handoff / build notes), so darwin
// and CI's ubuntu runner never diff each other's font rendering.
test.skip(process.platform !== 'linux', 'goldens are linux-only — generate via the playwright docker image');

// NOTE: the 6 `legacy-*` full-page goldens were removed (2026-07-10). They
// pixel-locked the self-declared "stale reference surface, NOT the product"
// and captured an incidental document h-scroll (the IDE rail overflows the
// viewport), so a zero-geometry-change refactor could shift them ~3%. The
// product render is guarded by the two unfold goldens below plus the
// structural wire-geometry check in journeys.spec.ts.

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
