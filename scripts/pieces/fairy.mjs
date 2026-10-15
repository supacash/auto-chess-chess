// The single fairy pieces, in the standard set's style.
import { along, band, circle, diamond, dot, line, rr, spokes } from './draw.mjs';

// The cannon's barrel: from the breech (right) up to the muzzle (left).
const BREECH = [80, 57];
const MUZZLE = [20, 30];

export const FAIRY = {
  // Berolina pawn: the classic pawn with a diamond head (it moves diagonally).
  E: {
    shapes: [
      'M41 47C41 59 34 69 29 78H71C66 69 59 59 59 47Z',
      rr(36, 41, 64, 48, 3),
      diamond(50, 27, 12.5, 14),
      rr(24, 77, 76, 88, 4),
    ],
    details: [],
  },
  // Ferz (the old counsellor; one diagonal step): a tall onion turban with an × clasp.
  F: {
    shapes: [
      'M50 15C47 24 29 32 27 50C26 62 33 69 40 70H60C67 69 74 62 73 50C71 32 53 24 50 15Z',
      circle(50, 12, 4.5),
      rr(24, 67, 76, 81, 5),
    ],
    details: [line('M29 55C42 49 58 49 71 55'), line('M43 34L57 48M57 34L43 48')],
  },
  // Wazir (the vizier; one straight step): a wide turban with a plume and a + jewel.
  W: {
    shapes: [
      'M50 42C43 33 44 18 54 9C57 19 57 31 53 42Z',
      'M22 64C16 48 30 32 50 32C70 32 84 48 78 64Z',
      rr(20, 61, 80, 76, 5),
      circle(50, 47, 9),
    ],
    details: [line('M50 41V53M44 47H56'), line('M25 53C30 46 36 42 42 40'), line('M75 53C70 46 64 42 58 40')],
  },
  // Man (moves like a king, can be captured): a commoner, head and shoulders.
  M: {
    shapes: ['M23 84C23 65 35 55 50 55C65 55 77 65 77 84Z', circle(50, 33, 14), rr(20, 82, 80, 91, 3.5)],
    details: [line('M43 56L50 66L57 56')],
  },
  // Camel: lying down, two tall humps, long neck, head raised.
  L: {
    shapes: [
      'M36 84C32 76 34 66 42 62C44 47 58 41 62 55C66 41 81 43 82 58C90 62 93 76 89 84Z',
      'M34 80C26 70 22 56 24 44C25 38 22 34 18 34C12 34 10 28 14 25C18 21 26 20 31 22L34 15L37 24C38 30 35 38 35 46C35 56 39 63 45 66Z',
      rr(27, 82, 95, 90, 3),
    ],
    details: [
      dot(circle(22, 27.5, 2)),
      line('M13 30Q16 31 18 29'),
      line('M55 84C55 78 59 76 64 78'),
      line('M74 84C74 78 78 76 83 78'),
    ],
  },
  // Grasshopper: side view, the big hind leg cocked to leap, antennae.
  G: {
    shapes: [
      band(30, 60, 25, 78, 4.5),
      band(42, 61, 44, 78, 4.5),
      'M22 56C22 48 32 44 46 44L72 46C80 47 85 52 83 56C81 61 73 62 65 62L34 62C26 62 22 60 22 56Z',
      'M31 47C45 39 66 39 86 51C70 51 50 51 33 53Z',
      band(84, 28, 90, 80, 4.5, 4),
      'M48 56C56 42 69 29 80 25C85 24 87 29 84 32C76 42 65 54 57 61Z',
      circle(22, 52, 9.5),
    ],
    details: [dot(circle(19, 50, 2.2)), line('M17 44C12 30 20 17 34 11'), line('M22 43C22 31 30 21 43 17')],
  },
  // Cannon: a barrel on a wheeled carriage, aimed up.
  X: {
    shapes: [
      'M48 66L84 55L95 86L86 88Z',
      band(...BREECH, ...MUZZLE, 17, 12),
      band(...along(...BREECH, ...MUZZLE, 0.9), ...along(...BREECH, ...MUZZLE, 1.04), 16, 16),
      circle(BREECH[0] + 3, BREECH[1] + 1.5, 5.5),
      circle(55, 71, 16),
      circle(55, 71, 4),
    ],
    details: spokes(55, 71, 15, 4),
  },
};
