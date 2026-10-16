import { expect, test } from '@playwright/test';
import { placeKing, startRun } from './helpers';

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

  // Review opens on the final position; step back to the start and forward again.
  await page.locator('#replay').click();
  await expect(page.locator('#battle-status')).toContainText('final position');
  await page.locator('#review [data-step="first"]').click();
  await expect(page.locator('#battle-status')).toHaveText('Start position');
  await page.locator('#review [data-step="next"]').click();
  await expect(page.locator('#battle-status')).toContainText('Move 1 of');
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
  await startRun(page, true);
  await expect(page.locator('#fight')).toBeHidden(); // Play yourself runs have only Play it
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
  await dialog.getByRole('button', { name: 'Play vs bots' }).click();

  const hud = page.locator('#match-hud');
  await expect(hud).toBeVisible();
  await expect(page.locator('#match-players .player')).toHaveCount(4);
  await expect(page.locator('#match-round')).toContainText('Round 1 · Shop');
  // The next opponent (a bot) and its pieces are shown before the round, but not where they stand.
  await expect(page.locator('#opponent')).toContainText('Up next');
  await expect(page.locator('#opponent .foe').first()).toBeVisible();
  await expect(page.locator('#play')).toBeHidden();
  await expect(page.locator('#fight')).toHaveText('Ready');

  await placeKing(page);
  await page.locator('#fight').click();
  await expect(page.locator('#battle')).toBeVisible();
  await page.locator('#skip').click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#result-title')).toHaveText(/Victory|Defeat|Draw/);
  await expect(page.locator('#next')).toHaveText('On to round 2');
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
  await expect(page.locator('#profile-body')).toContainText('W/L/D');
  for (const tab of ['multi', 'history', 'fun']) {
    await page.locator(`#profile-tabs [data-tab="${tab}"]`).click();
    await expect(page.locator(`#profile-tabs [data-tab="${tab}"]`)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.locator('#profile-body')).toContainText('Best win streak');
  await page.locator('#profile-back').click();
  await expect(page.locator('#menu')).toBeVisible();
});

test('game over sums up the run, and New run opens the New game window', async ({ page }) => {
  await startRun(page);
  await placeKing(page);
  // The last life, against an army that mates a lone king in a few moves.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('acc.run.v1')!);
    save.run.lives = 1;
    save.ai.pieces = [
      { id: 'ai-k', type: 'K', square: { file: 4, rank: 0 } },
      { id: 'ai-q', type: 'Q', square: { file: 3, rank: 0 } },
      { id: 'ai-r1', type: 'R', square: { file: 0, rank: 0 } },
      { id: 'ai-r2', type: 'R', square: { file: 1, rank: 0 } },
    ];
    localStorage.setItem('acc.run.v1', JSON.stringify(save));
  });
  await page.reload();
  await page.locator('#menu-resume').click();
  await page.locator('#fight').click();
  await page.locator('#skip').click();
  await expect(page.locator('#result-title')).toHaveText('Game over', { timeout: 120_000 });
  await expect(page.locator('#result-stats')).toContainText('Rounds won');
  await page.locator('#next').click();
  const dialog = page.locator('#new-run-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#menu-resume')).toBeHidden(); // the run is over
});

test('an empty profile tab offers a way to go and play', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#menu-profile').click();
  await page.locator('#profile-body').getByRole('button', { name: 'New game' }).click();
  await expect(page.locator('#new-run-dialog')).toBeVisible();
});

test('the piece guide teaches every piece, from the menu and from a piece panel', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#menu')).toBeVisible();
  await page.locator('#menu-guide').click();
  const guide = page.locator('#guide');
  await expect(guide).toBeVisible();
  // The Knight, with its move diagram (eight knight jumps), value and how to get it.
  const knight = guide.locator('[data-piece="N"]');
  await expect(knight.locator('.move-diagram')).toHaveAttribute('aria-label', 'How the Knight moves');
  await expect(knight.locator('.md-any')).toHaveCount(8);
  await expect(knight).toContainText('3 pts');
  await expect(knight).toContainText('3 Knight-pawns');
  await guide.locator('#guide-tabs [data-group="fusions"]').click();
  await expect(guide.locator('[data-piece="J"]')).toContainText('3 Queens');
  await expect(guide.locator('[data-piece="A"]')).toContainText('Fuse');
  await expect(guide.locator('[data-piece="G"]')).toHaveCount(0);
  await page.locator('#guide-back').click();
  await expect(guide).toBeHidden();
  await expect(page.locator('#menu')).toBeVisible();

  // "How it moves" in a piece's panel opens the guide on that piece, and Back returns to the shop.
  await startRun(page);
  await page
    .locator('.bench .piece')
    .filter({ has: page.getByAltText('Pawn', { exact: true }) })
    .first()
    .click();
  await page.locator('#piece-actions .guide-link').click();
  await expect(guide).toBeVisible();
  await expect(guide.locator('#guide-tabs [data-group="pawns"]')).toHaveAttribute('aria-selected', 'true');
  await expect(guide.locator('[data-piece="P"]')).toBeInViewport();
  await page.locator('#guide-back').click();
  await expect(guide).toBeHidden();
  await expect(page.locator('#placement')).toBeVisible();
});

test('a refused placement flashes its square, and a merged piece is not left selected', async ({ page }) => {
  await startRun(page);
  const pawn = () =>
    page
      .locator('.bench .piece')
      .filter({ has: page.getByAltText('Pawn', { exact: true }) })
      .first();
  // Pawns can't stand on the back row: the square flashes and the reason shows.
  await pawn().click();
  await page.locator('#board-root .square[data-file="1"][data-rank="0"]').click();
  await expect(page.locator('#board-root .square.rejected')).toHaveCount(1);
  await expect(page.locator('#message')).toContainText('back row');
  await expect(page.locator('#board-root .square.rejected')).toHaveCount(0); // the flash fades
  // Three plain pawns merge into a Knight, which isn't left selected.
  await page.getByRole('button', { name: /Merge 3 .*Knight/ }).click();
  await expect(page.locator('.bench .piece').filter({ has: page.getByAltText('Knight') })).toHaveCount(1);
  await expect(page.locator('.piece.selected')).toHaveCount(0);
});

test('Settings: sound off stays in step with the menu speaker and is kept; About links the privacy policy', async ({
  page,
}) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#menu-settings').click();
  await expect(page.locator('#settings')).toBeVisible();
  const sound = page.getByRole('switch', { name: 'Sound effects' });
  await expect(sound).toBeChecked();
  await sound.click();
  await expect(sound).not.toBeChecked();
  await expect(page.locator('#set-volume')).toBeDisabled();
  // A default speed for battles, and the privacy policy in About.
  await page.locator('#set-speed [data-speed="4"]').click();
  await expect(page.locator('#set-speed [data-speed="4"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', /privacy\.html$/);
  await page.locator('#settings-back').click();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');

  await page.reload();
  await expect(page.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#menu-settings').click();
  await expect(sound).not.toBeChecked();
  await expect(page.locator('#set-speed [data-speed="4"]')).toHaveAttribute('aria-checked', 'true');
  const response = await page.request.get('privacy.html');
  expect(response.ok()).toBe(true);
});
