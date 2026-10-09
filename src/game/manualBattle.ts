import type { BoardSpec } from '../chess/boardSpec';
import { type Color, fenTurn } from '../chess/fen';
import { Game, type Move } from '../chess/rules';
import { type Candidate, pickMove } from '../engine/pick';
import { type BattleLimits, type BattleResult, battleResult, material } from '../rules/battle';
import { randomInt, seededRng } from '../rules/rng';
import { type MoveSource, SEARCH_DEPTH } from './runBattle';

/** Games the player plays themselves have no move limit: they end on the board (or by resigning). */
export const MANUAL_LIMITS: BattleLimits = { plyLimit: Number.POSITIVE_INFINITY };

/** What's saved to resume a game in progress: the start position and every move since. */
export interface ManualState {
  fen: string;
  moves: string[];
  /** Seeds the opponent's move picking (mixed with the move number), so a game replays the same. */
  seed: number;
}

/**
 * A battle where the player moves their own pieces (white in the FEN) and the engine plays the
 * opponent exactly as in auto battles. Wraps an ffish Game: call delete() when finished.
 */
export class ManualBattle {
  private readonly game: Game;
  private readonly played: string[] = [];
  private resigned = false;

  /** Starts from `start`, replaying `moves` to resume a saved game. Throws if a saved move is illegal. */
  constructor(
    readonly start: string,
    readonly spec: BoardSpec,
    moves: string[] = [],
    readonly seed = 0,
  ) {
    this.game = new Game(spec, start);
    for (const uci of moves) {
      if (!this.game.play(uci)) {
        this.game.delete();
        throw new Error(`Saved move ${uci} is illegal`);
      }
      this.played.push(uci);
    }
  }

  get fen(): string {
    return this.game.fen();
  }

  get moves(): readonly string[] {
    return this.played;
  }

  get state(): ManualState {
    return { fen: this.start, moves: [...this.played], seed: this.seed };
  }

  get playerToMove(): boolean {
    return this.game.turn() === 'w';
  }

  isCheck(): boolean {
    return this.game.isCheck();
  }

  /** The battle's result once it's over, otherwise null. */
  result(): BattleResult | null {
    if (this.resigned) {
      return { winner: 'b', reason: 'resign', material: material(this.fen), plies: this.played.length };
    }
    return battleResult(this.game, this.played.length, MANUAL_LIMITS);
  }

  /** Legal player moves (UCI), grouped by the square they start from. Empty when it isn't the player's turn. */
  legalMoves(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    if (!this.playerToMove || this.result()) return out;
    for (const uci of this.game.legalMoves()) {
      const from = /^[a-z]\d+/.exec(uci)![0];
      out.set(from, [...(out.get(from) ?? []), uci]);
    }
    return out;
  }

  /** Plays the player's move; null if it isn't their turn or the move is illegal. */
  playerMove(uci: string): Move | null {
    if (!this.playerToMove || this.result()) return null;
    return this.push(uci);
  }

  /**
   * Asks the engine for the opponent's move, given the game so far (so it sees repetitions), and plays
   * it. Falls back to a random legal move if the engine gives none, as auto battles do. Move picking
   * is seeded by the game's seed and move number, so the same game always gets the same replies.
   */
  async opponentMove(engine: MoveSource): Promise<Move> {
    if (this.playerToMove || this.result()) throw new Error("It isn't the opponent's turn");
    const rng = seededRng((this.seed + Math.imul(this.played.length + 1, 0x9e3779b1)) >>> 0);
    const candidates: Candidate[] = await engine.candidates(this.fen, SEARCH_DEPTH, this.state);
    const uci = pickMove(candidates, rng);
    const played = uci ? this.push(uci) : null;
    if (played) return played;
    const legal = this.game.legalMoves();
    return this.push(legal[randomInt(rng, legal.length)])!;
  }

  /** True when the player has a move to take back (and the game isn't over). */
  canUndo(): boolean {
    if (this.result()) return false;
    return this.played.some((_, i) => this.moverOf(i) === 'w');
  }

  /** Takes back the player's last move, and the opponent's reply if it made one. */
  undo(): void {
    if (!this.canUndo()) return;
    for (;;) {
      const i = this.played.length - 1;
      const mover = this.moverOf(i);
      this.played.pop();
      this.game.undo();
      if (mover === 'w') return;
    }
  }

  resign(): BattleResult {
    this.resigned = true;
    return this.result()!;
  }

  delete(): void {
    this.game.delete();
  }

  private push(uci: string): Move | null {
    const move = this.game.play(uci);
    if (move) this.played.push(uci);
    return move;
  }

  /** Who made ply `i`. */
  private moverOf(i: number): Color {
    const first = fenTurn(this.start);
    return i % 2 === 0 ? first : first === 'w' ? 'b' : 'w';
  }
}
