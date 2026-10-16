import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, parseSettings } from './settings';

describe('parseSettings', () => {
  it('gives the defaults for nothing stored, or junk', () => {
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('loud')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ volume: 'max', speed: '4', reduceMotion: 1 })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid settings', () => {
    expect(parseSettings({ volume: 80, speed: 4, reduceMotion: true })).toEqual({
      volume: 80,
      speed: 4,
      reduceMotion: true,
    });
  });

  it('fits the volume to its range and steps, and only offers speeds', () => {
    expect(parseSettings({ volume: 0 }).volume).toBe(10);
    expect(parseSettings({ volume: 250 }).volume).toBe(100);
    expect(parseSettings({ volume: 64 }).volume).toBe(60);
    expect(parseSettings({ volume: Number.NaN }).volume).toBe(DEFAULT_SETTINGS.volume);
    expect(parseSettings({ speed: 3 }).speed).toBe(1);
  });
});
