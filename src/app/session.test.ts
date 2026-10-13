import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadRulesForNode } from '../chess/testRules';
import type { BattleResult } from '../rules/battle';
import { OFFER_COUNT } from '../rules/economy';
import { seededRng } from '../rules/rng';
import { FINAL_ROUND, isRunOver, START_LIVES } from '../rules/run';
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
    expect(again.aiPieces).toEqual(s.aiPieces);
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
