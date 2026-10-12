import { type Browser, expect, type Page, test } from '@playwright/test';

// A whole 4-player online match (normal shop, no Blitz), played to the end by four browsers against
// the emulators. Long (tens of minutes), so it only runs when asked: npm run e2e:fullmatch.
//
// Each player shops with its own taste (knight-, bishop-, rook-pawns, or anything), merges sets,
// places everything it can and readies. Along the way it checks that every client agrees on health,
// perks and the shared pool, that perk picks show up on rounds 3/8/13, that a shop closes on the
// timer when someone never readies, that watching another battle works, and that knocked-out players
// can keep watching to the end, where everyone agrees on the winner.

test.skip(!process.env.FULL_MATCH, 'Set FULL_MATCH=1 (npm run e2e:fullmatch) to play a whole match');
test.setTimeout(90 * 60_000);

interface Player {
  name: string;
  page: Page;
  /** The affinity it buys first ('' = anything). */
  taste: 'N' | 'B' | 'R' | '';
  /** Which of the three perk choices it takes. */
  perkIndex: number;
  errors: string[];
  /** The app's console warnings (e.g. a failed upload), for diagnosing a stuck round. */
  warnings: string[];
  out: boolean;
}

const AFFINITY_NAME = { N: 'Knight-pawn', B: 'Bishop-pawn', R: 'Rook-pawn' } as const;

async function newPlayer(browser: Browser, name: string, taste: Player['taste'], perkIndex: number): Promise<Player> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const p: Player = { name, page, taste, perkIndex, errors: [], warnings: [], out: false };
  page.on('pageerror', (err) => p.errors.push(`pageerror: ${err.message}`));
  page.on('response', async (res) => {
    if (res.status() < 400) return;
    const body = await res.text().catch(() => '');
    p.errors.push(`http ${res.status()} ${res.url().replace(/[?].*/, '')} ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') p.errors.push(`console: ${msg.text()}`);
    if (msg.type() === 'warning')
      p.warnings.push(`${new Date().toISOString().slice(11, 19)} ${msg.text().slice(0, 200)}`);
  });
  await page.goto('./');
  await expect(page.locator('#menu')).toBeVisible();
  return p;
}

const inShop = (page: Page) => page.locator('#placement').isVisible();

/** Gold shown in the shop. */
async function gold(page: Page): Promise<number> {
  return Number(((await page.locator('#gold').textContent()) ?? '0').replace(/\D/g, '')) || 0;
}

/** One shopping turn: perk, buys, merges, placing, then Ready (unless `holdBack`). */
async function shop(p: Player, holdBack: boolean, log: string[]): Promise<void> {
  const { page } = p;
  const perk = page.locator('#perk-dialog[open]');
  if (await perk.isVisible()) {
    const choices = page.locator('#perk-choices button');
    const pick = choices.nth(p.perkIndex % (await choices.count()));
    log.push(`${p.name} picks ${(await pick.innerText()).split('\n')[0]}`);
    await pick.click();
  }
  // Buy: preferred kind first, then anything affordable, a few times.
  for (let buys = 0; buys < 6 && (await inShop(page)); buys++) {
    const offers = page.locator('#offers .offer');
    const n = await offers.count();
    const g = await gold(page);
    let chosen = -1;
    for (let pass = 0; pass < 2 && chosen < 0; pass++) {
      for (let i = 0; i < n; i++) {
        const text = await offers.nth(i).innerText();
        const price = Number(text.match(/(\d+)g/)?.[1] ?? 99);
        if (price > g || /sold out/.test(text)) continue;
        if (pass === 0 && p.taste && !text.includes(AFFINITY_NAME[p.taste])) continue;
        chosen = i;
        break;
      }
    }
    if (chosen < 0) {
      // Nothing to buy: reroll once if it's cheap and there's spare gold.
      if (g >= 4 && buys === 0) await page.locator('#reroll').click();
      else break;
      continue;
    }
    await offers.nth(chosen).click();
    const buy = page.locator('#offer-detail [data-buy]');
    if (await buy.isDisabled()) break; // bench full
    await buy.click();
  }
  // Merge any complete set.
  for (let tries = 0; tries < 4 && (await inShop(page)); tries++) {
    let merged = false;
    const pieces = page.locator('#board-root .piece');
    const count = await pieces.count();
    for (let i = 0; i < count && !merged; i++) {
      await pieces.nth(i).click();
      const merge = page.locator('#piece-actions [data-merge-set]').first();
      if (await merge.isVisible()) {
        log.push(`${p.name} merges → ${(await merge.innerText()).replace(/\s+/g, ' ').trim()}`);
        await merge.click();
        merged = true;
      }
    }
    if (!merged) break;
  }
  // Place everything on the bench that fits (the king first).
  for (let tries = 0; tries < 16 && (await inShop(page)); tries++) {
    const king = page.locator('.bench .piece').filter({ has: page.getByAltText('King') });
    const next = (await king.count()) ? king.first() : page.locator('.bench .piece').first();
    if (!(await next.count())) break;
    await next.click();
    const target = page.locator('#board-root .square.legal:not(:has(.piece))').first();
    if (!(await target.count())) break;
    await target.click();
  }
  if (!holdBack && (await inShop(page))) {
    const fight = page.locator('#fight');
    if (await fight.isEnabled()) await fight.click();
  }
}

/** Name → HP as one client sees the health list ("You" resolved to that player's name). */
async function healthList(p: Player): Promise<Record<string, string>> {
  const rows = await p.page.locator('#match-players .player').all();
  const out: Record<string, string> = {};
  for (const row of rows) {
    // The name is the span's first text (tags such as streaks and perks follow in <small>s).
    const name = (await row.locator('.name').evaluate((el) => el.firstChild?.textContent ?? '')).trim();
    const perks = (await row.locator('.perks').count()) ? await row.locator('.perks').innerText() : '';
    const label = name === 'You' ? p.name : name;
    out[label] = `${await row.locator('.hp').innerText()}${perks ? ` ${perks}` : ''}`;
  }
  return out;
}

/** What a client is showing, for diagnosing a stuck round. */
async function state(page: Page): Promise<string> {
  const text = async (sel: string) =>
    (await page.locator(sel).isVisible()) ? (await page.locator(sel).innerText()).replace(/\s+/g, ' ') : '-';
  const names = (await page.locator('#match-players .name').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  return [
    `hud=${await text('#match-round')}`,
    `status=${await text('#battle-status')}`,
    `card=${await text('#result-title')} ${await text('#result-detail')}`,
    `next=${await text('#next')}`,
    `shop=${await page.locator('#placement').isVisible()}`,
    `players=${names.join(' / ')}`,
  ].join(' | ');
}

/** Pool counts shown on a client's offers, by kind. */
async function poolView(p: Player): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const text of await p.page.locator('#offers .offer').allInnerTexts()) {
    const kind = text.match(/(Knight|Bishop|Rook|Queen)-pawn/)?.[1];
    const left = text.match(/(\d+) left/)?.[1] ?? (/sold out/.test(text) ? '0' : null);
    if (kind && left !== null) out[kind] = Number(left);
  }
  return out;
}

test('four people play a whole online match to the end', async ({ browser }) => {
  const players = [
    await newPlayer(browser, 'P1', 'R', 0),
    await newPlayer(browser, 'P2', 'N', 1),
    await newPlayer(browser, 'P3', 'B', 2),
    await newPlayer(browser, 'P4', '', 0),
  ];
  const [host, ...guests] = players;
  const log: string[] = [];
  const note = (line: string) => {
    log.push(line);
    console.log(line);
  };

  // Lobby: host creates a normal (not Blitz) room, the others join; all four seats are people.
  await host.page.locator('#menu-multiplayer').click();
  await host.page.locator('#match-dialog').getByRole('button', { name: 'Create room' }).click();
  await expect(host.page.locator('#lobby-code')).toHaveText(/^[A-Z]{4}$/, { timeout: 30_000 });
  const code = (await host.page.locator('#lobby-code').textContent())!.trim();
  await expect(host.page.locator('#lobby-rules')).toHaveText('Classic · Standard pieces');
  for (const g of guests) {
    await g.page.locator('#menu-multiplayer').click();
    await g.page.locator('#mp-code').fill(code);
    await g.page.locator('#match-dialog').getByRole('button', { name: 'Join room' }).click();
    await expect(g.page.locator('#lobby-code')).toHaveText(code);
  }
  await expect(host.page.locator('#lobby-start')).toHaveText('Start match');
  await host.page.locator('#lobby-start').click();
  // The names in the health list are the generated ones: learn each player's.
  for (const p of players) {
    await expect(p.page.locator('#match-players .player')).toHaveCount(4, { timeout: 30_000 });
    await expect(p.page.locator('#match-players small', { hasText: 'bot' })).toHaveCount(0);
  }
  const names = new Map<Player, string>();
  for (const p of players) {
    // Scouting yourself shows "You"; the lobby showed the generated name with "you" next to it.
    names.set(p, p.name);
  }
  note(`Room ${code}: 4 people, normal shop`);

  let winnerSeen = '';
  try {
    for (let round = 1; round <= 30; round++) {
      const active = players.filter((p) => !p.out);
      // Every client still playing opens the same round's shop.
      for (const p of active) {
        await expect(p.page.locator('#match-round')).toContainText(`Round ${round} · Shop`, { timeout: 180_000 });
      }
      // Health, perks and the pool agree everywhere (as each client sees them at shop open).
      const views = await Promise.all(active.map(healthList));
      const hp = (v: Record<string, string>) =>
        Object.values(v)
          .map((x) => x.split(' ')[0])
          .sort()
          .join(',');
      for (const v of views) expect(hp(v), 'health lists match').toBe(hp(views[0]));
      const perkSets = views.map((v) =>
        Object.values(v)
          .map((x) => x.split(' ')[1] ?? '')
          .sort()
          .join(','),
      );
      for (const s of perkSets) expect(s, 'perk icons match').toBe(perkSets[0]);
      const pools = await Promise.all(active.map(poolView));
      const merged: Record<string, number> = {};
      for (const pool of pools) {
        for (const [kind, left] of Object.entries(pool)) {
          if (kind in merged) expect(left, `pool count for ${kind}-pawns matches`).toBe(merged[kind]);
          else merged[kind] = left;
        }
      }
      const perkRound = [3, 8, 13].includes(round);
      for (const p of active) {
        if (perkRound) await expect(p.page.locator('#perk-dialog')).toBeVisible();
        else expect(await p.page.locator('#perk-dialog[open]').count()).toBe(0);
      }
      for (const p of active)
        note(
          `  ${p.name} sees: ${(await p.page.locator('#match-players .name').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ')).join(' / ')}`,
        );
      note(`Round ${round}: health ${JSON.stringify(views[0])} · pool ${JSON.stringify(merged)}`);

      // Scout one opponent each round (the dialog opens and closes).
      const scout = active[0].page;
      if (!perkRound) {
        await scout.locator('#match-players li[data-id]').nth(1).click();
        await expect(scout.locator('#scout-dialog')).toBeVisible();
        await expect(scout.locator('#scout-body')).toContainText('Perks');
        await scout.locator('#scout-dialog button[value="close"]').click();
      }

      // Shop. In round 2 the last player never readies: the shop closes on the 45 s timer.
      const roundLog: string[] = [];
      const holdBackPlayer = round === 2 ? active[active.length - 1] : null;
      const started = Date.now();
      await Promise.all(active.map((p) => shop(p, p === holdBackPlayer, roundLog)));
      for (const line of roundLog) note(`  ${line}`);

      // Battles: everyone's starts; skip to the end.
      for (const p of active) {
        await expect(p.page.locator('#battle')).toBeVisible({ timeout: 90_000 });
      }
      if (holdBackPlayer) note(`  shop closed by the timer after ${Math.round((Date.now() - started) / 1000)} s`);
      await Promise.all(
        active.map(async (p) => {
          await p.page
            .locator('#skip')
            .click({ timeout: 10_000 })
            .catch(() => {});
          await expect(p.page.locator('#result')).toBeVisible({ timeout: 300_000 });
        }),
      );

      // One player watches another battle of the round, then comes back to the card.
      const watcher = active[1] ?? active[0];
      if (watcher && round % 2 === 1) {
        const watch = watcher.page.locator('#card-extras button', { hasText: 'Watch' }).first();
        if (await watch.isVisible()) {
          note(`  ${watcher.name} ${(await watch.innerText()).toLowerCase()}`);
          await watch.click();
          await watcher.page
            .locator('#skip')
            .click({ timeout: 10_000 })
            .catch(() => {});
          await expect(watcher.page.locator('#result')).toBeVisible({ timeout: 300_000 });
        }
      }

      // Continue: on to the next round, or final places (online, a round's final card comes once the
      // room has applied it, so a winner or knockout shows up after Continue).
      const outcome = async (page: Page): Promise<string> => {
        if (await page.locator('#placement').isVisible()) return 'shop';
        const title = (await page.locator('#result').isVisible())
          ? await page.locator('#result-title').innerText()
          : '';
        return /You win the match|You finished/.test(title) ? 'final' : 'waiting';
      };
      await Promise.all(
        active.map(async (p) => {
          if ((await outcome(p.page)) !== 'final') await p.page.locator('#next').click();
          await expect
            .poll(() => outcome(p.page), { timeout: 300_000 })
            .not.toBe('waiting')
            .catch(async (err) => {
              for (const q of players) note(`STATE ${q.name}: ${await state(q.page)}`);
              throw err;
            });
        }),
      );
      for (const p of active) {
        if ((await outcome(p.page)) !== 'final') continue;
        const title = await p.page.locator('#result-title').innerText();
        p.out = true;
        if (/You win the match/.test(title)) {
          winnerSeen = p.name;
          note(`  ${p.name}: ${title}`);
          continue;
        }
        const keep = p.page.locator('#card-extras button', { hasText: 'Keep watching' });
        const canKeep = await keep.isVisible();
        note(`  ${p.name}: ${title}${canKeep ? ' (keeps watching)' : ''}`);
        if (canKeep) await keep.click();
      }
      if (players.every((p) => p.out)) break;
    }
  } catch (err) {
    for (const q of players) {
      note(`STATE ${q.name}: ${await state(q.page).catch(() => '?')}`);
      note(`WARN ${q.name}: ${q.warnings.slice(-8).join(' | ')}`);
      note(`ERRORS ${q.name}: ${q.errors.filter((e) => !/documents:commit|Failed to load/.test(e)).join(' | ')}`);
    }
    throw err;
  }

  // Everyone, spectators included, ends on the same winner.
  expect(winnerSeen, 'someone won').not.toBe('');
  for (const p of players.filter((x) => x.name !== winnerSeen)) {
    await expect(p.page.locator('#result-title')).toContainText(/won the match|You finished/, { timeout: 240_000 });
    note(`${p.name} sees: ${await p.page.locator('#result-title').innerText()}`);
  }
  const spectators = players.filter((x) => x.name !== winnerSeen);
  const titles = await Promise.all(spectators.map((p) => p.page.locator('#result-title').innerText()));
  const winnerNames = titles.filter((t) => /won the match/.test(t));
  for (const t of winnerNames) expect(t, 'spectators agree on the winner').toBe(winnerNames[0]);

  for (const p of players) {
    // Transactions that lose a race (everyone tries to close the shop / end the round) are rejected
    // and retried by Firestore: expected, not an error.
    const serious = p.errors.filter(
      (e) => !/Failed to load resource/.test(e) && !/documents:commit .*FAILED_PRECONDITION|ABORTED/.test(e),
    );
    const raced = p.errors.filter((e) => /documents:commit/.test(e));
    if (raced.length) note(`${p.name}: ${raced.length} rejected commits, e.g. ${raced[0]}`);
    expect(serious, `${p.name} had no page errors`).toEqual([]);
  }
  void names;
});
