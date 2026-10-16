import { BOARDS, type BoardSpec } from '../chess/boardSpec';
import { isPieceType, type Piece, type PieceType } from './pieces';

// The daily challenge's hand-made armies. The day's seed picks one for a battle when one fits that
// day's board, pieces, style and budget (daily.ts); the drafter makes the rest. Add armies here.

/** A hand-made army, written as the player sees it across the board. */
export interface PoolArmy {
  id: string;
  /** Shown as the opponent's name. */
  name: string;
  /** The daily battle (1–5) it was built for: its budget (DESIGN.md, Daily challenge). */
  battle: number;
  /** An AI_STYLES id: Fortress and Menagerie days only use armies of their style; also used to re-place it if needed. */
  style: string;
  /**
   * The army's home rows, its back row first, files left to right as the player sees them (FEN letters,
   * '.' for an empty square). The row length is the board size.
   */
  rows: string[];
}

export const DAILY_POOL: PoolArmy[] = [
  // Battle 1: 5×5, about 12 points (Classic 8×8: about 11).
  { id: 'pawn-wall', name: 'The Pawn Wall', battle: 1, style: 'fortress', rows: ['N.K.B', 'PPPPP'] },
  { id: 'twin-knights', name: 'Twin Knights', battle: 1, style: 'cavalry', rows: ['NBK.N', '.PPP.'] },
  { id: 'little-zoo', name: 'The Little Zoo', battle: 1, style: 'menagerie', rows: ['FWKFM', 'EPLPE'] },
  {
    id: 'skirmishers',
    name: 'Skirmishers',
    battle: 1,
    style: 'cavalry',
    rows: ['...K....', '.N....N.', '.PPPPP..'],
  },
  // Battle 2: 6×6, about 23 points (Classic: about 22).
  { id: 'rook-guard', name: 'Rook Guard', battle: 2, style: 'heavy', rows: ['R.KQ.R', 'PPPPP.'] },
  { id: 'light-brigade', name: 'The Light Brigade', battle: 2, style: 'cavalry', rows: ['BNK.NB', 'PNPPNP'] },
  { id: 'cannon-fort', name: 'Cannon Fort', battle: 2, style: 'fortress', rows: ['XMKWFX', 'PMPPMP'] },
  {
    id: 'rook-rollers',
    name: 'Rook Rollers',
    battle: 2,
    style: 'heavy',
    rows: ['R..K...R', '...Q....', '.PPPP...'],
  },
  // Battle 3: 7×7, about 38 points (Classic: about 37).
  { id: 'bishops-council', name: 'The Bishops’ Council', battle: 3, style: 'balanced', rows: ['RNBKBNR', 'PPPQPPP'] },
  { id: 'heavy-metal', name: 'Heavy Metal', battle: 3, style: 'heavy', rows: ['RBQK.QR', 'PPPPPP.'] },
  { id: 'dragon-court', name: 'The Dragon Court', battle: 3, style: 'menagerie', rows: ['DA.K.HU', 'EPMPMPE'] },
  {
    id: 'bishop-battery',
    name: 'Bishop Battery',
    battle: 3,
    style: 'balanced',
    rows: ['R.B.KB.R', '..NR.N..', 'PPPPPPPP'],
  },
  // Battle 4: 8×8, about 51 points (Classic: about 50).
  {
    id: 'classic-set',
    name: 'The Classic Set',
    battle: 4,
    style: 'balanced',
    rows: ['RNBQKBNR', '..Q..B..', 'PPP..PPP'],
  },
  {
    id: 'fortress-wall',
    name: 'The Fortress Wall',
    battle: 4,
    style: 'fortress',
    rows: ['RQRQ.BRK', '....R...', 'PPPPPPPP'],
  },
  {
    id: 'chancellors-guard',
    name: 'The Chancellor’s Guard',
    battle: 4,
    style: 'heavy',
    rows: ['CR.KZ.RC', '...XN...', 'PPEPPEPP'],
  },
  // Battle 5: 9×9, about 59 points (Classic 8×8: about 58).
  {
    id: 'royal-army',
    name: 'The Royal Army',
    battle: 5,
    style: 'balanced',
    rows: ['RNQQKQBNR', '....R....', 'PPPPPPPP.'],
  },
  {
    id: 'queens-gambit',
    name: 'Queen’s Gambit',
    battle: 5,
    style: 'heavy',
    rows: ['R.QQKQQ.R', '..B...B..', 'PPPPPPP..'],
  },
  {
    id: 'grand-menagerie',
    name: 'The Grand Menagerie',
    battle: 5,
    style: 'menagerie',
    rows: ['UAD.KHSAT', '....Y....', 'EPE.L.EPE'],
  },
  {
    id: 'iron-crown',
    name: 'The Iron Crown',
    battle: 5,
    style: 'heavy',
    rows: ['RQBQKBQR', '...R.B..', 'PPP..PPP'],
  },
];

/** The board an army is written for (its row length and number of rows). */
export function poolBoard(army: PoolArmy): BoardSpec | undefined {
  return BOARDS.find((b) => b.files === army.rows[0]?.length && b.homeRows === army.rows.length);
}

/** The army's pieces on its board: row 0 is its back row (rank 0, mirrored for the engine like any AI army). */
export function poolPieces(army: PoolArmy, flip = false): Piece[] {
  const pieces: Piece[] = [];
  army.rows.forEach((row, rank) => {
    [...row].forEach((ch, i) => {
      if (ch === '.' || !isPieceType(ch)) return;
      const file = flip ? row.length - 1 - i : i;
      pieces.push({ id: `pool-${army.id}-${rank}-${file}`, type: ch as PieceType, square: { file, rank } });
    });
  });
  return pieces;
}
