import { BOARDS, type BoardSpec } from '../chess/boardSpec';
import type { BattleResult, EndReason, Winner } from '../rules/battle';
import { type ArmySnapshot, parseSnapshot } from './snapshot';

/** Format of BattleRecord itself (separate from the rules version). */
export const RECORD_FORMAT = 1;

/**
 * Everything needed to replay a finished battle move by move, and to re-run it: auto battles are
 * deterministic given the start position and seed (one engine thread, seeded move picking).
 */
export interface BattleRecord {
  format: typeof RECORD_FORMAT;
  /** RULES_VERSION the battle was played under. */
  rules: number;
  /** The board's Fairy-Stockfish variant (BoardSpec.variant). */
  board: string;
  round: number;
  /** Start position: the player's pieces are white. */
  fen: string;
  /** Seed for the move-picking RNG. */
  seed: number;
  /** True when the player moved their own pieces (Play it). */
  manual: boolean;
  moves: string[];
  /** The engine's eval for white after each move (null when it gave none; empty for manual games). */
  evals: (number | null)[];
  result: BattleResult;
  /** The player's army as placed for this battle. */
  player: ArmySnapshot;
}

export function recordBoard(record: BattleRecord): BoardSpec | null {
  return BOARDS.find((b) => b.variant === record.board) ?? null;
}

const UCI_MOVE = /^[a-z]\d+[a-z]\d+[a-z]?$/;
const WINNERS: Winner[] = ['w', 'b', 'draw'];
const REASONS: EndReason[] = [
  'checkmate',
  'stalemate',
  'repetition',
  'insufficient',
  'fifty-move',
  'move-limit',
  'decisive',
  'resign',
];

/** Validates untrusted record data; null if anything is off. */
export function parseRecord(data: unknown): BattleRecord | null {
  if (!isObject(data) || data.format !== RECORD_FORMAT) return null;
  if (!isCount(data.rules, 1) || !isCount(data.round, 1) || !isCount(data.seed, 0)) return null;
  if (typeof data.board !== 'string' || !BOARDS.some((b) => b.variant === data.board)) return null;
  if (typeof data.fen !== 'string' || typeof data.manual !== 'boolean') return null;
  const { moves, evals } = data;
  if (!Array.isArray(moves) || !moves.every((m) => typeof m === 'string' && UCI_MOVE.test(m))) return null;
  if (!Array.isArray(evals) || evals.length > moves.length) return null;
  if (!evals.every((e) => e === null || (typeof e === 'number' && Number.isFinite(e)))) return null;
  const result = parseResult(data.result);
  const player = parseSnapshot(data.player);
  if (!result || !player) return null;
  return {
    format: RECORD_FORMAT,
    rules: data.rules,
    board: data.board,
    round: data.round,
    fen: data.fen,
    seed: data.seed,
    manual: data.manual,
    moves: moves as string[],
    evals: evals as (number | null)[],
    result,
    player,
  };
}

function parseResult(data: unknown): BattleResult | null {
  if (!isObject(data) || !isObject(data.material) || !isCount(data.plies, 0)) return null;
  const winner = data.winner as Winner;
  const reason = data.reason as EndReason;
  if (!WINNERS.includes(winner) || !REASONS.includes(reason)) return null;
  const { w, b } = data.material;
  if (!isCount(w, 0) || !isCount(b, 0)) return null;
  return { winner, reason, material: { w, b }, plies: data.plies };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCount(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min;
}
