import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';

// K6 Agents tab — a real terminal workspace (docs/ide-vision/SPEC_AGENTS.md).
// The playwright webServer (playwright.config.ts) spawns the real vite dev
// server with NOVAKAI_PTY_CMD='echo ready; exec cat' — every session in
// these tests is a real process behind the real bridge, substituting only
// the spawned command (SPEC_AGENTS §10).
//
// Boot note: #agentsPage (z-index 74) sits ABOVE both #host (72) and the
// boot unfold overlay (70, src/panel/unfold/unfold.ts:83) — unlike the
// legacy-editor journeys, a direct `/#agents` load never needs `#ufCompare`
// dismissed first (mirrors design.spec.ts's rail-at-boot precedent).
const LOG_PATH = 'docs/novakai/metrics/agent-sessions.jsonl';

function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  return errors;
}

async function gotoAgents(page: Page): Promise<void> {
  await page.goto('/#agents');
  await expect(page.locator('#agentsPage')).toHaveClass(/show/);
}

// Creates a session and waits for the stub's deterministic banner
// ('echo ready' — SPEC_AGENTS §10), proving the real bridge round-tripped.
async function newSession(page: Page): Promise<void> {
  await page.locator('.agents-new').click();
  await expect(page.locator('.agents-pane:visible')).toContainText('ready', { timeout: 10000 });
}

function readLogLines(): string[] {
  try {
    return readFileSync(LOG_PATH, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

test('agents route renders session strip and empty state', async ({ page }) => {
  const errors = trackPageErrors(page);
  await gotoAgents(page);
  await expect(page.locator('.agents-strip .agents-new')).toBeVisible();
  await expect(page.locator('.agents-term-area .empty')).toContainText(
    'run Claude Code in a real terminal, in the repo',
  );
  await expect(page.locator('.agents-term-area .empty-cmd')).toContainText(
    '+ new session — spawns claude at the repo root',
  );
  expect(errors).toEqual([]);
});

test('agents session round-trip echoes typed input', async ({ page }) => {
  await gotoAgents(page);
  await newSession(page);
  await page.locator('.agents-pane:visible').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Enter');
  await expect(page.locator('.agents-pane:visible')).toContainText('hello');
});

test('agents session survives tab switch with scrollback intact', async ({ page }) => {
  await gotoAgents(page);
  await newSession(page);

  await page.locator('.rail-item[data-tab="codebase"]').click();
  await expect(page.locator('#agentsPage')).not.toHaveClass(/show/);
  await page.locator('.rail-item[data-tab="agents"]').click();
  await expect(page.locator('#agentsPage')).toHaveClass(/show/);

  await expect(page.locator('.agents-pane:visible')).toContainText('ready');
  await page.locator('.agents-pane:visible').click();
  await page.keyboard.type('still-here');
  await page.keyboard.press('Enter');
  await expect(page.locator('.agents-pane:visible')).toContainText('still-here');
});

test('agents exit marks chip exited and keeps scrollback', async ({ page }) => {
  await gotoAgents(page);
  await newSession(page);
  await page.locator('.agents-pane:visible').click();
  await page.keyboard.press('Control+D');
  await expect(page.locator('.agents-chip.active')).toContainText('· exited 0');
  await expect(page.locator('.agents-pane:visible')).toContainText('ready');
});

test('agents log records start and exit', async ({ page }) => {
  const before = readLogLines().length;
  await gotoAgents(page);
  await newSession(page);

  const closeEl = page.locator('.agents-chip.active .chip-x');
  await closeEl.click();
  await expect(closeEl).toHaveText('end?');
  await closeEl.click();
  await expect(page.locator('.agents-chip')).toHaveCount(0);

  await expect.poll(() => readLogLines().length).toBeGreaterThan(before);
  const records = readLogLines().slice(before).map((line) => JSON.parse(line) as { event: string });
  expect(records.some((r) => r.event === 'start')).toBe(true);
  expect(records.some((r) => r.event === 'exit')).toBe(true);
});

test('agents keyboard isolation keeps app shortcuts inert', async ({ page }) => {
  await gotoAgents(page);
  await newSession(page);
  await page.locator('.agents-pane:visible').click();

  const before = await page.evaluate(() => ({
    link: document.getElementById('linkBtn')?.classList.contains('active') ?? false,
    collapsed: document.getElementById('main')?.classList.contains('collapsed') ?? false,
    hash: location.hash,
  }));

  // 'l' and Tab are both house app shortcuts (link mode / panel collapse,
  // src/interaction/keyboard.ts). Typing a marker right after each proves
  // focus never left the terminal (a leaked Tab would steal focus, and the
  // marker would land elsewhere, never reaching the pane) — positive proof
  // both keystrokes reached the PTY rather than the app.
  await page.keyboard.press('l');
  await page.keyboard.type('after-l');
  await page.keyboard.press('Tab');
  await page.keyboard.type('after-tab');
  await expect(page.locator('.agents-pane:visible')).toContainText('after-l');
  await expect(page.locator('.agents-pane:visible')).toContainText('after-tab');

  const after = await page.evaluate(() => ({
    link: document.getElementById('linkBtn')?.classList.contains('active') ?? false,
    collapsed: document.getElementById('main')?.classList.contains('collapsed') ?? false,
    hash: location.hash,
  }));
  expect(after).toEqual(before);
});

test('agents two concurrent sessions stream independently', async ({ page }) => {
  await gotoAgents(page);
  await newSession(page);
  await page.locator('.agents-pane:visible').click();
  await page.keyboard.type('marker-a');

  await newSession(page);
  await page.locator('.agents-pane:visible').click();
  await page.keyboard.type('marker-b');

  await page.locator('.agents-chip').first().click();
  const paneA = page.locator('.agents-pane:visible');
  await expect(paneA).toContainText('ready');
  await expect(paneA).toContainText('marker-a');
  await expect(paneA).not.toContainText('marker-b');
});

test('agents close confirms in place', async ({ page }) => {
  page.on('dialog', (dialog) => { throw new Error(`unexpected dialog: ${dialog.message()}`); });
  await gotoAgents(page);
  await newSession(page);

  const closeEl = page.locator('.agents-chip.active .chip-x');
  await closeEl.click();
  await expect(closeEl).toHaveText('end?');

  // pointer-leave (moving away without a second click) reverts, no close.
  await page.locator('.agents-term-area').hover();
  await expect(closeEl).toHaveText('×');
  await expect(page.locator('.agents-chip')).toHaveCount(1);

  await closeEl.click();
  await expect(closeEl).toHaveText('end?');
  await closeEl.click();
  await expect(page.locator('.agents-chip')).toHaveCount(0);
});
