import { test, expect } from '@playwright/test';

test('lobby focuses public matchmaking on one 5 USDC stake', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'WILDCARD' })).toBeVisible();
  await expect(page.getByLabel('lobby status')).toContainText('5 USDC Stake');
  await expect(page.getByLabel('lobby status')).toContainText('1v1 Match');
  await expect(page.getByPlaceholder('Your nickname')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find Match' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Room' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Join Room' })).toBeVisible();
  await expect(page.getByText('Play 5 USDC')).toBeVisible();
  await expect(page.getByText('Fixed 5 USDC stake')).toBeVisible();
});

test('lobby presents private room create and join flows together', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByPlaceholder('ROOM42')).toBeVisible();
  await expect(page.getByPlaceholder('Midnight Duel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create Room' })).toBeVisible();
});
