import { BOARDS, type BoardSpec } from '../chess/boardSpec';
import { isModeId, type ModeId } from '../rules/mode';
import { isPieceType, makePiece, type Piece, type PieceType } from '../rules/pieces';
import { armyErrors } from '../rules/placement';
import { RULES_VERSION } from './version';

/** Format of ArmySnapshot itself (separate from the rules version it was made under). */
export const SNAPSHOT_FORMAT = 1;

/**
 * A frozen army as it stood for one battle: what other players will fight as a "ghost" in
 * multiplayer. Only placed pieces are kept, by square. Plain JSON, so it can be stored or sent.
 */
export interface ArmySnapshot {
  format: typeof SNAPSHOT_FORMAT;
  /** RULES_VERSION it was made under: only armies from the same rules should meet. */
  rules: number;
  mode: ModeId;
  round: number;
  /** The board's Fairy-Stockfish variant (BoardSpec.variant). */
  board: string;
  fairy: boolean;
  pieces: { type: PieceType; file: number; rank: number }[];
}

/** Snapshots the placed pieces of an army for a battle on `spec`. */
export function snapshotArmy(
  pieces: Piece[],
  spec: BoardSpec,
  info: { mode: ModeId; round: number; fairy: boolean },
): ArmySnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    rules: RULES_VERSION,
    mode: info.mode,
    round: info.round,
    board: spec.variant,
    fairy: info.fairy,
    pieces: pieces.flatMap((p) => (p.square ? [{ type: p.type, file: p.square.file, rank: p.square.rank }] : [])),
  };
}

/** True when a snapshot was made under the current rules. */
export function isCurrentRules(snapshot: ArmySnapshot): boolean {
  return snapshot.rules === RULES_VERSION;
}

/** The board a snapshot was placed on, or null if this build doesn't know it. */
export function snapshotBoard(snapshot: ArmySnapshot): BoardSpec | null {
  return BOARDS.find((b) => b.variant === snapshot.board) ?? null;
}

/** The snapshot's army as pieces (fresh ids), ready to place or fight. */
export function snapshotPieces(snapshot: ArmySnapshot): Piece[] {
  return snapshot.pieces.map((p) => makePiece(p.type, { file: p.file, rank: p.rank }));
}

/**
 * Validates untrusted snapshot data (e.g. another player's army): known format, board and pieces,
 * and a legal army on that board. Returns null if anything is off. Doesn't check the rules version:
 * see isCurrentRules.
 */
export function parseSnapshot(data: unknown): ArmySnapshot | null {
  if (!isObject(data) || data.format !== SNAPSHOT_FORMAT) return null;
  if (!isCount(data.rules, 1) || !isCount(data.round, 1) || !isModeId(data.mode)) return null;
  if (typeof data.board !== 'string' || typeof data.fairy !== 'boolean' || !Array.isArray(data.pieces)) return null;
  const pieces: ArmySnapshot['pieces'] = [];
  for (const p of data.pieces) {
    if (!isObject(p) || !isPieceType(p.type) || !isCount(p.file, 0) || !isCount(p.rank, 0)) return null;
    pieces.push({ type: p.type, file: p.file, rank: p.rank });
  }
  const snapshot: ArmySnapshot = {
    format: SNAPSHOT_FORMAT,
    rules: data.rules,
    mode: data.mode,
    round: data.round,
    board: data.board,
    fairy: data.fairy,
    pieces,
  };
  const spec = snapshotBoard(snapshot);
  if (!spec || armyErrors(snapshotPieces(snapshot), spec).length > 0) return null;
  return snapshot;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isCount(v: unknown, min: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= min;
}
