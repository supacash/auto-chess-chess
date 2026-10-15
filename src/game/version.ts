import { BOARDS, plyLimit, variantsIni } from '../chess/boardSpec';
import { ACC_LIMITS, ENGINE_VERSION } from '../engine/accSettings';
import { USE_FAIRY } from '../engine/engineChoice';
import { MULTI_PV, PICK_MARGIN } from '../engine/pick';
import { PIECE_TYPES, PIECES } from '../rules/pieces';
import { SEARCH_DEPTH } from './runBattle';

/**
 * The version of everything that decides a battle: piece moves and values, board sizes, move limits
 * and engine settings. Saved armies and battle records carry it, so ones made under different rules
 * aren't mixed (e.g. matched or replayed as if the rules were the same).
 *
 * Bump it whenever the rules change. version.test.ts fails when the fingerprint below changes
 * without a bump; rule changes it can't see (such as how battleResult decides a game) need a manual bump.
 */
// A `fairy` build plays battles with Fairy-Stockfish, exactly as version 8 did (src/engine/engineChoice.ts).
export const RULES_VERSION = USE_FAIRY ? 8 : 10;

/** Everything about the rules that can be read as data, as one stable string. `fairy`: for a `fairy` build. */
export function rulesFingerprint(fairy = USE_FAIRY): string {
  const pieces = PIECE_TYPES.map((t) => {
    const p = PIECES[t];
    return [t, p.value, p.betza ?? '', p.pawn ? 'p' : ''].join(':');
  });
  const boards = BOARDS.map((b) => [b.variant, b.files, b.ranks, b.homeRows, plyLimit(b)].join(':'));
  // The game's own engine (engine/) and how it searches.
  const engine = fairy
    ? [SEARCH_DEPTH, MULTI_PV, PICK_MARGIN].join(':')
    : ['acc', ENGINE_VERSION, ACC_LIMITS.depth, ACC_LIMITS.nodes, MULTI_PV, PICK_MARGIN].join(':');
  // The rules as written for Fairy-Stockfish (custom pieces, the two-kings variants, …); our engine plays them.
  const ini = shortHash(variantsIni());
  return [pieces.join(','), boards.join(','), engine, ini].join('|');
}

/** A short hash of a string (FNV-1a, 32-bit, hex). */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
