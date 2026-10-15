// The standard pieces, each drawn as what it stands for: a crown, a coronet, a tower, a mitre, a
// horse; the pawn keeps the classic shape.
import { circle, diamond, dot, line, rr } from './draw.mjs';

export const STANDARD = {
  // King: an imperial crown, two arched lobes, an orb and cross, a jewelled band.
  K: {
    shapes: [
      'M25 70C19 48 29 33 41 34C46 35 49 38 50 41C51 38 54 35 59 34C71 33 81 48 75 70Z',
      'M47.5 9H52.5V14H57.5V19H52.5V24H47.5V19H42.5V14H47.5Z',
      circle(50, 30, 6.5),
      rr(22, 68, 78, 82, 4),
    ],
    details: [
      line('M50 41V68'),
      line('M37 36C33 46 33 58 36 68'),
      line('M63 36C67 46 67 58 64 68'),
      dot(circle(34, 75, 2.6)),
      dot(diamond(50, 75, 4, 4)),
      dot(circle(66, 75, 2.6)),
    ],
  },
  // Queen: a coronet, five points tipped with pearls, the middle one tallest, a gem on the band.
  Q: {
    shapes: [
      'M26 70L18 36L33 51L36 27L45 47L50 19L55 47L64 27L67 51L82 36L74 70Z',
      circle(18, 35, 4.5),
      circle(36, 26, 4.5),
      circle(50, 17, 5),
      circle(64, 26, 4.5),
      circle(82, 35, 4.5),
      rr(23, 68, 77, 82, 4),
    ],
    details: [dot(diamond(50, 75, 5, 4.5)), dot(circle(35, 75, 2.2)), dot(circle(65, 75, 2.2))],
  },
  // Rook: a castle tower, battlements, an arched door and a window slit.
  R: {
    shapes: [
      'M31 40L33 82H67L69 40Z',
      'M25 16H35V24H44.5V16H55.5V24H65V16H75V36L69 42H31L25 36Z',
      rr(23, 80, 77, 90, 3.5),
    ],
    details: [line('M43 80V71A7 7 0 0 1 57 71V80'), line('M50 50V60'), line('M31 42H69')],
  },
  // Bishop: a mitre, pointed, with a cross, a band and two ribbons hanging below.
  B: {
    shapes: [
      'M34 72L27 92L33 88.5L38 93L43 72Z',
      'M57 72L62 93L67 88.5L73 92L66 72Z',
      'M50 9C34 19 25 35 26 52L28 66H72L74 52C75 35 66 19 50 9Z',
      rr(26, 64, 74, 75, 3),
    ],
    details: [line('M50 25V55'), line('M40 36H60')],
  },
  // Knight: a horse's head and neck, long face, pricked ear, scalloped mane.
  N: {
    shapes: [
      // The mane, behind the neck.
      'M60 22C69 24 76 30 80 38C85 40 87 46 83 50C88 54 88 61 83 64C87 69 86 75 81 77C84 82 82 87 78 89H66L62 30Z',
      // The head: ear, forehead, long nose, muzzle, jaw, throat, chest.
      'M73 89C78 70 75 50 66 36L64 30L65 12C60 15 56 19 53 23C44 23 36 28 31 35C26 43 21 51 17 58C14 63 16 69 22 69C28 69 34 66 40 65C45 64 48 66 48 70C47 77 42 83 40 89Z',
    ],
    details: [dot('M35 37Q40 32 46 35Q41 39 35 37Z'), line('M20 62Q23 59 26 62'), line('M49 43C55 48 55 57 49 62')],
  },
  // Pawn: the classic shape, round head, collar, bell-shaped body.
  P: {
    shapes: [
      'M41 47C41 59 34 69 29 78H71C66 69 59 59 59 47Z',
      rr(36, 41, 64, 48, 3),
      circle(50, 29, 12),
      rr(24, 77, 76, 88, 4),
    ],
    details: [],
  },
};
