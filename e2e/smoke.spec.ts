import { expect, type Page, test } from '@playwright/test';

/** Opens a fresh game (no saved run) and starts a Growing-board run from the New run window. */
async function startRun(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const dialog = page.locator('#new-run-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Start run' }).click();
  await expect(dialog).toBeHidden();
}

/** Taps the king on the bench, then a square on the back row (file c). */
async function placeKing(page: Page): Promise<void> {
  await page
    .locator('.bench .piece')
    .filter({ has: page.getByAltText('King') })
    .click();
  await page.locator('#board-root .square[data-file="2"][data-rank="0"]').click();
  await expect(page.locator('#fight')).toBeEnabled();
}

test('a first visit opens the New run window and the placement screen works', async ({ page }) => {
  await startRun(page);
  await expect(page.locator('#round')).toContainText('Round 1');
  await expect(page.locator('.offer')).toHaveCount(4);
  // The fight buttons explain why they're disabled until the king is placed.
  await expect(page.locator('#fight')).toBeDisabled();
  await expect(page.locator('#fight-hint')).toHaveText('Place your king on the board');
  await placeKing(page);
  await expect(page.locator('#fight-hint')).toBeHidden();
});

test('an auto battle plays to a result, replays, and moves on to round 2', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  await page.locator('#fight').click();
  await expect(page.locator('#battle')).toBeVisible();
  await page.locator('#skip').click();
  const result = page.locator('#result');
  await expect(result).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toHaveText(/Victory|Defeat|Draw/);

  await page.locator('#replay').click();
  await expect(page.locator('#battle-status')).toContainText('Replay');
  await page.locator('#skip').click();
  await page.locator('#replay-done').click();
  await expect(result).toBeVisible();

  await page.locator('#next').click();
  await expect(page.locator('#placement')).toBeVisible();
  await expect(page.locator('#round')).toContainText('Round 2');
  await expect(page.locator('#last-replay')).toBeVisible();
});

test('leaving during an auto battle counts as a loss', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  await page.locator('#fight').click();
  await expect(page.locator('#battle-status')).toContainText('Move', { timeout: 60_000 });
  await page.reload();
  await expect(page.locator('#message')).toContainText('interrupted and counted as a loss');
  await expect(page.locator('#lives .heart.full')).toHaveCount(2);
});

test('Play it: move, resume after a reload, undo and resign', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  await page.locator('#play').click();
  const status = page.locator('#battle-status');
  await expect(status).toHaveText('Your move', { timeout: 60_000 });

  // Move the king: tap it, then the first highlighted square.
  await page.locator('#battle-root .square[data-file="2"][data-rank="0"]').click();
  await page.locator('#battle-root .square.legal').first().click();
  // The opponent replies, and it's our move again.
  await expect(status).toHaveText(/Your move/, { timeout: 60_000 });
  await expect(page.locator('#undo')).toBeEnabled();

  // A reload picks the game back up instead of counting a loss.
  await page.reload();
  await expect(page.locator('#battle')).toBeVisible();
  await expect(status).toHaveText(/Your move/, { timeout: 60_000 });
  await expect(page.locator('#lives .heart.full')).toHaveCount(3);

  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();

  // Resigning takes two taps.
  await page.locator('#resign').click();
  await expect(page.locator('#resign')).toHaveText('Tap again to resign');
  await page.locator('#resign').click();
  await expect(page.locator('#result-title')).toHaveText('Defeat');
  await expect(page.locator('#result-detail')).toContainText('resigning');
});
