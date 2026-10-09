import { describe, expect, it } from 'vitest';
import { RULES_VERSION, rulesFingerprint, shortHash } from './version';

/**
 * The rules fingerprint for each RULES_VERSION. When this test fails, the rules changed: bump
 * RULES_VERSION in version.ts and add the new fingerprint here (keep the old ones).
 */
const FINGERPRINTS: Record<number, string> = {
  1: '0031cd6c',
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
