import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_8 } from '../chess/boardSpec';
import { loadRulesForNode } from '../chess/testRules';
import { BASE_INCOME, isAffinityOffer } from '../rules/economy';
import { makePiece, PIECES } from '../rules/pieces';
import { armyErrors } from '../rules/placement';
import { seededRng } from '../rules/rng';
import { BLACK_GOLD, botArmy, pairRound, START_HP } from './match';
import { POOL_SIZE } from './pool';
import { MatchSession, withKingPlaced } from './matchSession';

beforeAll(loadRulesForNode);

const match = (seed = 11) =>
  new MatchSession(
    seed,
    'me',
    [
      { id: 'me', name: 'Me', bot: false },
      { id: 'bot1', name: 'Bot 1', bot: true },
      { id: 'bot2', name: 'Bot 2', bot: true },
      { id: 'bot3', name: 'Bot 3', bot: true },
    ],
    { blitz: false },
    seededRng(seed),
  );

describe('MatchSession', () => {
  it('starts in the shop on Classic 8×8 with standard offers only', () => {
    const m = match();
    expect(m.phase).toBe('shop');
    expect(m.board).toBe(BOARD_8);
    expect(m.shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P']);
    expect(m.shop.offers?.every((o) => isAffinityOffer(o) || PIECES[o].group === 'standard')).toBe(true);
    expect(m.players.every((p) => p.hp === START_HP)).toBe(true);
  });

  it('locks armies (placing a forgotten king), pairs everyone, and builds legal battles', () => {
    const m = match();
    m.lockArmies();
    expect(m.phase).toBe('battle');
    expect(m.army('me').map((p) => p.type)).toEqual(['K']); // only the auto-placed king is on the board
    expect(armyErrors(m.army('me'), BOARD_8)).toEqual([]);
    expect(m.pairings).toHaveLength(2);
    expect(m.myPairing()).not.toBeNull();
    for (const p of m.pairings) {
      const b = m.battle(p);
      // Both armies are on the board: white's king at the bottom, black's mirrored at the top.
      if (b.start) expect(b.start.fen.split(' ')[0]).toMatch(/K/);
      if (b.start) expect(b.start.fen.split(' ')[0]).toMatch(/k/);
    }
  });

  it('applies results: damage, income and the next round’s shop', () => {
    const m = match();
    m.lockArmies();
    const mine = m.myPairing()!;
    const iAmWhite = mine.white === 'me';
    const goldBefore = m.shop.gold;
    m.finishRound(
      m.pairings.map((p) => ({
        pairing: p,
        winner: p === mine ? (iAmWhite ? 'b' : 'w') : 'draw', // I lose; the other battle is drawn
        material: { w: 10, b: 10 },
      })),
    );
    expect(m.me.hp).toBe(START_HP - 3); // round 1 + 10/5
    expect(m.round).toBe(2);
    expect(m.phase).toBe('shop');
    expect(m.shop.gold).toBe(goldBefore + 5 + (iAmWhite ? 0 : BLACK_GOLD)); // loss income (no streak yet), +1 as Black
    expect(m.streaks.get('me')).toBe(-1);
    expect(m.pairings).toEqual([]);
  });

  it('pays the Black bonus to whoever played Black', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = match(seed);
      m.lockArmies();
      const mine = m.myPairing()!;
      const before = m.shop.gold;
      m.finishRound([{ pairing: mine, winner: 'draw', material: { w: 0, b: 0 } }]);
      expect(m.shop.gold - before).toBe(6 + (mine.black === 'me' ? BLACK_GOLD : 0));
    }
  });

  it('ends for the player when they are knocked out', () => {
    const m = match();
    m.players = m.players.map((p) => (p.id === 'me' ? { ...p, hp: 1 } : p));
    m.lockArmies();
    const mine = m.myPairing()!;
    m.finishRound([{ pairing: mine, winner: mine.white === 'me' ? 'b' : 'w', material: { w: 0, b: 0 } }]);
    expect(m.me.place).toBe(4);
    expect(m.phase).toBe('over');
  });

  it('places a benched king on a central back-row square', () => {
    const m = match();
    const placed = withKingPlaced(m.shop.pieces, BOARD_8);
    expect(placed.find((p) => p.type === 'K')!.square).toEqual({ file: 3, rank: 0 });
  });

  it('shows the next opponent’s pieces (types only) as soon as the shop opens', () => {
    const m = match();
    const next = m.opponent()!;
    const pairing = pairRound(m.players, m.seed, 1).find((p) => p.white === 'me' || p.black === 'me')!;
    const id = pairing.white === 'me' ? pairing.black : pairing.white;
    expect(next.name).toBe(m.player(id).name);
    // A bot's army is known; no squares are given away.
    expect(next.pieces.map((p) => p.type).sort()).toEqual(
      botArmy(m.seed, 1, id)
        .map((p) => p.type)
        .sort(),
    );
    expect(next.pieces.every((p) => p.square === null)).toBe(true);
    // The opponent is the one the round actually pairs.
    m.lockArmies();
    const real = m.myPairing()!;
    expect(real.white === id || real.black === id).toBe(true);
  });

  it('shows a person’s shared preview, or an empty army until they share one', () => {
    const m = new MatchSession(
      3,
      'me',
      [
        { id: 'me', name: 'Me', bot: false },
        { id: 'friend', name: 'Friend', bot: false },
      ],
      { blitz: false },
      seededRng(3),
    );
    expect(m.opponent()).toEqual({ name: 'Friend', pieces: [] });
    m.previews.set('friend', ['K', 'Q']);
    expect(m.opponent()!.pieces.map((p) => p.type)).toEqual(['K', 'Q']);
  });

  it('reports the player’s placed piece types when the army changes', () => {
    const m = match();
    const seen: string[][] = [];
    m.onArmyChange = (types) => seen.push(types);
    m.setPieces(withKingPlaced(m.shop.pieces, BOARD_8));
    expect(seen).toEqual([['K']]);
  });
});

describe('MatchSession.resume', () => {
  const shop = { gold: 5, pieces: [makePiece('K', { file: 4, rank: 0 }), makePiece('Q')], offers: ['N' as const] };
  const saved = (round: number) => ({ round, streak: 3, shop });

  it('picks up the saved shop and streak in the same round', () => {
    const m = match();
    m.resume(saved(4), 4);
    expect(m.round).toBe(4);
    expect(m.shop).toEqual(shop);
    expect(m.streaks.get('me')).toBe(3);
    expect(m.phase).toBe('shop');
  });

  it('adds base income for missed rounds and starts the streak over', () => {
    const m = match();
    m.resume(saved(4), 6);
    expect(m.round).toBe(6);
    expect(m.shop.gold).toBe(5 + 2 * BASE_INCOME);
    expect(m.shop.pieces).toEqual(shop.pieces);
    expect(m.shop.offers).not.toEqual(['N']);
    expect(m.streaks.get('me')).toBe(0);
  });

  it('perk rounds: three choices, a pick applies once (War chest gold, Squire knight) and is shared', () => {
    const m = match();
    expect(m.perkChoices()).toBeNull(); // round 1
    m.round = 3;
    const choices = m.perkChoices()!;
    expect(choices).toHaveLength(3);
    const shared: string[] = [];
    m.onPerkPick = (round, perk) => shared.push(`${round}:${perk}`);
    const gold = m.shop.gold;
    const pieces = m.shop.pieces.length;
    expect(m.choosePerk(choices[0])).toBe(true);
    expect(m.perkChoices()).toBeNull();
    expect(m.choosePerk(choices[1])).toBe(false); // one pick per perk round
    expect(shared).toEqual([`3:${choices[0]}`]);
    expect(m.perksOf('me')).toEqual([choices[0]]);
    if (choices[0] === 'chest') expect(m.shop.gold).toBe(gold + 5);
    if (choices[0] === 'squire') expect(m.shop.pieces.length).toBe(pieces + 1);
    // Bots have picked too.
    expect(m.perksOf('bot1')).toHaveLength(1);
  });

  it('offers Second wind only when the player has lost health', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const m = match(seed);
      m.round = 3;
      expect(m.perkChoices()).not.toContain('mend'); // full health
      m.players = m.players.map((p) => (p.id === 'me' ? { ...p, hp: 20 } : p));
      expect(m.perkChoices()).toHaveLength(3);
    }
    const hurt = Array.from({ length: 30 }, (_, i) => {
      const m = match(i + 1);
      m.round = 3;
      m.players = m.players.map((p) => (p.id === 'me' ? { ...p, hp: 20 } : p));
      return m.perkChoices()!;
    });
    expect(hurt.some((c) => c.includes('mend'))).toBe(true);
  });

  it('Haggler makes the first reroll each round free', () => {
    const m = match();
    m.round = 3;
    m.picks.set('me', { 3: 'haggler' });
    expect(m.rerollCost()).toBe(0);
    const gold = m.shop.gold;
    const r = m.rerollOffers();
    expect(r.ok && r.shop.gold).toBe(gold);
    expect(m.rerollCost()).toBe(1);
  });

  it('shares the player’s affinity pawns and counts everyone’s against the pool', () => {
    const m = match();
    const shared: unknown[] = [];
    m.onHeldChange = (h) => shared.push(h);
    const bots = m.players.filter((p) => p.bot).length;
    const before = m.poolLeft();
    const used = Object.values(POOL_SIZE).reduce((a, b) => a + b) - Object.values(before).reduce((a, b) => a + b);
    expect(used).toBe(bots * 2); // each bot holds a couple
    m.setShop({ ...m.shop, pieces: [...m.shop.pieces, makePiece('P', null, 'R')] });
    expect(shared).toEqual([{ R: 1 }]);
    expect(m.poolLeft().R).toBe(before.R - 1);
    m.held.set('friend', { R: 50 }); // not in the match: doesn't count
    expect(m.poolLeft().R).toBe(before.R - 1);
  });

  it('keeps what scouting shows: health by round, bots’ pawns and armies, and the locked board', () => {
    const m = match();
    expect(m.healthOf('bot1')).toEqual([START_HP]);
    expect(Object.values(m.holdingsOf('bot1'))).toEqual([2]);
    expect(m.currentTypes('bot1')).toEqual(botArmy(m.seed, 1, 'bot1').map((p) => p.type));
    m.lockArmies();
    expect(m.lockedBoard).toBe(BOARD_8);
    const mine = m.myPairing()!;
    m.finishRound([{ pairing: mine, winner: mine.white === 'me' ? 'b' : 'w', material: { w: 0, b: 0 } }]);
    expect(m.healthOf('me')).toEqual([START_HP, START_HP - 1]);
    // The round moved on, but its battles can still be rebuilt (to watch them).
    expect(m.battle(mine).start).not.toBeNull();
  });

  it('plays on without the player once they are knocked out (to watch)', () => {
    const m = match();
    m.players = m.players.map((p) => (p.id === 'me' ? { ...p, hp: 1 } : p));
    m.lockArmies();
    const mine = m.myPairing()!;
    m.finishRound([{ pairing: mine, winner: mine.white === 'me' ? 'b' : 'w', material: { w: 0, b: 0 } }]);
    expect(m.phase).toBe('over');
    m.startSpectatorRound();
    m.lockArmies();
    expect(m.round).toBe(2);
    expect(m.myPairing()).toBeNull();
    expect(m.pairings.flatMap((p) => [p.white, p.black])).not.toContain('me');
    m.finishRound(m.pairings.map((pairing) => ({ pairing, winner: 'w' as const, material: { w: 10, b: 0 } })));
    expect(m.phase).toBe('over');
    expect(m.healthOf('bot1').length).toBe(3);
  });
});
