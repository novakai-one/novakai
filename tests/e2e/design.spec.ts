import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
const SELECTOR_DESIGN_RAIL_ITEM = '.rail-item[data-tab="design"]';
const SELECTOR_DESIGN_ROW = '.design-row';
const SELECTOR_TEST_PLAN_BLOCK = '[data-block-kind="test-plan"]';
const SELECTOR_DESIGN_TOGGLE = '.design-toggle';
const SELECTOR_DESIGN_TOGGLE_LABEL = '.design-toggle-label';
const OUTCOME_DARK_MODE = 'Ship dark mode toggle';

async function openDesignTab(page: Page): Promise<void> {
  await page.goto('/');
  // NOT addInitScript (unlike helpers.ts's loadDiagram): that would re-clear
  // storage on this test's later page.reload() too, wiping the very record
  // the persistence assertion checks. A one-off evaluate() runs once, here,
  // before the reload — each test already gets a fresh isolated context, so
  // this is just defensive, matching helpers.ts's documented gotcha.
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.locator(SELECTOR_DESIGN_RAIL_ITEM).click();
}

async function goToCodebaseAndBack(page: Page): Promise<void> {
  await page.locator('.rail-item[data-tab="codebase"]').click();
  await page.locator(SELECTOR_DESIGN_RAIL_ITEM).click();
}

async function readRecords(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), STORAGE_KEY);
}

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function submitOutcome(page: Page, outcome: string): Promise<void> {
  await page.locator('.design-outcome-input').fill(outcome);
  await page.locator('.design-outcome-submit').click();
}

// Step 2/3: the ONE question, verbatim -> "Just draft it" -> draft card, no
// test-plan block yet (default assumptions: all 'a').
async function draftTheOutcome(page: Page): Promise<Locator> {
  await expect(page.locator('.design-question-text')).toHaveText(
    'Any specifics in mind, or should I put together a draft to refine?',
  );
  await page.getByRole('button', { name: 'Just draft it' }).click();
  const card = page.locator('.design-card');
  await expect(card).toBeVisible();
  await expect(card.locator(SELECTOR_TEST_PLAN_BLOCK)).toHaveCount(0);
  return card;
}

// Flip the "tests" toggle to side b — a structural block appears, not a
// re-worded sentence — then flip back and confirm the block disappears again.
async function toggleTestsBlock(page: Page, card: Locator): Promise<void> {
  const testsToggle = page.locator(SELECTOR_DESIGN_TOGGLE, {
    has: page.locator(SELECTOR_DESIGN_TOGGLE_LABEL, { hasText: 'tests' }),
  });
  await testsToggle.getByRole('button', { name: 'needs new acceptance tests' }).click();
  await expect(card.locator(SELECTOR_TEST_PLAN_BLOCK)).toHaveCount(1);
  await testsToggle.getByRole('button', { name: 'existing tests cover it' }).click();
  await expect(card.locator(SELECTOR_TEST_PLAN_BLOCK)).toHaveCount(0);
}

// Confirm -> hand-off offer -> Create contract -> navigates to #contracts.
async function confirmAndHandOff(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.locator('.design-handoff')).toBeVisible();
  await page.getByRole('button', { name: 'Create contract' }).click();
  await expect(page).toHaveURL(/#contracts$/);
}

// Reload — the handed-off row survives under its own storage key, then
// reopen the Design tab and return the rest-view row.
async function reopenDesignTab(page: Page): Promise<Locator> {
  await page.reload();
  await page.locator(SELECTOR_DESIGN_RAIL_ITEM).click();
  return page.locator(SELECTOR_DESIGN_ROW);
}

async function assertHandedOffRow(row: Locator, outcome: string): Promise<void> {
  await expect(row).toHaveCount(1);
  await expect(row.locator('.design-row-outcome')).toHaveText(outcome);
  await expect(row.locator('.design-row-status')).toHaveText('handed off');
  // no discard control on a handed-off row (drafts only, SPEC_DESIGN.md §1)
  await expect(row.locator('.design-row-discard')).toHaveCount(0);
}

function assertHandedOffRecord(record: Record<string, unknown>, outcome: string): void {
  expect(record).toMatchObject({
    ['v']: 1,
    status: 'handed-off',
    outcome,
    question: 'draft',
  });
  expect(record.confirmedAt).toBeTruthy();
  expect(record.handedOffAt).toBeTruthy();
  // frozen block structure reflects the final (flipped-back) toggle state
  expect((record.blocks as Array<{ kind: string }>).map((block) => block.kind)).toEqual(['target']);
  expect(record.assumptions).toHaveLength(3);
}

test(
  'design draft lane: outcome -> just draft it -> toggle restructures the card -> confirm -> hand off -> persists',
  async ({ page }) => {
    const errors = trackPageErrors(page);
    await openDesignTab(page);
    await submitOutcome(page, OUTCOME_DARK_MODE);

    const card = await draftTheOutcome(page);
    await toggleTestsBlock(page, card);
    await confirmAndHandOff(page);

    const row = await reopenDesignTab(page);
    await assertHandedOffRow(row, OUTCOME_DARK_MODE);

    const records = await readRecords(page);
    expect(records).toHaveLength(1);
    assertHandedOffRecord(records[0], OUTCOME_DARK_MODE);

    expect(errors).toEqual([]);
  },
);

// The draft card renders past the question fork now.
async function addOutcomeWithSpecifics(page: Page, outcome: string, specificsText: string): Promise<void> {
  await page.locator('.design-outcome-input').fill(outcome);
  await page.locator('.design-outcome-submit').click();
  await page.getByRole('button', { name: 'Add specifics' }).click();
  const specificsInput = page.locator('.design-specifics-input');
  await expect(specificsInput).toBeVisible();
  await specificsInput.fill(specificsText);
  await specificsInput.press('Enter');
  await expect(page.locator('.design-card')).toBeVisible();
}

async function assertSpecificsRecord(page: Page, specificsText: string): Promise<void> {
  const records = await readRecords(page);
  expect(records).toHaveLength(1);
  expect(records[0].question).toBe('specifics');
  expect(records[0].specifics).toBe(specificsText); // verbatim, §1.9
}

function riskToggleLocator(page: Page): Locator {
  return page.locator(SELECTOR_DESIGN_TOGGLE, {
    has: page.locator(SELECTOR_DESIGN_TOGGLE_LABEL, { hasText: 'risk' }),
  });
}

// Flip the "risk" toggle to side b — carries state through resume.
async function flipRiskToggleOn(page: Page): Promise<void> {
  await riskToggleLocator(page).getByRole('button', { name: 'needs human review' }).click();
  await expect(page.locator('.design-card [data-block-kind="review-gate"]')).toHaveCount(1);
}

// Resume: route away and back — the only way to return to the rest view
// (the thread has no in-page "back" control, per src/ide/design-render.ts).
// Then reopen the draft row — thread resumes at the draft card, toggle intact.
async function resumeDraftRow(page: Page): Promise<Locator> {
  await goToCodebaseAndBack(page);
  const row = page.locator(SELECTOR_DESIGN_ROW);
  await expect(row).toHaveCount(1);
  await expect(row.locator('.design-row-status')).toHaveText('draft');
  await row.click();
  await expect(page.locator('.design-card [data-block-kind="review-gate"]')).toHaveCount(1);
  return row;
}

async function assertRiskToggleActive(page: Page): Promise<void> {
  await expect(riskToggleLocator(page).getByRole('button', { name: 'needs human review' })).toHaveClass(/active/);
}

// Discard: back to the rest view to reach the row's discard control, accept
// the native confirm(), then verify the row is gone.
async function discardDraftRow(page: Page): Promise<void> {
  await goToCodebaseAndBack(page);
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.locator('.design-row .design-row-discard').click();
  await expect(page.locator(SELECTOR_DESIGN_ROW)).toHaveCount(0);
}

async function reloadAndAssertNoRows(page: Page): Promise<void> {
  await page.reload();
  await page.locator(SELECTOR_DESIGN_RAIL_ITEM).click();
  await expect(page.locator(SELECTOR_DESIGN_ROW)).toHaveCount(0);
  const records = await readRecords(page);
  expect(records).toHaveLength(0);
}

test('design specifics lane: add specifics -> resume with toggle state intact -> discard', async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDesignTab(page);

  const specificsText = 'must persist per-repo, not global';
  await addOutcomeWithSpecifics(page, 'Add repo switcher', specificsText);
  await assertSpecificsRecord(page, specificsText);

  await flipRiskToggleOn(page);
  await resumeDraftRow(page);
  await assertRiskToggleActive(page);

  await discardDraftRow(page);
  await reloadAndAssertNoRows(page);

  expect(errors).toEqual([]);
});
