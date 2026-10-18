import { describe, expect, it } from 'vitest';
import type { BattleUpgrade } from '../rules/position';
import { synergyNote } from './synergyText';

const up = (side: 'w' | 'b', from: BattleUpgrade['from'], to: BattleUpgrade['to']): BattleUpgrade => ({
  id: `${side}${from}${Math.random()}`,
  family: 'cavalry',
  from,
  to,
  side,
  square: { file: 0, rank: 0 },
});

describe('synergyNote', () => {
  it("says what each side's synergies upgraded, counting repeats", () => {
    const ups = [up('w', 'N', 'T'), up('b', 'X', 'S'), up('b', 'F', 'M'), up('b', 'W', 'M'), up('b', 'F', 'M')];
    expect(synergyNote(ups, 'w')).toBe(
      'Synergies! You: Knight → Centaur. Them: Cannon → Siege Cannon, 2 Ferzes → Men, Wazir → Man.',
    );
  });

  it('leaves out a side with none, and speaks from the player’s side', () => {
    expect(synergyNote([up('b', 'P', 'N'), up('b', 'P', 'N')], 'w')).toBe('Synergies! Them: 2 Pawns → Knights.');
    expect(synergyNote([up('b', 'P', 'N')], 'b')).toBe('Synergies! You: Pawn → Knight.');
  });
});
