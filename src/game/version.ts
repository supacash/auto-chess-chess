import { BOARDS, plyLimit } from '../chess/boardSpec';
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
export const RULES_VERSION = 1;

/** Everything about the rules that can be read as data, as one stable string. */
export function rulesFingerprint(): string {
  const pieces = PIECE_TYPES.map((t) => {
    const p = PIECES[t];
    return [t, p.value, p.betza ?? '', p.pawn ? 'p' : ''].join(':');
  });
  const boards = BOARDS.map((b) => [b.variant, b.files, b.ranks, b.homeRows, plyLimit(b)].join(':'));
  const engine = [SEARCH_DEPTH, MULTI_PV, PICK_MARGIN].join(':');
  return [pieces.join(','), boards.join(','), engine].join('|');
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
