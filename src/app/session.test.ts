import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import type { BattleResult } from '../rules/battle';
import { OFFER_COUNT } from '../rules/economy';
import { seededRng } from '../rules/rng';
import { FINAL_ROUND, isRunOver, START_LIVES } from '../rules/run';
import { synergyUpgrades } from '../rules/synergy';
import { Session } from './session';

beforeAll(loadRulesForNode);

/** Minimal in-memory localStorage so saving and loading run as in the browser. */
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

const result = (winner: BattleResult['winner']): BattleResult => ({
  winner,
  reason: 'checkmate',
  material: { w: 0, b: 0 },
  plies: 10,
});

/** A session with its king placed, ready to fight. */
function ready(seed = 1): Session {
  const s = new Session(seededRng(seed));
  s.restore();
  s.setPieces(s.run.shop.pieces.map((p) => (p.type === 'K' ? { ...p, square: { file: 2, rank: 0 } } : p)));
  return s;
}

describe('Session', () => {
  it('starts a default Growing run on a first visit, with an opponent drafted for the board', () => {
    const s = new Session(seededRng(1));
    expect(s.restore()).toEqual({ notice: '', firstVisit: true });
    expect(s.run.settings.mode).toBe('growing');
    expect(s.board.files).toBe(5);
    expect(s.aiPieces.some((p) => p.type === 'K')).toBe(true);
  });

  it('resumes the saved run on the next visit', () => {
    const s = ready();
    const again = new Session(seededRng(2));
    expect(again.restore().firstVisit).toBe(false);
    expect(again.run).toEqual(s.run);
    expect(army(again.aiPieces)).toEqual(army(s.aiPieces));
  });

  it('builds a legal start position and advances the round after a battle', () => {
    const s = ready();
    expect(s.armyErrors()).toEqual([]);
    expect(s.resolveStart().fen).toMatch(/ [wb] - - 0 1$/);
    const outcome = s.finishBattle(result('w'));
    expect(outcome).toMatchObject({ playedRound: 1, over: false, won: false, score: 1, newBest: false });
    expect(outcome.record).toEqual({ w: 1, l: 0, d: 0 });
    expect(s.run.round).toBe(2);
  });

  it('plays with synergies in a run that has them, and without in one that doesn’t', () => {
    const s = ready();
    // Three Knights on the board: Cavalry upgrades the front one.
    const knights = [0, 1, 4].map((file, i) => ({ id: `n${i}`, type: 'N' as const, square: { file, rank: 1 } }));
    s.setPieces([...s.run.shop.pieces.filter((p) => p.type === 'K'), ...knights]);
    expect(s.resolveStart().synergies).toBeUndefined();
    s.run = { ...s.run, settings: { ...s.run.settings, synergies: true } };
    const start = s.resolveStart();
    expect(start.synergies?.upgrades.filter((u) => u.side === 'w').map((u) => [u.id, u.to])).toEqual([['n1', 'T']]);
    expect(start.fen.split(' ')[0]).toContain('T');
  });

  it('drafts opponents that build for synergies in a run that has them', () => {
    // Round 13 (9×9) with fairy pieces: how many of the opponents' pieces their synergies upgrade.
    const upgraded = (synergies: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const s = ready(seed);
        s.run = { ...s.run, round: 13, settings: { ...s.run.settings, fairy: true, synergies } };
        s.draftOpponent();
        total += synergyUpgrades(s.aiPieces, s.board).length;
      }
      return total / 20;
    };
    const by = upgraded(false);
    expect(upgraded(true)).toBeGreaterThan(by + 1);
  });

  it('ends the run after the last life and records a new best', () => {
    const s = ready();
    s.finishBattle(result('w'));
    let outcome = s.finishBattle(result('b'));
    for (let i = 1; i < START_LIVES; i++) outcome = s.finishBattle(result('b'));
    expect(outcome).toMatchObject({ over: true, score: 1, newBest: true });
    expect(s.best).toBe(1);
    // The finished run's save is cleared: the next visit is a fresh start.
    expect(new Session(seededRng(3)).restore().firstVisit).toBe(true);
  });

  it('revives a lost run once: a life back, the next round and a saved run again', () => {
    const s = ready();
    s.finishBattle(result('w'));
    for (let i = 0; i < START_LIVES; i++) s.finishBattle(result('b'));
    expect(isRunOver(s.run)).toBe(true);
    expect(s.canRevive()).toBe(true);
    expect(s.revive()).toBe(true);
    expect(s.run).toMatchObject({ lives: 1, round: START_LIVES + 2, revived: true });
    expect(s.aiPieces.some((p) => p.type === 'K')).toBe(true);
    // Saved again, so the menu offers Resume.
    expect(new Session(seededRng(3)).restore().firstVisit).toBe(false);

    s.setPieces(s.run.shop.pieces.map((p) => (p.type === 'K' ? { ...p, square: { file: 2, rank: 0 } } : p)));
    expect(s.finishBattle(result('b'))).toMatchObject({ over: true });
    expect(s.canRevive()).toBe(false);
    expect(s.revive()).toBe(false);
  });

  it('counts a battle left unfinished as a loss on the next visit', () => {
    const s = ready();
    s.resolveStart();
    s.persist(true);
    const again = new Session(seededRng(4));
    const { notice } = again.restore();
    expect(notice).toMatch(/interrupted and counted as a loss/);
    expect(again.run.lives).toBe(START_LIVES - 1);
    expect(again.run.round).toBe(2);
  });

  it('starts a new run with the chosen mode, board and starting army', () => {
    const s = ready();
    s.finishBattle(result('w'));
    s.startNewRun({ mode: 'classic', difficulty: 'hard', reveal: true, side: 'white', fairy: true, manual: false });
    expect(s.run.round).toBe(1);
    expect(s.board.files).toBe(8);
    expect(s.run.shop.pieces.map((p) => p.type)).toEqual(['K', 'P', 'P', 'P']);
    expect(s.run.settings).toEqual({
      mode: 'classic',
      difficulty: 'hard',
      reveal: true,
      side: 'white',
      fairy: true,
      manual: false,
    });
  });

  it('stocks the shop with fresh offers every round, and keeps them across a reload', () => {
    const s = ready();
    expect(s.run.shop.offers).toHaveLength(OFFER_COUNT);
    s.setShop({ ...s.run.shop, offers: ['X'] });
    const again = new Session(seededRng(9));
    again.restore();
    expect(again.run.shop.offers).toEqual(['X']);
    again.finishBattle(result('w'));
    expect(again.run.shop.offers).toHaveLength(OFFER_COUNT);
  });

  it('saves a manual game so a reload resumes it instead of counting a loss', () => {
    const s = ready();
    const manual = { fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1', moves: ['e1d1'], seed: 5 };
    s.saveManual(manual);
    const again = new Session(seededRng(9));
    expect(again.restore().notice).toBe('');
    expect(again.manual).toEqual(manual);
    expect(again.run.lives).toBe(START_LIVES);
    again.finishBattle(result('w'));
    expect(again.manual).toBeNull();
  });

  it('gives Haggler free rerolls each round, then charges again', () => {
    const s = ready();
    s.startPrestige('freeReroll');
    s.setShop({ ...s.run.shop, gold: 5 });
    for (const cost of [0, 0, 0, 1]) {
      expect(s.rerollCost()).toBe(cost);
      const r = s.rerollOffers();
      expect(r.ok).toBe(true);
      if (r.ok) s.setShop(r.shop);
    }
    expect(s.run.shop.gold).toBe(4);
    // A new round brings more.
    s.run = { ...s.run, round: s.run.round + 1 };
    expect(s.rerollCost()).toBe(0);
  });

  it('shows the opponent with Spyglass or the Reveal setting, and pays Banker interest', () => {
    const s = ready();
    expect(s.revealOpponent()).toBe(false);
    s.startPrestige('reveal');
    expect(s.revealOpponent()).toBe(true);
    s.startNewRun({ ...s.run.settings, reveal: true });
    expect(s.revealOpponent()).toBe(true);
    s.startPrestige('interest');
    expect(s.interestTerms()).toEqual({ step: 5, max: 5 });
  });

  it('wins the run by getting through the final round with a life left', () => {
    const s = new Session(seededRng(3));
    s.startNewRun({ ...s.run.settings, mode: 'classic' });
    s.run = { ...s.run, round: FINAL_ROUND, record: { w: 20, l: 1, d: FINAL_ROUND - 22 } };
    const outcome = s.finishBattle(result('b'));
    expect(outcome).toMatchObject({ over: true, won: true, playedRound: FINAL_ROUND, score: 20 });
    expect(isRunOver(s.run)).toBe(true);
  });
});

/** An army's pieces and squares (piece ids differ from draft to draft). */
const army = (pieces: readonly { type: string; square: unknown }[]) => pieces.map((p) => [p.type, p.square]);

describe('Session: daily challenge', () => {
  const at = (iso: string) => () => Date.parse(iso);

  /** Today's daily, started, with the king placed; `device` false keeps this device's storage (another player's otherwise). */
  function daily(seed: number, now = at('2026-10-16T09:00:00Z'), device = true): Session {
    if (device) (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    const s = new Session(seededRng(seed), 'daily', now);
    s.restore();
    expect(s.startDaily(false)).toBe(true);
    s.setPieces(s.run.shop.pieces.map((p) => (p.type === 'K' ? { ...p, square: { file: 2, rank: 0 } } : p)));
    return s;
  }

  it('gives everyone the same first opponent, shop, rerolls and battle seed on a date, whatever their Rng', () => {
    const a = daily(1);
    const b = daily(999, at('2026-10-16T23:00:00Z'));
    expect(army(b.aiPieces)).toEqual(army(a.aiPieces));
    expect(b.aiStyle.id).toBe(a.aiStyle.id);
    expect(b.run.shop.offers).toEqual(a.run.shop.offers);
    expect(b.run.shop.gold).toBe(a.run.shop.gold);
    expect(b.newSeed()).toBe(a.newSeed());
    const ra = a.rerollOffers();
    const rb = b.rerollOffers();
    expect(ra.ok && rb.ok && rb.shop.offers).toEqual(ra.ok && ra.shop.offers);
    // A different day is a different challenge.
    const c = daily(1, at('2026-10-17T09:00:00Z'));
    expect(army(c.aiPieces)).not.toEqual(army(a.aiPieces));
  });

  it('brings the same next opponent and shop whatever the player did before', () => {
    const a = daily(1);
    const b = daily(2);
    if (b.run.shop.gold >= 2) {
      const rerolled = b.rerollOffers(); // b rerolls before fighting; a doesn't
      if (rerolled.ok) b.setShop(rerolled.shop);
    }
    a.finishBattle(result('w'));
    b.finishBattle(result('b'));
    expect(b.run.round).toBe(4);
    expect(army(b.aiPieces)).toEqual(army(a.aiPieces));
    expect(b.run.shop.offers).toEqual(a.run.shop.offers);
    expect(b.board.files).toBe(6);
  });

  it('plays five battles with no lives lost, then records the day and keeps the normal run apart', () => {
    const normal = ready();
    normal.persist();
    const s = daily(1, undefined, false);
    let outcome = s.finishBattle(result('b'));
    for (let i = 0; i < 3; i++) outcome = s.finishBattle(result('w'));
    expect(outcome.isDaily).toBe(true);
    expect(outcome.over).toBe(false);
    expect(s.run.lives).toBe(3);
    outcome = s.finishBattle(result('draw'));
    expect(outcome.over).toBe(true);
    expect(outcome.daily).toMatchObject({ date: '2026-10-16', w: 3, l: 1, d: 1, theme: 'fortress' });
    expect(outcome.daily?.score).toBe(350 + s.run.shop.gold);
    // Nothing left to resume, and one attempt a day.
    const again = new Session(seededRng(1), 'daily', at('2026-10-16T10:00:00Z'));
    again.restore();
    expect(again.saved).toBe(false);
    expect(again.startDaily(true)).toBe(false);
    // The normal run is untouched.
    const reloaded = new Session(seededRng(1));
    reloaded.restore();
    expect(reloaded.run.daily).toBeUndefined();
    expect(reloaded.run.round).toBe(normal.run.round);
  });

  it('resumes a daily in progress from its own save', () => {
    const s = daily(1);
    s.finishBattle(result('w'));
    const reloaded = new Session(seededRng(5), 'daily', at('2026-10-16T12:00:00Z'));
    reloaded.restore();
    expect(reloaded.saved).toBe(true);
    expect(reloaded.run.daily?.date).toBe('2026-10-16');
    expect(reloaded.run.round).toBe(4);
    expect(army(reloaded.aiPieces)).toEqual(army(s.aiPieces));
    expect(reloaded.startDaily(false)).toBe(false); // it's resumed, not restarted
    expect(new Session(seededRng(1)).restore().firstVisit).toBe(true);
  });
});
