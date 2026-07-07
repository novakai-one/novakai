import { test, expect } from '@playwright/test';

// K6 agents home: heading + new chat + the (offline-empty) session list.
// Mirrors journeys.spec.ts's rail-at-boot navigation pattern — deliberately
// does not call loadDiagram(); this only needs the rail to reach the tab.
test('agents home renders heading, new chat, and the empty session list', async ({ page }) => {
  await page.goto('/');
  const rail = page.locator('#rail');
  await expect(rail).toBeVisible();
  const agentsItem = page.locator('.rail-item[data-tab="agents"]');
  await expect(agentsItem).toBeVisible();
  await agentsItem.click();

  await expect(page.locator('.agents-page .agents-title')).toHaveText('Agents');
  await expect(page.locator('.agents-page .agents-new-chat')).toHaveText('New chat');
  await expect(page.locator('.agents-page .agents-list-wrap')).toBeAttached();
});

// K6 agents chat: clicking New chat swaps in place to the chat view.
// Offline click path only — no send is ever triggered here.
test('agents chat view opens with composer', async ({ page }) => {
  await page.goto('/');
  const rail = page.locator('#rail');
  await expect(rail).toBeVisible();
  const agentsItem = page.locator('.rail-item[data-tab="agents"]');
  await expect(agentsItem).toBeVisible();
  await agentsItem.click();

  await expect(page.locator('.agents-page .agents-new-chat')).toHaveText('New chat');
  await page.locator('.agents-page .agents-new-chat').click();

  await expect(page.locator('.agents-page .agents-chat')).toBeVisible();
  await expect(page.locator('.agents-page .ac-textarea')).toBeVisible();
});
