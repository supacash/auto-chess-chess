import { Board } from '../engine/wasm/acc';
import { type BoardSpec, battleVariant } from './boardSpec';
import { type Color, fenTurn } from './fen';

/**
 * Chess rules for any board size, backed by the game's own engine (engine/, Rust compiled to WASM),
 * which plays Fairy-Stockfish's rules for these variants exactly (npm run check:perft). The WASM
 * loads asynchronously, so the environment loads it once and then calls setRulesLoaded(): the
 * browser via loadRules.ts, tests and the simulator via testRules.ts.
 */

let loaded = false;

export function setRulesLoaded(): void {
  loaded = true;
}

export function rulesLoaded(): boolean {
  return loaded;
}

/** Why a game is over, if it is. */
export type Terminal = 'checkmate' | 'stalemate' | 'insufficient' | 'repetition' | 'fifty-move';

export interface Move {
  uci: string;
  from: string;
  to: string;
}

export function parseUci(uci: string): Move | null {
  const m = /^([a-z]\d+)([a-z]\d+)[a-z]?$/.exec(uci);
  return m ? { uci, from: m[1], to: m[2] } : null;
}

/**
 * A position being played. Wraps an engine Board, which lives in WASM memory:
 * call delete() when finished with it.
 */
export class Game {
  private readonly board: Board;
  /** The variant it's played under (the board's, or its two-kings form; see battleVariant). */
  readonly variant: string;

  constructor(
    readonly spec: BoardSpec,
    fen: string,
  ) {
    if (!loaded) throw new Error('Chess rules not loaded yet (call loadRules first)');
    this.variant = battleVariant(spec, fen);
    this.board = new Board(this.variant, fen);
  }

  /** The position. Heirs are written 'J' (the engine tracks them as their own piece). */
  fen(): string {
    return this.board.fen();
  }

  turn(): Color {
    return this.board.turn() ? 'w' : 'b';
  }

  isCheck(): boolean {
    return this.board.isCheck();
  }

  legalMoves(): string[] {
    return this.board.legalMoves().split(' ').filter(Boolean);
  }

  /** Plays a UCI move; null if it's illegal here. */
  play(uci: string): Move | null {
    const move = parseUci(uci);
    if (!move || !this.board.push(uci)) return null;
    return move;
  }

  /** Why the game is over, or null. Repetition and the 50-move rule are claimed automatically. */
  terminal(): Terminal | null {
    if (this.board.numberLegalMoves() === 0) return this.board.isCheck() ? 'checkmate' : 'stalemate';
    if (this.board.isInsufficientMaterial()) return 'insufficient';
    if (this.board.halfmoveClock() >= 100) return 'fifty-move';
    if (this.board.isThreefold()) return 'repetition';
    return null;
  }

  /** Takes back the last move. */
  undo(): void {
    this.board.pop();
  }

  delete(): void {
    this.board.free();
  }
}

/** Whether `color`'s king is attacked in a position given only by its piece placement. */
export function kingInCheck(spec: BoardSpec, placement: string, color: Color): boolean {
  const game = new Game(spec, `${placement} ${color} - - 0 1`);
  try {
    return fenTurn(game.fen()) === color && game.isCheck();
  } finally {
    game.delete();
  }
}
