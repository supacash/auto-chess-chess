import { describe, expect, it } from 'vitest';
import { RULES_VERSION, rulesFingerprint, shortHash } from './version';

/**
 * The rules fingerprint for each RULES_VERSION. When this test fails, the rules changed: bump
 * RULES_VERSION in version.ts and add the new fingerprint here (keep the old ones).
 */
const FINGERPRINTS: Record<number, string> = {
  1: '0031cd6c',
  2: 'f24f4ea6', // a 9×9 board (Growing mode ends on 9×9)
  3: 'ad8348a3', // Dragon King, Dragon Horse, Wildebeest and Siege Cannon
  4: 'e6af633a', // the Stackman
  5: '69f2ac38', // the Heir (two kings), and the engine rules (variants.ini) in the fingerprint
  6: '88c4e465', // two kings: both attacked at once isn't mate (one must be captured first)
  7: '87a056c6', // the Stackman is worth 9 (was 8)
  8: '87a056c6', // same pieces as 7; armies may hold several Stackmen and the shop changed (kept apart from 7 online)
  9: '98c96f10', // the game's own engine plays battles instead of Fairy-Stockfish (docs/ENGINE-PLAN.md)
  10: '98c96f10', // same battles as 9; a Rook is two 1-gold rook-pawns and a Bishop, Knight or Man (kept apart from 9 online)
};

describe('rules version', () => {
  it('is bumped whenever the rules fingerprint changes', () => {
    expect(shortHash(rulesFingerprint()), 'The rules changed: bump RULES_VERSION and record the new fingerprint').toBe(
      FINGERPRINTS[RULES_VERSION],
    );
  });

  it('gives a fairy build (Fairy-Stockfish, kept to go back to) the version 8 fingerprint', () => {
    expect(shortHash(rulesFingerprint(true))).toBe(FINGERPRINTS[8]);
  });

  it('hashes stably', () => {
    expect(shortHash('')).toBe('811c9dc5');
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
  });
});
