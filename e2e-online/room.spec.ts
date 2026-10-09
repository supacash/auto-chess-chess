import { type Browser, expect, type Page, test } from '@playwright/test';

/** A fresh player: a new browser context (its own anonymous account) on the game. */
async function player(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('./');
  // Skip the single-player New run window.
  await page.locator('#new-run-dialog').getByRole('button', { name: 'Start run' }).click();
  return page;
}

async function openMultiplayer(page: Page): Promise<void> {
  await page.locator('#multiplayer').click();
  await expect(page.locator('#match-dialog')).toBeVisible();
}

async function placeKingAndReady(page: Page): Promise<void> {
  await page
    .locator('.bench .piece')
    .filter({ has: page.getByAltText('King') })
    .click();
  await page.locator('#board-root .square[data-file="4"][data-rank="0"]').click();
  await page.locator('#fight').click();
}

test('two players create and join a room, play a round together, and move on to round 2', async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);

  // Host creates a room.
  await openMultiplayer(host);
  await host.locator('#match-dialog').getByRole('button', { name: 'Create room' }).click();
  await expect(host.locator('#lobby-code')).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const code = (await host.locator('#lobby-code').textContent())!.trim();
  await expect(host.locator('#lobby-seats .seat')).toHaveCount(4);
  await expect(host.locator('#lobby-start')).toHaveText('Start with 3 bots');

  // Guest joins with the code.
  await openMultiplayer(guest);
  await guest.locator('#mp-code').fill(code.toLowerCase());
  await guest.locator('#match-dialog').getByRole('button', { name: 'Join room' }).click();
  await expect(guest.locator('#lobby-code')).toHaveText(code);
  await expect(guest.locator('#lobby-start')).toBeHidden();
  await expect(host.locator('#lobby-start')).toHaveText('Start with 2 bots');

  // Host starts: both are in the match, with two people and two bots.
  await host.locator('#lobby-start').click();
  for (const page of [host, guest]) {
    await expect(page.locator('#match-hud')).toBeVisible();
    await expect(page.locator('#match-players .player')).toHaveCount(4);
    await expect(page.locator('#match-players small', { hasText: 'bot' })).toHaveCount(2);
    await expect(page.locator('#match-round')).toContainText(`Round 1 · Shop · 4 left · Room ${code}`);
  }

  // The host readies first and waits; the guest's Ready closes the shop for both.
  await placeKingAndReady(host);
  await expect(host.locator('#message')).toContainText('Waiting for the other players');
  await expect(guest.locator('#match-players')).toContainText('ready');
  await placeKingAndReady(guest);

  for (const page of [host, guest]) {
    await expect(page.locator('#battle')).toBeVisible();
    await page.locator('#skip').click();
  }
  for (const page of [host, guest]) {
    await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
    await expect(page.locator('#next')).toHaveText('Round 2');
  }

  // Both continue; once both have, the next shop opens for everyone with the same health list.
  await host.locator('#next').click();
  await expect(host.locator('#battle-status')).toContainText('Waiting for the other players');
  await guest.locator('#next').click();
  for (const page of [host, guest]) {
    await expect(page.locator('#match-round')).toContainText('Round 2 · Shop', { timeout: 60_000 });
  }
  const health = async (page: Page) =>
    (await page.locator('#match-players .player').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());
  const hostView = (await health(host)).map((t) => t.replace(/^You/, '?'));
  const guestView = (await health(guest)).map((t) => t.replace(/^You/, '?'));
  expect(hostView.map((t) => t.split(' ').at(-1))).toEqual(guestView.map((t) => t.split(' ').at(-1)));
});

test('a player who leaves mid-shop is timed out and the match carries on', async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);

  await openMultiplayer(host);
  await host.locator('#mp-blitz').check();
  await host.locator('#match-dialog').getByRole('button', { name: 'Create room' }).click();
  await expect(host.locator('#lobby-code')).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const code = (await host.locator('#lobby-code').textContent())!.trim();

  await openMultiplayer(guest);
  await guest.locator('#mp-code').fill(code);
  await guest.locator('#match-dialog').getByRole('button', { name: 'Join room' }).click();
  await expect(host.locator('#lobby-start')).toHaveText('Start with 2 bots');
  await host.locator('#lobby-start').click();
  await expect(guest.locator('#match-hud')).toBeVisible();

  // The guest walks away; the host readies. The 15 s Blitz shop closes without the guest.
  await guest.context().close();
  await placeKingAndReady(host);
  await expect(host.locator('#battle')).toBeVisible({ timeout: 40_000 });
  await host.locator('#skip').click();
  await expect(host.locator('#result')).toBeVisible({ timeout: 120_000 });
});
