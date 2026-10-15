import { expect, type Page } from '@playwright/test';

/** Opens a fresh game (no saved run) and starts a Growing-board run from the menu's New game. */
export async function startRun(page: Page, manual = false): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-resume')).toBeHidden(); // nothing to resume yet
  await page.locator('#menu-new').click();
  const dialog = page.locator('#new-run-dialog');
  await expect(dialog).toBeVisible();
  if (manual) await page.locator('#nr-manual').check();
  await dialog.getByRole('button', { name: 'Start game' }).click();
  await expect(dialog).toBeHidden();
}

/** Taps the king on the bench, then a square on the back row (file c). */
export async function placeKing(page: Page): Promise<void> {
  await page
    .locator('.bench .piece')
    .filter({ has: page.getByRole('img', { name: 'King' }) })
    .click();
  await page.locator('#board-root .square[data-file="2"][data-rank="0"]').click();
  await expect(page.locator('#fight-hint')).toBeHidden(); // the army can fight
}
