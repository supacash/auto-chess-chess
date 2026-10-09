import { type Rng, randomInt } from '../rules/rng';

// Generated player names ("Brave Knight 42"): no free text, so nothing to moderate.

const ADJECTIVES = [
  'Brave',
  'Clever',
  'Swift',
  'Quiet',
  'Bold',
  'Lucky',
  'Grim',
  'Merry',
  'Sly',
  'Stout',
  'Wise',
  'Fierce',
  'Gentle',
  'Rusty',
  'Golden',
  'Silver',
];
const NOUNS = [
  'Knight',
  'Bishop',
  'Rook',
  'Pawn',
  'Queen',
  'King',
  'Camel',
  'Cannon',
  'Ferz',
  'Wazir',
  'Amazon',
  'Centaur',
];

export function generateName(rng: Rng): string {
  return `${ADJECTIVES[randomInt(rng, ADJECTIVES.length)]} ${NOUNS[randomInt(rng, NOUNS.length)]} ${10 + randomInt(rng, 90)}`;
}

/** "1st", "2nd", "3rd", "4th". */
export function ordinal(n: number): string {
  const suffix =
    n % 10 === 1 && n % 100 !== 11
      ? 'st'
      : n % 10 === 2 && n % 100 !== 12
        ? 'nd'
        : n % 10 === 3 && n % 100 !== 13
          ? 'rd'
          : 'th';
  return `${n}${suffix}`;
}
