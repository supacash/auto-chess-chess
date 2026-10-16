/**
 * The game's sound effects, synthesised with the Web Audio API (no sound files to ship or load):
 * short tones and filtered noise for placing pieces, the shop, battle moves and results. The
 * player can turn them off (and set their volume) in Settings; the choice is kept on the device. The audio starts on
 * the first sound after a tap (browsers only allow it then).
 */

export type Sfx =
  | 'select'
  | 'place'
  | 'buy'
  | 'sell'
  | 'merge'
  | 'reroll'
  | 'error'
  | 'move'
  | 'capture'
  | 'check'
  | 'win'
  | 'lose'
  | 'draw'
  | 'award'
  | 'grow'
  | 'tick';

import { settings } from './settings';

const SOUND_KEY = 'acc.sound.v1';
/** Loudness at the top of the Settings volume slider; the default (50%) puts effects under whatever else the phone is playing. */
const MAX_GAIN = 0.64;

function gain(): number {
  return (MAX_GAIN * settings().volume) / 100;
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = loadEnabled();

function loadEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // ignore
  }
}

/** Applies a changed effects volume (Settings) to sounds from now on. */
export function volumeChanged(): void {
  if (master) master.gain.value = gain();
}

/** The audio graph, made on first use; null when sound is off or the browser has no Web Audio. */
function audio(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    master = ctx.createGain();
    master.gain.value = gain();
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

interface ToneOptions {
  type?: OscillatorType;
  gain?: number;
  /** Glides to this pitch over the tone. */
  slideTo?: number;
  attack?: number;
}

function tone(freq: number, at: number, length: number, opts: ToneOptions = {}): void {
  const ac = ctx!;
  const { type = 'sine', gain = 0.3, slideTo, attack = 0.005 } = opts;
  const t = ac.currentTime + at;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(env).connect(master!);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

interface NoiseOptions {
  gain?: number;
  /** Centre of the band let through (Hz), or where a sweep starts. */
  freq?: number;
  /** Where a sweep ends. */
  sweepTo?: number;
  q?: number;
}

/** A burst of filtered noise: clicks, knocks and whooshes. */
function noise(at: number, length: number, opts: NoiseOptions = {}): void {
  const ac = ctx!;
  const { gain = 0.3, freq = 1800, sweepTo, q = 1 } = opts;
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    // Fixed noise (no Math.random needed): a cheap generator is plenty for a click.
    let seed = 0x2545f491;
    for (let i = 0; i < data.length; i++) {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
    }
  }
  const t = ac.currentTime + at;
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t);
  if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + length);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter).connect(env).connect(master!);
  src.start(t, Math.random() * 0.5);
  src.stop(t + length + 0.02);
}

/** Notes up a scale, one after another. */
function arpeggio(freqs: number[], gap: number, length: number, opts: ToneOptions): void {
  freqs.forEach((f, i) => {
    tone(f, i * gap, length, opts);
  });
}

const SOUNDS: Record<Sfx, () => void> = {
  select: () => tone(880, 0, 0.05, { gain: 0.08 }),
  place: () => {
    tone(240, 0, 0.09, { type: 'triangle', gain: 0.3, slideTo: 120 });
    noise(0, 0.03, { freq: 2600, gain: 0.12 });
  },
  buy: () => {
    tone(987.8, 0, 0.08, { type: 'square', gain: 0.06 });
    tone(1318.5, 0.07, 0.18, { type: 'square', gain: 0.06 });
  },
  sell: () => {
    tone(1318.5, 0, 0.07, { type: 'square', gain: 0.05 });
    tone(880, 0.06, 0.16, { type: 'square', gain: 0.05 });
  },
  merge: () => {
    arpeggio([523.3, 659.3, 784, 1046.5], 0.055, 0.2, { type: 'triangle', gain: 0.18 });
    noise(0.18, 0.25, { freq: 6000, sweepTo: 9000, gain: 0.05, q: 0.7 });
  },
  reroll: () => noise(0, 0.2, { freq: 500, sweepTo: 3200, gain: 0.16, q: 0.9 }),
  error: () => {
    tone(180, 0, 0.12, { type: 'square', gain: 0.045 });
    tone(140, 0.08, 0.14, { type: 'square', gain: 0.045 });
  },
  move: () => {
    noise(0, 0.035, { freq: 1500, gain: 0.28, q: 2 });
    tone(330, 0, 0.05, { type: 'triangle', gain: 0.07, slideTo: 220 });
  },
  capture: () => {
    noise(0, 0.07, { freq: 900, gain: 0.45, q: 1.2 });
    tone(150, 0, 0.14, { gain: 0.3, slideTo: 70 });
  },
  check: () => {
    tone(880, 0, 0.09, { type: 'square', gain: 0.05 });
    tone(880, 0.13, 0.09, { type: 'square', gain: 0.05 });
  },
  win: () => {
    arpeggio([523.3, 659.3, 784], 0.09, 0.22, { type: 'triangle', gain: 0.2 });
    for (const f of [523.3, 659.3, 784, 1046.5]) tone(f, 0.3, 0.7, { type: 'triangle', gain: 0.09, attack: 0.02 });
  },
  lose: () => arpeggio([392, 349.2, 311.1, 261.6], 0.15, 0.32, { type: 'triangle', gain: 0.16 }),
  draw: () => arpeggio([523.3, 523.3, 392], 0.12, 0.2, { type: 'triangle', gain: 0.14 }),
  award: () => {
    arpeggio([784, 987.8, 1174.7, 1568], 0.06, 0.28, { gain: 0.13 });
    noise(0.2, 0.3, { freq: 7000, sweepTo: 10000, gain: 0.05, q: 0.7 });
  },
  grow: () => {
    tone(180, 0, 0.4, { gain: 0.14, slideTo: 540, attack: 0.05 });
    noise(0, 0.4, { freq: 300, sweepTo: 2400, gain: 0.08, q: 0.8 });
  },
  tick: () => tone(1250, 0, 0.03, { gain: 0.07 }),
};

/** Plays a sound effect (nothing when sound is off). */
export function sfx(name: Sfx): void {
  if (!audio()) return;
  try {
    SOUNDS[name]();
  } catch {
    // A sound must never break the game.
  }
}
