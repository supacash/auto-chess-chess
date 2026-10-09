import { expect, type Page, test } from '@playwright/test';

/** Opens a fresh game (no saved run) and starts a Growing-board run from the menu's New game. */
async function startRun(page: Page): Promise<void> {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-resume')).toBeHidden(); // nothing to resume yet
  await page.locator('#menu-new').click();
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

test('a first visit shows the menu, New game starts a run, and the placement screen works', async ({ page }) => {
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
  await expect(page.locator('#menu-notice')).toContainText('interrupted and counted as a loss');
  await page.locator('#menu-resume').click();
  await expect(page.locator('#lives .heart.full')).toHaveCount(2);
});

test('Play it: move, resume after a reload, undo and resign', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  // A fixed opponent (king and a pawn, nowhere near our king) so the game always starts the same
  // way: a random army can start with our king in check.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('acc.run.v1')!);
    save.ai.pieces = [
      { id: 'ai-k', type: 'K', square: { file: 4, rank: 0 } },
      { id: 'ai-p', type: 'P', square: { file: 0, rank: 1 } },
    ];
    localStorage.setItem('acc.run.v1', JSON.stringify(save));
  });
  await page.reload();
  await page.locator('#menu-resume').click();
  await page.locator('#play').click();
  const status = page.locator('#battle-status');
  await expect(status).toHaveText('Your move', { timeout: 60_000 });

  // Move the king: tap it, then the first highlighted square.
  await page.locator('#battle-root .square[data-file="2"][data-rank="0"]').click();
  await page.locator('#battle-root .square.legal').first().click();
  // The opponent replies, and it's our move again.
  await expect(status).toHaveText(/Your move/, { timeout: 60_000 });
  await expect(page.locator('#undo')).toBeEnabled();

  // A reload offers the game back from the menu instead of counting a loss.
  await page.reload();
  await expect(page.locator('#menu-resume-detail')).toContainText('in progress');
  await page.locator('#menu-resume').click();
  await expect(page.locator('#battle')).toBeVisible();
  await expect(status).toHaveText(/Your move/, { timeout: 60_000 });
  await expect(page.locator('#lives .heart.full')).toHaveCount(3);

  // Menu pauses the game (it's saved); Resume game carries on from the same position.
  await page.locator('#menu-button').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-resume-detail')).toContainText('in progress');
  await page.locator('#menu-resume').click();
  await expect(status).toHaveText(/Your move/, { timeout: 60_000 });
  await expect(page.locator('#undo')).toBeEnabled();

  await page.locator('#undo').click();
  await expect(page.locator('#undo')).toBeDisabled();

  // Resigning takes two taps.
  await page.locator('#resign').click();
  await expect(page.locator('#resign')).toHaveText('Tap again to resign');
  await page.locator('#resign').click();
  await expect(page.locator('#result-title')).toHaveText('Defeat');
  await expect(page.locator('#result-detail')).toContainText('resigning');
});

test('a multiplayer match against bots plays a round with health and moves on', async ({ page }) => {
  await startRun(page);
  await page.locator('#menu-button').click();
  await page.locator('#menu-multiplayer').click();
  const dialog = page.locator('#match-dialog');
  await dialog.getByRole('button', { name: 'Play vs 3 bots' }).click();

  const hud = page.locator('#match-hud');
  await expect(hud).toBeVisible();
  await expect(page.locator('#match-players .player')).toHaveCount(4);
  await expect(page.locator('#match-round')).toContainText('Round 1 · Shop');
  // The next opponent (a bot) and its pieces are shown before the round, but not where they stand.
  await expect(page.locator('#opponent')).toContainText('Next opponent');
  await expect(page.locator('#opponent .foe').first()).toBeVisible();
  await expect(page.locator('#play')).toBeHidden();
  await expect(page.locator('#fight')).toHaveText('Ready');

  await placeKing(page);
  await page.locator('#fight').click();
  await expect(page.locator('#battle')).toBeVisible();
  await page.locator('#skip').click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toHaveText(/Victory|Defeat|Draw/);
  await expect(page.locator('#next')).toHaveText('Round 2');
  await page.locator('#next').click();
  await expect(page.locator('#match-round')).toContainText('Round 2 · Shop');
  await expect(page.locator('#match-timer')).toHaveText(/\d+s/);
});

test('the profile shows records from play, by tab', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  await page.locator('#fight').click();
  await page.locator('#skip').click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
  await page.locator('#next').click();

  await page.locator('#menu-button').click();
  await page.locator('#menu-profile').click();
  await expect(page.locator('#profile')).toBeVisible();
  await expect(page.locator('#profile-name')).toHaveText(/\w+ \w+ \d+/);
  // The round just played counts in this mode's record.
  await expect(page.locator('#profile-body .record-card h3')).toHaveText('Growing board · Normal');
  await expect(page.locator('#profile-body')).toContainText('Rounds W/L/D');
  for (const tab of ['multi', 'history', 'fun']) {
    await page.locator(`#profile-tabs [data-tab="${tab}"]`).click();
    await expect(page.locator(`#profile-tabs [data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('#profile-body')).toContainText('Best win streak');
  await page.locator('#profile-back').click();
  await expect(page.locator('#menu')).toBeVisible();
});
