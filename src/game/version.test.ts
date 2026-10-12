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
};

describe('rules version', () => {
  it('is bumped whenever the rules fingerprint changes', () => {
    expect(shortHash(rulesFingerprint()), 'The rules changed: bump RULES_VERSION and record the new fingerprint').toBe(
      FINGERPRINTS[RULES_VERSION],
    );
  });

  it('hashes stably', () => {
    expect(shortHash('')).toBe('811c9dc5');
    expect(shortHash('abc')).not.toBe(shortHash('abd'));
  });
});
