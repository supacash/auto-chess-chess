export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** AI army points per round (the budget is perRound × round, ±1). */
  perRound: number;
}

export const DIFFICULTIES: Difficulty[] = [
  { id: 'easy', name: 'Easy', perRound: 5 },
  { id: 'normal', name: 'Normal', perRound: 6 },
  { id: 'hard', name: 'Hard', perRound: 7 },
];

import type { ModeId } from './mode';

/** Chosen when a run starts and fixed for that run. */
export interface RunSettings {
  mode: ModeId;
  difficulty: DifficultyId;
  /** Show where the opponent's pieces are during placement (an easier mode). */
  reveal: boolean;
}

export const DEFAULT_SETTINGS: RunSettings = { mode: 'growing', difficulty: 'normal', reveal: false };

export function difficulty(id: DifficultyId): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

export function isDifficultyId(v: unknown): v is DifficultyId {
  return DIFFICULTIES.some((d) => d.id === v);
}
