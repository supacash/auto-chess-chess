import { devices, expect, type Page, test, type TestInfo } from '@playwright/test';
import { placeKing, startRun } from './helpers';

// Landscape layouts (DESIGN.md, Look and feel): the board never grows taller than the screen, and
// landscape phones and touch tablets get two columns, board on the left. Each check also saves a
// screenshot with the test results, to look over by eye.

/** A device's screen, without the browser type (which can't be set per test group). */
function screen(name: string) {
  const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = devices[name];
  return { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent };
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  height: number;
}

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`${selector} isn't shown`);
  return { left: b.x, right: b.x + b.width, top: b.y, bottom: b.y + b.height, height: b.height };
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

/** Nothing scrolls sideways, and the screen's board fits the window's height. */
async function expectFits(page: Page, board: string): Promise<void> {
  const { scrollWidth, innerWidth, innerHeight } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  expect((await box(page, `${board} .board`)).height).toBeLessThanOrEqual(innerHeight);
}

for (const device of ['Pixel 7 landscape', 'Galaxy Tab S4 landscape']) {
  test.describe(device, () => {
    test.use(screen(device));

    test('the shop and battle screens use two columns', async ({ page }, testInfo) => {
      await startRun(page);
      await placeKing(page);

      // Shop: the board on the left, the shop on the right, the fight bar on screen.
      await expectFits(page, '#board-root');
      const board = await box(page, '#board-root');
      expect((await box(page, '#placement .shop')).left).toBeGreaterThanOrEqual(board.right);
      // The title, run bar and Menu share one row.
      expect(Math.abs((await box(page, '.run-bar')).top - (await box(page, 'header h1')).top)).toBeLessThan(12);
      const fight = await box(page, '.fight-bar');
      expect(fight.left).toBeGreaterThanOrEqual(board.right);
      expect(fight.bottom).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
      await attachScreenshot(page, testInfo, 'shop');

      // Battle: the board on the left, the playback and result card on the right.
      await page.locator('#fight').click();
      await expect(page.locator('#battle')).toBeVisible();
      await expectFits(page, '#battle-root');
      const battleBoard = await box(page, '#battle-root');
      expect((await box(page, '#playback')).left).toBeGreaterThanOrEqual(battleBoard.right);
      await page.locator('#skip').click();
      await expect(page.locator('#result')).toBeVisible({ timeout: 120_000 });
      expect((await box(page, '#result')).left).toBeGreaterThanOrEqual(battleBoard.right);
      await attachScreenshot(page, testInfo, 'result');
    });
  });
}

test.describe('a short landscape phone (568×300)', () => {
  test.use({ ...screen('Pixel 7 landscape'), viewport: { width: 568, height: 300 } });

  test('keeps the whole board and bench on screen while the shop scrolls', async ({ page }, testInfo) => {
    await startRun(page);
    await expectFits(page, '#board-root');
    await page.mouse.wheel(0, 400);
    await expect.poll(async () => (await box(page, '#board-root')).top).toBeLessThan(20); // pinned
    expect((await box(page, '#board-root')).bottom).toBeLessThanOrEqual(300);
    await attachScreenshot(page, testInfo, 'shop');
  });
});

test.describe('portrait, 360px wide', () => {
  test.use({ ...screen('Pixel 7'), viewport: { width: 360, height: 740 } });

  test('keeps one column, with the board as wide as the page allows', async ({ page }, testInfo) => {
    await startRun(page);
    await expectFits(page, '#board-root');
    const board = await box(page, '#board-root');
    // The shop is under the board, not beside it.
    expect((await box(page, '#placement .shop')).top).toBeGreaterThanOrEqual(board.bottom);
    expect(
      (await box(page, '#board-root .board')).right - (await box(page, '#board-root .board')).left,
    ).toBeGreaterThan(300);
    await attachScreenshot(page, testInfo, 'shop');
  });
});
