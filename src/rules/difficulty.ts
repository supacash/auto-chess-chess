export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  name: string;
  /** AI army points per round (the budget is perRound × round rounded, ±1). */
  perRound: number;
}

export const DIFFICULTIES: Difficulty[] = [
  // Tuned with the simulator after merge-first upgrades (SIMULATION.md §14): about 78% / 60% / 31% wins as White.
  { id: 'easy', name: 'Easy', perRound: 5.5 },
  { id: 'normal', name: 'Normal', perRound: 6 },
  { id: 'hard', name: 'Hard', perRound: 6.5 },
];

import type { ModeId } from './mode';

/** Which colour the player takes each round. White moves first, as in chess. */
export type SideId = 'white' | 'black' | 'random';

export const SIDES: { id: SideId; name: string }[] = [
  { id: 'white', name: 'White (you move first)' },
  { id: 'black', name: 'Black (opponent moves first; their army is a little smaller)' },
  { id: 'random', name: 'Random each round' },
];

export function isSideId(v: unknown): v is SideId {
  return SIDES.some((s) => s.id === v);
}

/** Chosen when a run starts and fixed for that run. */
export interface RunSettings {
  mode: ModeId;
  difficulty: DifficultyId;
  /** Show where the opponent's pieces are during placement (an easier mode). */
  reveal: boolean;
  side: SideId;
  /** Fairy pieces in the shop and in AI armies, and fusion. Off = standard chess pieces only. */
  fairy: boolean;
}

export const DEFAULT_SETTINGS: RunSettings = {
  mode: 'growing',
  difficulty: 'normal',
  reveal: false,
  side: 'white',
  fairy: true,
};

export function difficulty(id: DifficultyId): Difficulty {
  return DIFFICULTIES.find((d) => d.id === id) ?? DIFFICULTIES[1];
}

export function isDifficultyId(v: unknown): v is DifficultyId {
  return DIFFICULTIES.some((d) => d.id === v);
}
