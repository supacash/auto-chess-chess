import type { Board, FairyStockfish } from 'ffish-es6';
import { type BoardSpec, battleVariant, engineFen, parseSquare, squareName } from './boardSpec';
import { type Color, fenTurn, parsePlacement, placementField } from './fen';

/**
 * Chess rules for any board size, backed by ffish (Fairy-Stockfish's move generator as WASM).
 * ffish loads asynchronously, so the environment loads it once and hands it over with setRules():
 * the browser via loadRules.ts, tests and the simulator from node_modules.
 */

let ffish: FairyStockfish | null = null;

export function setRules(loaded: FairyStockfish): void {
  ffish = loaded;
}

export function rulesLoaded(): boolean {
  return ffish !== null;
}

function rules(): FairyStockfish {
  if (!ffish) throw new Error('Chess rules not loaded yet (call setRules first)');
  return ffish;
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
 * A position being played. Wraps an ffish Board, which lives in WASM memory:
 * call delete() when finished with it.
 */
export class Game {
  private readonly board: Board;
  /** The engine variant it's played under (the board's, or its two-kings form; see battleVariant). */
  readonly variant: string;
  /** Where each side's Heir stands (ffish only knows it as a second king), and its earlier squares for undo. */
  private heirs: Partial<Record<Color, string>> = {};
  private heirHistory: Partial<Record<Color, string>>[] = [];

  constructor(
    readonly spec: BoardSpec,
    fen: string,
  ) {
    this.variant = battleVariant(spec, fen);
    const grid = parsePlacement(fen, spec.files);
    grid.forEach((row, i) => {
      row.forEach((cell, file) => {
        if (cell?.type === 'J') this.heirs[cell.color] = squareName(file, spec.ranks - 1 - i);
      });
    });
    this.board = new (rules().Board)(this.variant, engineFen(fen));
  }

  /** The position, with each Heir written as 'J'. */
  fen(): string {
    const fen = this.board.fen();
    if (!this.heirs.w && !this.heirs.b) return fen;
    const grid = parsePlacement(fen, this.spec.files).reverse(); // [rank][file], rank 0 at the bottom
    for (const [color, square] of Object.entries(this.heirs)) {
      if (!square) continue;
      const { file, rank } = parseSquare(square);
      if (grid[rank]?.[file]) grid[rank][file] = { type: 'J', color: color as Color };
    }
    return [placementField(grid), ...fen.split(' ').slice(1)].join(' ');
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
    const mover = this.turn();
    if (!move || !this.board.push(uci)) return null;
    this.heirHistory.push({ ...this.heirs });
    const other: Color = mover === 'w' ? 'b' : 'w';
    if (this.heirs[other] === move.to) delete this.heirs[other]; // the Heir was captured
    if (this.heirs[mover] === move.from) this.heirs[mover] = move.to;
    return move;
  }

  /** Why the game is over, or null. Repetition and the 50-move rule are claimed automatically. */
  terminal(): Terminal | null {
    if (this.board.numberLegalMoves() === 0) return this.board.isCheck() ? 'checkmate' : 'stalemate';
    if (this.board.isInsufficientMaterial()) return 'insufficient';
    if (this.board.halfmoveClock() >= 100) return 'fifty-move';
    if (this.board.isGameOver(true)) return 'repetition';
    return null;
  }

  /** Takes back the last move. */
  undo(): void {
    this.board.pop();
    this.heirs = this.heirHistory.pop() ?? this.heirs;
  }

  delete(): void {
    this.board.delete();
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
