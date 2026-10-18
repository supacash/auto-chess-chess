import { expect, test } from '@playwright/test';

/** A Synergies run at round 7 (8×8): Infantry, Cavalry and Siege active for the player, Cavalry for the AI. */
function synergySave() {
  let n = 0;
  const at = (type: string, file: number, rank: number) => ({ id: `s${n++}`, type, square: { file, rank } });
  return {
    version: 3,
    run: {
      round: 7,
      lives: 3,
      record: { w: 4, l: 2, d: 0 },
      shop: {
        gold: 6,
        pieces: [
          at('K', 4, 0),
          ...[0, 1, 2, 3, 4, 5, 6, 7].map((f) => at('P', f, 1)),
          at('N', 1, 0),
          at('N', 6, 0),
          at('N', 3, 2),
          at('X', 0, 0),
          at('X', 7, 0),
          at('F', 2, 0),
          at('M', 4, 2),
        ],
        offers: ['X', 'N', 'F', 'L'],
      },
      settings: {
        mode: 'growing',
        difficulty: 'normal',
        reveal: false,
        side: 'white',
        fairy: true,
        manual: false,
        synergies: true,
      },
      color: 'w',
      prestige: 0,
      perks: [],
    },
    ai: {
      styleId: 'cavalry',
      pieces: [
        at('K', 4, 0),
        at('N', 1, 0),
        at('N', 6, 0),
        at('N', 2, 2),
        at('L', 5, 2),
        at('B', 2, 0),
        ...[1, 2, 3, 4, 5, 6].map((f) => at('P', f, 1)),
      ],
    },
  };
}

test('New game offers Synergies only with fairy pieces', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator('#menu-new').click();
  const synergies = page.locator('#nr-synergies');
  await expect(synergies).toBeEnabled();
  await page.locator('#nr-fairy').uncheck();
  await expect(synergies).toBeDisabled();
  await page.locator('#nr-fairy').check();
  await synergies.check();
  await page.getByRole('button', { name: 'Start game' }).click();
  // No pieces on the board yet: no synergies, and the ? explains them.
  await expect(page.locator('#synergies')).toContainText('no synergies yet');
  await page.locator('[data-syn="help"]').click();
  await expect(page.locator('#synergy-info')).toContainText('pieces belong to families by how they move');
});

test('Synergies: each side’s families, the upgraded pieces marked, and the upgrades at the battle’s start', async ({
  page,
}) => {
  await page.goto('./');
  await page.evaluate((save) => {
    localStorage.clear();
    localStorage.setItem('acc.run.v1', JSON.stringify(save));
  }, synergySave());
  await page.reload();
  await expect(page.locator('#menu-resume-detail')).toContainText('Synergies');
  await page.locator('#menu-resume').click();

  // Yours: Infantry (8 pawns), Cavalry (3 leapers) and Siege (2 Cannons) each upgrade one piece; Guard (2) not yet.
  for (const id of ['infantry', 'cavalry', 'siege']) {
    await expect(page.locator(`[data-syn="you:${id}"]`)).toHaveClass(/\bon\b/);
  }
  await expect(page.locator('[data-syn="you:guard"]')).not.toHaveClass(/\bon\b/);
  await expect(page.locator('[data-syn="them:cavalry"]')).toBeVisible();
  // The three upgraded pieces are marked on the board (the opponent's stay hidden).
  await expect(page.locator('#board-root .piece.upgraded')).toHaveCount(3);
  await page.locator('[data-syn="you:cavalry"]').click();
  await expect(page.locator('#synergy-info')).toContainText('your Knight on d3 fights as a Centaur');

  await page.locator('#fight').click();
  await expect(page.locator('#battle-announce')).toContainText(
    'Synergies! You: Pawn → Knight, Knight → Centaur, Cannon → Siege Cannon. Them: Knight → Centaur.',
  );
});
