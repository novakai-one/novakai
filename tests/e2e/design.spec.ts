import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

// K5 Design tab journeys — docs/ide-vision/SPEC_DESIGN.md §7 criteria 7 & 8.
// Behavioural only, no screenshots/goldens (those require the CI container).
//
// Boot notes specific to this page (verified in src/ide/shell.ts / css/styles.css):
// - The rail (#rail, z-index 80) and #host (z-index 72) both sit ABOVE the boot
//   unfold overlay (z-index 70, src/panel/unfold/unfold.ts:83) — unlike the
//   legacy-editor journeys in journeys.spec.ts, Design pages never need
//   `#ufCompare` dismissed first; clicking a rail item and using #host works
//   immediately at boot (mirrors the 'rail-at-boot' test in journeys.spec.ts).
// - `location.hash = 'design'` is set by shell.ts's rail item onclick; the
//   page itself is rebuilt from scratch (design.ts render()) on every route
//   entry, always starting at the rest view (openId null) — there is no
//   in-page "back to list" control, so returning to the rest view/list from
//   an open thread requires a hash change (see resume/discard below).
const STORAGE_KEY = 'novakai.design.v1'; // SPEC_DESIGN.md §3 — design-model.ts's own key

async function openDesignTab(page: Page): Promise<void> {
  await page.goto('/');
  // NOT addInitScript (unlike helpers.ts's loadDiagram): that would re-clear
  // storage on this test's later page.reload() too, wiping the very record
  // the persistence assertion checks. A one-off evaluate() runs once, here,
  // before the reload — each test already gets a fresh isolated context, so
  // this is just defensive, matching helpers.ts's documented gotcha.
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.locator('.rail-item[data-tab="design"]').click();
}

async function goToCodebaseAndBack(page: Page): Promise<void> {
  await page.locator('.rail-item[data-tab="codebase"]').click();
  await page.locator('.rail-item[data-tab="design"]').click();
}

async function readRecords(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY);
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  return errors;
}

test('design draft lane: outcome -> just draft it -> toggle restructures the card -> confirm -> hand off -> persists', async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDesignTab(page);

  await page.locator('.design-outcome-input').fill('Ship dark mode toggle');
  await page.locator('.design-outcome-submit').click();

  // Step 2: the ONE question, verbatim.
  await expect(page.locator('.design-question-text')).toHaveText(
    'Any specifics in mind, or should I put together a draft to refine?',
  );
  await page.getByRole('button', { name: 'Just draft it' }).click();

  // Step 3: draft card, no test-plan block yet (default assumptions: all 'a').
  const card = page.locator('.design-card');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-block-kind="test-plan"]')).toHaveCount(0);

  // Flip the "tests" toggle to side b — a structural block appears, not a re-worded sentence.
  const testsToggle = page.locator('.design-toggle', { has: page.locator('.design-toggle-label', { hasText: 'tests' }) });
  await testsToggle.getByRole('button', { name: 'needs new acceptance tests' }).click();
  await expect(card.locator('[data-block-kind="test-plan"]')).toHaveCount(1);

  // Flip back — the block disappears again.
  await testsToggle.getByRole('button', { name: 'existing tests cover it' }).click();
  await expect(card.locator('[data-block-kind="test-plan"]')).toHaveCount(0);

  // Confirm -> hand-off offer -> Create contract -> navigates to #contracts.
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.design-handoff')).toBeVisible();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page).toHaveURL(/#contracts$/);

  // Reload — the handed-off row survives under its own storage key, then
  // reopen the Design tab and check the rest-view row.
  await page.reload();
  await page.locator('.rail-item[data-tab="design"]').click();
  const row = page.locator('.design-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.design-row-outcome')).toHaveText('Ship dark mode toggle');
  await expect(row.locator('.design-row-status')).toHaveText('handed off');
  // no discard control on a handed-off row (drafts only, SPEC_DESIGN.md §1)
  await expect(row.locator('.design-row-discard')).toHaveCount(0);

  const records = await readRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    v: 1,
    status: 'handed-off',
    outcome: 'Ship dark mode toggle',
    question: 'draft',
  });
  expect(records[0].confirmedAt).toBeTruthy();
  expect(records[0].handedOffAt).toBeTruthy();
  // frozen block structure reflects the final (flipped-back) toggle state
  expect((records[0].blocks as Array<{ kind: string }>).map((b) => b.kind)).toEqual(['target']);
  expect(records[0].assumptions).toHaveLength(3);

  expect(errors).toEqual([]);
});

test('design specifics lane: add specifics -> resume with toggle state intact -> discard', async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDesignTab(page);

  await page.locator('.design-outcome-input').fill('Add repo switcher');
  await page.locator('.design-outcome-submit').click();
  await page.getByRole('button', { name: 'Add specifics' }).click();

  const specificsInput = page.locator('.design-specifics-input');
  await expect(specificsInput).toBeVisible();
  const specificsText = 'must persist per-repo, not global';
  await specificsInput.fill(specificsText);
  await specificsInput.press('Enter');

  // The draft card renders past the question fork now.
  await expect(page.locator('.design-card')).toBeVisible();

  let records = await readRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0].question).toBe('specifics');
  expect(records[0].specifics).toBe(specificsText); // verbatim, §1.9

  // Flip the "risk" toggle to side b — carries state through resume.
  const riskToggle = page.locator('.design-toggle', { has: page.locator('.design-toggle-label', { hasText: 'risk' }) });
  await riskToggle.getByRole('button', { name: 'needs human review' }).click();
  await expect(page.locator('.design-card [data-block-kind="review-gate"]')).toHaveCount(1);

  // Resume: route away and back — the only way to return to the rest view
  // (the thread has no in-page "back" control, per src/ide/design-render.ts).
  await goToCodebaseAndBack(page);
  const row = page.locator('.design-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('.design-row-status')).toHaveText('draft');

  // Reopen the draft row — thread resumes at the draft card, toggle intact.
  await row.click();
  await expect(page.locator('.design-card [data-block-kind="review-gate"]')).toHaveCount(1);
  const reopenedRiskToggle = page.locator('.design-toggle', { has: page.locator('.design-toggle-label', { hasText: 'risk' }) });
  await expect(reopenedRiskToggle.getByRole('button', { name: 'needs human review' })).toHaveClass(/active/);

  // Discard: back to the rest view to reach the row's discard control, accept
  // the native confirm(), then verify the row is gone after reload.
  await goToCodebaseAndBack(page);
  page.once('dialog', (dialog) => { void dialog.accept(); });
  await page.locator('.design-row .design-row-discard').click();
  await expect(page.locator('.design-row')).toHaveCount(0);

  await page.reload();
  await page.locator('.rail-item[data-tab="design"]').click();
  await expect(page.locator('.design-row')).toHaveCount(0);
  records = await readRecords(page);
  expect(records).toHaveLength(0);

  expect(errors).toEqual([]);
});
