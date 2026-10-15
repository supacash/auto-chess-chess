// The fusion pieces. Knight compounds show the horse with its partner's emblem (worn, or behind it);
// the rest are drawn as what they're named for.
import { along, band, circle, dot, join, line, mirror, part, plain, rr, spokes } from './draw.mjs';
import { STANDARD } from './standard.mjs';

const N = STANDARD.N;
// Partners' emblems, without their stands: the mitre (no ribbons), the coronet, the tower.
const MITRE = { shapes: STANDARD.B.shapes.slice(2), details: STANDARD.B.details };
const TOWER = { shapes: STANDARD.R.shapes.slice(0, 2), details: STANDARD.R.details.slice(0, 2) };

// A dragon's wing (left; the right one is mirrored), with two finger bones.
const WING = 'M38 60C30 45 20 34 5 25C8 36 7 47 9 56C13 51 18 51 20 57C24 53 28 54 30 61Z';
const WING_BONES = ['M35 57L8 29', 'M33 59L18 50'];
const WINGS = plain([WING, mirror(WING)], [...WING_BONES, ...WING_BONES.map(mirror)].map(line));

// The wildebeest's horn and ear (left; the right ones are mirrored).
const GNU_HORN = 'M41 29C30 31 17 33 13 25C11 19 15 13 19 15C19 21 26 23 41 22Z';
const GNU_EAR = 'M37 35C28 37 22 41 19 44C25 46 31 45 37 42Z';

// The Siege Cannon's barrel, from the breech to the muzzle.
const BARREL = [82, 58, 18, 28];

export const FUSIONS = {
  // Archbishop (bishop + knight): the horse wearing a mitre.
  A: join(part(N, 0.86, 9, 12), part(MITRE, 0.42, 22, 6)),
  // Amazon (queen + knight): the horse wearing the coronet.
  Z: join(part(N, 0.86, 9, 12), part(STANDARD.Q, 0.38, 25, 8)),
  // Chancellor (rook + knight): the horse in front of a tower.
  C: join(part(TOWER, 0.66, 32, 2), part(N, 0.86, 2, 12)),
  // Centaur (king's steps + knight): an archer, a man's body on a horse's, drawing a bow.
  T: plain(
    [
      // Tail, legs (the far pair first), body.
      'M86 53C95 55 97 66 93 74C92 66 90 60 85 57Z',
      band(57, 64, 60, 88, 7.5),
      band(82, 62, 87, 87, 7.5),
      band(47, 64, 44, 88, 7.5),
      band(75, 64, 72, 88, 7.5),
      'M36 51C38 44 49 42 61 44L77 45C87 46 91 53 89 62C88 67 84 70 80 70H45C37 70 34 60 36 51Z',
      // The man: torso, head, arm out to the bow.
      'M33 56C31 45 32 37 36 30H50C53 37 52 47 50 53Z',
      circle(43, 20, 8.5),
      band(39, 35, 18, 33, 7),
    ],
    [line('M22 12C12 24 12 42 22 54'), line('M22 12L22 54')],
  ),
  // Dragon King (rook + diagonal step): a tower with dragon wings.
  D: join(WINGS, part(STANDARD.R, 0.8, 10, 14)),
  // Dragon Horse (bishop + straight step): a mitre with dragon wings.
  H: join(WINGS, part(STANDARD.B, 0.8, 10, 12)),
  // Wildebeest (knight + camel): a gnu's face, front on: horns curving out, ears, a beard.
  U: plain(
    [
      GNU_HORN,
      mirror(GNU_HORN),
      GNU_EAR,
      mirror(GNU_EAR),
      'M50 20C41 20 35 27 35 37C35 50 37 62 39 74C40 82 44 87 50 87C56 87 60 82 61 74C63 62 65 50 65 37C65 27 59 20 50 20Z',
      'M44 87C44 92 47 96 50 96C53 96 56 92 56 87Z',
      rr(38, 72, 62, 89, 8),
      'M43 23C43 15 47 11 50 11C53 11 57 15 57 23Z',
    ],
    [dot(circle(43, 43, 2.6)), dot(circle(57, 43, 2.6)), dot(circle(45, 81, 2)), dot(circle(55, 81, 2))],
  ),
  // Siege Cannon (cannon + bishop): a heavier cannon, its barrel bound with iron rings.
  S: plain(
    [
      'M48 66L84 55L95 86L86 88Z',
      band(...BARREL, 21, 15),
      band(...along(...BARREL, 0.9), ...along(...BARREL, 1.04), 19, 19),
      band(...along(...BARREL, 0.32), ...along(...BARREL, 0.4), 23, 23),
      band(...along(...BARREL, 0.6), ...along(...BARREL, 0.67), 21, 21),
      circle(86, 59.5, 6.5),
      circle(55, 72, 17),
      circle(55, 72, 4.5),
    ],
    spokes(55, 72, 16, 4),
  ),
  // Stackman (three Men): three stacked up, the top one crowned. Drawn on an 800 grid (the drawing
  // the game had before this set).
  Y: part(
    {
      shapes: [
        'M215 590h370c22 0 35 13 35 35v35c0 22-13 35-35 35H215c-22 0-35-13-35-35v-35c0-22 13-35 35-35z',
        'M240 595c0-70 65-118 160-118s160 48 160 118z',
        'M275 482c0-62 55-105 125-105s125 43 125 105z',
        'M305 382c0-55 42-92 95-92s95 37 95 92z',
        'M322 295l-14-120 58 58 34-75 34 75 58-58-14 120z',
      ],
      details: [line('M215 642h370'), line('M332 295h136'), line('M285 477h230'), line('M318 377h164')],
    },
    0.125,
    0,
    0,
  ),
  // Heir (a second king): a rounded crown, three lobes and a knob, no cross, on a ring.
  J: plain(
    [
      circle(50, 25, 4.5),
      'M27 74C22 61 17 49 21 41C25 34 34 35 38 43C40 33 44 28 50 28C56 28 60 33 62 43C66 35 75 34 79 41C83 49 78 61 73 74Z',
      rr(22, 71, 78, 85, 7),
    ],
    [line('M38 44C40 54 40 64 39 73'), line('M62 44C60 54 60 64 61 73'), line('M30 78H70')],
  ),
};
