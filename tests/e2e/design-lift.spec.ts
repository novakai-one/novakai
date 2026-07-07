import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

// docs/ide-vision/LIFT_NOT_IMITATE.md's gate — proves the Design tab is the
// prototype's REAL CSS lifted verbatim (dimensions, transform-on-flip,
// transition presence, box-shadow shape), not a paraphrase that merely
// looks similar. Component identity is asserted (a switch must be a real
// track+knob) so a pills-instead-of-switch substitution fails this gate.
const STORAGE_KEY = 'novakai.design.v1';

async function openDraftCard(page: Page, outcome: string): Promise<void> {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.locator('.rail-item[data-tab="design"]').click();
  await page.locator('.design-outcome-input').fill(outcome);
  await page.locator('.design-outcome-submit').click();
  await page.getByRole('button', { name: 'Just draft it' }).click();
  await expect(page.locator('.design-card')).toBeVisible();
}

test('design lift: page title is the prototype\'s 40px sans display title, no eyebrow', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.locator('.rail-item[data-tab="design"]').click();

  const title = page.locator('.design-page-title');
  await expect(title).toHaveText('Design');
  const fontSize = await title.evaluate((node) => getComputedStyle(node).fontSize);
  expect(fontSize).toBe('40px');

  // DECLARED DROP (LIFT_NOT_IMITATE.md): no eyebrow kicker above the title.
  await expect(page.locator('.eyebrow')).toHaveCount(0);
});

test('design lift: the assumption toggle is a real sliding-knob switch, not pills', async ({ page }) => {
  await openDraftCard(page, 'Lift check — switch identity');

  const testsToggle = page.locator('.design-toggle', { has: page.locator('.design-toggle-label', { hasText: 'tests' }) });
  const track = testsToggle.locator('.tgl-switch');
  const knob = testsToggle.locator('.tgl-knob');
  await expect(track).toHaveCount(1);
  await expect(knob).toHaveCount(1);

  const box = await track.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(26);
  expect(Math.round(box?.height ?? 0)).toBe(14);

  // default (side 'a'): knob sits at rest, no translate.
  const restTransform = await knob.evaluate((node) => getComputedStyle(node).transform);
  expect(restTransform === 'none' || restTransform.endsWith(', 0, 0)')).toBe(true);

  // flip to side 'b' — the knob slides, it does not swap for a pill.
  await testsToggle.getByRole('button', { name: 'needs new acceptance tests' }).click();
  const flippedTransform = await knob.evaluate((node) => getComputedStyle(node).transform);
  expect(flippedTransform).toMatch(/,\s*12,\s*0\)$/);
});

test('design lift: buttons ease instead of snapping', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.locator('.rail-item[data-tab="design"]').click();

  const transition = await page.locator('.design-outcome-submit').evaluate((node) => getComputedStyle(node).transition);
  expect(transition).not.toBe('all 0s ease 0s');
  expect(transition).not.toBe('none');
  expect(transition).toContain('0.24s');
});

test('design lift: draft card has the inset highlight, no glow', async ({ page }) => {
  await openDraftCard(page, 'Lift check — card depth');

  const boxShadow = await page.locator('.design-card').evaluate((node) => getComputedStyle(node).boxShadow);
  expect(boxShadow).toContain('inset');
  // no colour-halo glow (the prototype's dropped teal spine used this exact shape)
  expect(boxShadow).not.toMatch(/rgba\(79,\s*224,\s*205/);
  expect(boxShadow.split(',').length).toBeLessThanOrEqual(4); // one shadow, not a stacked glow+shadow
});

test('design CSS block contains none of the colour-law-banned tokens', () => {
  const css = readFileSync('css/styles.css', 'utf8');
  const marker = css.indexOf('IDE Design tab');
  expect(marker).toBeGreaterThan(-1);
  const designBlock = css.slice(marker);
  const banned = /--edge-sel|--proven|--attested|#4fe0cd|#5fd0a0/;
  expect(designBlock).not.toMatch(banned);
});
