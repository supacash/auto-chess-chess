import { type Browser, expect, type Page, test } from '@playwright/test';

// Google sign-in and saved progress, against the emulators. Coming back from Google is simulated by
// opening the page with the ID token in the address, as Google's redirect does; the auth emulator
// accepts a plain JSON token in place of Google's signed one.
const token = JSON.stringify({ sub: 'player-1', email: 'player@pawned.test', email_verified: true });
const signInUrl = `./#id_token=${encodeURIComponent(token)}`;

/** Arrives back from Google: a full page load (a change of just the #fragment wouldn't reload). */
async function returnFromGoogle(page: Page, url = signInUrl): Promise<void> {
  await page.goto('about:blank');
  await page.goto(url);
}

async function device(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('./');
  await expect(page.locator('#menu')).toBeVisible();
  return page;
}

async function openProfile(page: Page): Promise<void> {
  await page.locator('#menu-profile').click();
  await expect(page.locator('#profile')).toBeVisible();
}

test('progress made on one device shows up on another signed in to the same account', async ({ browser }) => {
  // Device A plays a round signed out, then signs in: its progress goes up to the account.
  const a = await device(browser);
  await a.locator('#menu-new').click();
  await a.locator('#new-run-dialog').getByRole('button', { name: 'Start game' }).click();
  await a
    .locator('.bench .piece')
    .filter({ has: a.getByAltText('King') })
    .click();
  await a.locator('#board-root .square[data-file="2"][data-rank="0"]').click();
  await a.locator('#fight').click();
  await a.locator('#skip').click();
  await expect(a.locator('#result')).toBeVisible({ timeout: 120_000 });
  await a.locator('#next').click();
  await a.locator('#menu-button').click();
  await openProfile(a);
  await expect(a.locator('#account-signin')).toBeVisible();
  const recordA = (await a.locator('#profile-body .record-card').first().textContent())?.trim();

  await returnFromGoogle(a);
  await expect(a.locator('#menu')).toBeVisible();
  await openProfile(a);
  await expect(a.locator('#account-text')).toContainText('player@pawned.test');
  await expect(a.locator('#account-status')).toHaveText('Progress synced.', { timeout: 30_000 });
  await expect(a).toHaveURL(/\/$/); // the token is gone from the address bar

  // Device B starts fresh and signs in to the same account: A's records and run come down.
  const b = await device(browser);
  await expect(b.locator('#menu-resume')).toBeHidden();
  await returnFromGoogle(b);
  await expect(b.locator('#menu-resume')).toBeVisible({ timeout: 30_000 });
  await expect(b.locator('#menu-resume-detail')).toContainText('Round 2');
  await openProfile(b);
  await expect(b.locator('#account-status')).toHaveText('Progress synced.');
  await expect(b.locator('#profile-body .record-card').first()).toHaveText(recordA ?? '');

  // Signing out keeps the device's progress and offers sign-in again.
  await b.locator('#account-signout').click();
  await expect(b.locator('#account-signin')).toBeVisible();
  await expect(b.locator('#profile-body .record-card').first()).toHaveText(recordA ?? '');
});

test('deleting the account takes two taps and signs out', async ({ browser }) => {
  const page = await device(browser);
  const other = JSON.stringify({ sub: 'player-2', email: 'leaving@pawned.test', email_verified: true });
  await returnFromGoogle(page, `./#id_token=${encodeURIComponent(other)}`);
  await expect(page.locator('#menu')).toBeVisible();
  await openProfile(page);
  await expect(page.locator('#account-status')).toHaveText('Progress synced.', { timeout: 30_000 });
  await page.locator('#account-delete').click();
  await expect(page.locator('#account-delete')).toHaveText('Tap again to delete');
  await page.locator('#account-delete').click();
  await expect(page.locator('#account-signin')).toBeVisible({ timeout: 30_000 });
});
