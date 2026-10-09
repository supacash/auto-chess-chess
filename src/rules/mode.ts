import { BOARD_8, boardForRound, type BoardSpec } from '../chess/boardSpec';
import type { PieceType } from './pieces';

export type ModeId = 'growing' | 'classic';

/** A way to play a run: which board each round uses, and the opening tuned for it. */
export interface GameMode {
  id: ModeId;
  name: string;
  /** One line for the New run window. */
  description: string;
  board(round: number): BoardSpec;
  startArmy: PieceType[];
  /** Round 1 AI armies are this many points smaller (see aiBudget). */
  roundOneDiscount: number;
  /** Extra AI points every round, to match a bigger starting army. */
  aiBonus: number;
}

export const MODES: GameMode[] = [
  {
    id: 'growing',
    name: 'Growing board',
    description: 'Starts on 5×5 and grows every two rounds to 8×8. Quick, decisive early battles.',
    board: boardForRound,
    // An extra pawn keeps mating material on 5×5, where 5-point armies drew 40% of round 1s. The AI
    // gets the matching point every round, so the balance matches Classic (the pawn is permanent).
    startArmy: ['K', 'P', 'P', 'P', 'P'],
    roundOneDiscount: 1,
    aiBonus: 1,
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'A full 8×8 board from the first round.',
    board: () => BOARD_8,
    startArmy: ['K', 'P', 'P', 'P'],
    roundOneDiscount: 1,
    aiBonus: 0,
  },
];

export function gameMode(id: ModeId): GameMode {
  return MODES.find((m) => m.id === id) ?? MODES[0];
}

export function isModeId(v: unknown): v is ModeId {
  return MODES.some((m) => m.id === v);
}
