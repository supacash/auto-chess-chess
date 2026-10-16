import { expect, test } from '@playwright/test';
import { placeKing } from './helpers';

test('the daily challenge: a gauntlet of five, its own save, then done for the day', async ({ page }) => {
  // A Friday: Fortress day.
  await page.clock.setFixedTime(new Date('2026-10-16T09:00:00Z'));
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const daily = page.locator('#menu-daily');
  await expect(daily).toContainText('Fortress');
  await daily.click();

  await expect(page.locator('#round')).toHaveText('Daily 1/5');
  await expect(page.locator('#opponent')).toContainText('Fortress');
  await page.locator('#gauntlet-open').click();
  await expect(page.locator('#gauntlet-dialog .gauntlet-battle')).toHaveCount(5);
  await expect(page.locator('#gauntlet-dialog .gauntlet-battle').last()).toContainText('9×9');
  await page.locator('#gauntlet-dialog').getByRole('button', { name: 'Close' }).click();

  await placeKing(page);
  await page.locator('#fight').click();
  await page.locator('#skip').click();
  await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('#next')).toHaveText('Next battle');
  await page.locator('#next').click();
  await expect(page.locator('#round')).toHaveText('Daily 2/5');

  // Kept apart from the normal run: the menu offers no Resume game, but resumes the daily.
  await page.reload();
  await expect(page.locator('#menu-resume')).toBeHidden();
  await expect(daily).toContainText('Resume · battle 2/5');

  // Skip ahead to the last battle and finish it.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('acc.daily.v1')!);
    save.run.round = 10;
    save.run.record = { w: 3, l: 1, d: 0 };
    localStorage.setItem('acc.daily.v1', JSON.stringify(save));
  });
  await page.reload();
  await daily.click();
  await expect(page.locator('#round')).toHaveText('Daily 5/5');
  await page.locator('#fight').click();
  await page.locator('#skip').click();
  await expect(page.locator('#result-title')).toHaveText(/Daily challenge done|Gauntlet cleared/i, {
    timeout: 120_000,
  });
  await expect(page.locator('#result-stats')).toContainText('Day streak');
  await page.locator('#next').click();
  await expect(daily).toBeDisabled();
  await expect(daily).toContainText('Done today');
  await expect(daily).toContainText('🔥 1');

  await page.locator('#menu-profile').click();
  await page.locator('#profile-tabs [data-tab="daily"]').click();
  await expect(page.locator('#profile-body')).toContainText('Days played');
});
