import { describe, expect, it } from 'vitest';
import { AI_STYLES } from './aiArmy';
import { FUSIONS } from './economy';
import { GUIDE_GROUPS, guideGroup, guidePieces, isFairyPiece, isFairyWay, waysToGet } from './pieceGuide';
import { PIECE_TYPES, type PieceType } from './pieces';

const all = GUIDE_GROUPS.flatMap(guidePieces);

describe('the piece guide', () => {
  it('groups the pieces into standard, pawns, fairy and fusions', () => {
    expect(guidePieces('standard')).toEqual(['K', 'Q', 'R', 'B', 'N']);
    expect(guidePieces('pawns')).toEqual(['P', 'E']);
    expect(guidePieces('fairy')).toEqual(['F', 'W', 'M', 'L', 'X']);
    expect(guidePieces('fusions')).toEqual(['T', 'A', 'C', 'Z', 'D', 'H', 'U', 'S', 'Y', 'J']);
  });

  it('lists every piece a player can meet, once, and leaves the Grasshopper out', () => {
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('G');
    expect(PIECE_TYPES.filter((t) => !all.includes(t))).toEqual(['G']);
    // Everything the AI drafts, fusions and Berolina pawns included, is in it.
    const drafted = AI_STYLES.flatMap((s) => Object.keys({ ...s.weights, ...s.fairyWeights }) as PieceType[]);
    for (const t of [...drafted, 'E' as const]) expect(all).toContain(t);
  });

  it('marks the fairy pieces', () => {
    expect(all.filter(isFairyPiece)).toEqual(all.filter((t) => guideGroup(t) !== 'standard' && t !== 'P'));
    expect(isFairyPiece('N')).toBe(false);
    expect(isFairyPiece('E')).toBe(true);
  });

  it('reads how to get a Knight off the shop rules', () => {
    expect(waysToGet('N')).toEqual([
      { kind: 'shop', gold: 3, fromRound: 1 },
      { kind: 'merge', parts: [{ type: 'P', affinity: 'N', count: 3 }], fairy: false },
      { kind: 'merge', parts: [{ type: 'P', count: 3 }], fairy: false },
      { kind: 'merge', parts: [{ type: 'E', count: 3 }], fairy: true },
      { kind: 'upgrade', from: 'P', gold: 3 },
    ]);
  });

  it('gives the Rook its recipe: two rook-pawns and a Bishop, Knight or Man', () => {
    expect(waysToGet('R')).toEqual([
      { kind: 'shop', gold: 5, fromRound: 2 },
      { kind: 'merge', parts: [{ type: 'P', affinity: 'R', count: 2 }], oneOf: ['B', 'N', 'M'], fairy: false },
    ]);
  });

  it('lists the Queen from round 6 in the shop, and her four merges', () => {
    const ways = waysToGet('Q');
    expect(ways[0]).toEqual({ kind: 'shop', gold: 9, fromRound: 6 });
    expect(ways.slice(1)).toEqual([
      { kind: 'merge', parts: [{ type: 'P', affinity: 'Q', count: 3 }], fairy: false },
      { kind: 'merge', parts: [{ type: 'B', count: 3 }], fairy: false },
      { kind: 'merge', parts: [{ type: 'N', count: 3 }], fairy: false },
      { kind: 'merge', parts: [{ type: 'R', count: 2 }], fairy: false },
    ]);
  });

  it('crowns the Heir from three Queens, with fairy pieces on', () => {
    expect(waysToGet('J')).toEqual([{ kind: 'merge', parts: [{ type: 'Q', count: 3 }], fairy: true }]);
  });

  it('gives every fusion its recipe, and the Stackman its merge and rare shop offer', () => {
    for (const { parts, result } of FUSIONS) {
      const fusion = waysToGet(result).find((w) => w.kind === 'fusion');
      expect(fusion).toEqual({ kind: 'fusion', parts: parts.map((type) => ({ type, count: 1 })) });
      expect(isFairyWay(fusion!)).toBe(true);
    }
    expect(waysToGet('Y')).toEqual([
      { kind: 'shop', gold: 9, fromRound: 4 },
      { kind: 'merge', parts: [{ type: 'M', count: 3 }], fairy: true },
    ]);
  });

  it('starts every army with the King and three Pawns', () => {
    expect(waysToGet('K')).toEqual([{ kind: 'start', count: 1 }]);
    expect(waysToGet('P')).toEqual([{ kind: 'start', count: 3 }, { kind: 'affinityPawns' }]);
  });
});
