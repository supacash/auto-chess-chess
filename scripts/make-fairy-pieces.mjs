// Generates the fairy piece icons in src/assets/pieces/ (w?.svg / b?.svg next to the Chessnut set).
//
// - Fusion pieces (Centaur, Archbishop, Chancellor, Amazon) are composed from two Chessnut pieces:
//   the partner behind, the knight in front. That's a derivative of the Apache-2.0 Chessnut art.
// - The other fairy pieces are original shapes drawn here in Chessnut's style: white pieces are
//   filled white with a black outline, black pieces solid black with light detail lines.
//
// Run: node scripts/make-fairy-pieces.mjs  (then commit the generated SVGs)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'pieces');
const HEADER = '<svg xmlns="http://www.w3.org/2000/svg" style="color-scheme:light only" viewBox="0 0 800 800">';

// ---- shared parts (800×800 canvas, pieces stand on a base around y = 600–695) ----

const BASE = 'M215 590h370c22 0 35 13 35 35v35c0 22-13 35-35 35H215c-22 0-35-13-35-35v-35c0-22 13-35 35-35z';
const BASE_LINE = 'M215 642h370';
const DOME = 'M235 595c0-185 70-330 165-330s165 145 165 330z';
const KNOB = 'M400 150a55 55 0 1 1 0 110 55 55 0 0 1 0-110z';

/**
 * Each piece: `body` paths are filled (white, or black) and outlined; `detail` paths are thin lines
 * (black on white pieces, light on black ones); `bold` paths are thick lines drawn in the outline
 * colour on both (antennae, spokes).
 */
const SHAPES = {
  // Berolina pawn: a pawn marked with diagonal arrows (it moves diagonally).
  E: {
    body: [
      BASE,
      'M400 130a100 100 0 1 1 0 200 100 100 0 0 1 0-200z',
      'M325 320h150c-6 105 38 195 110 275H215c72-80 116-170 110-275z',
    ],
    detail: [BASE_LINE, 'M365 540l-70-70m0 0v45m0-45h45', 'M435 540l70-70m0 0v45m0-45h-45'],
  },
  // Ferz: one diagonal step — a dome marked with an X.
  F: { body: [BASE, DOME, KNOB], detail: [BASE_LINE, 'M325 380l150 150M475 380L325 530'] },
  // Wazir: one straight step — a dome marked with a plus.
  W: { body: [BASE, DOME, KNOB], detail: [BASE_LINE, 'M400 360v190M305 455h190'] },
  // Man: a king that can be captured — a dome with a small crown.
  M: {
    body: [BASE, 'M235 595c0-150 65-260 165-260s165 110 165 260z', 'M270 360l-20-210 90 95 60-145 60 145 90-95-20 210z'],
    detail: [BASE_LINE, 'M282 360h236'],
  },
  // Camel: two humps.
  L: {
    body: [BASE, 'M195 595c0-190 35-330 115-330 65 0 70 120 95 120s30-190 115-190 95 180 95 400z'],
    detail: [BASE_LINE, 'M290 520c35 25 80 25 115 0'],
  },
  // Grasshopper: a body with antennae and a leaping arc.
  G: {
    body: [BASE, 'M240 595c0-160 65-280 160-280s160 120 160 280z'],
    detail: [BASE_LINE, 'M300 520c45-85 155-85 200 0m0 0l-48-6m48 6l6-48'],
    bold: ['M360 325c-25-90-85-160-150-200', 'M440 325c25-90 85-160 150-200'],
  },
  // Cannon: a barrel on a wheel.
  X: {
    body: [
      BASE,
      'M265 480l300-235c25-20 60-15 78 9s14 59-10 78L330 585z',
      'M320 405a115 115 0 1 1 0 230 115 115 0 0 1 0-230z',
    ],
    detail: [BASE_LINE, 'M320 485a35 35 0 1 1 0 70 35 35 0 0 1 0-70z', 'M575 275l45 58'],
  },
};

const STYLE = {
  w: { fill: '#fff', outline: '#000', detail: '#000' },
  b: { fill: '#000', outline: '#000', detail: '#f2f2f2' },
};

function drawShape(shape, color) {
  const s = STYLE[color];
  const body = shape.body
    .map((d) => `<path fill="${s.fill}" stroke="${s.outline}" stroke-width="30" stroke-linejoin="round" d="${d}"/>`)
    .join('');
  const bold = (shape.bold ?? [])
    .map((d) => `<path fill="none" stroke="${s.outline}" stroke-width="26" stroke-linecap="round" d="${d}"/>`)
    .join('');
  const detail = shape.detail
    .map(
      (d) =>
        `<path fill="none" stroke="${s.detail}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" d="${d}"/>`,
    )
    .join('');
  return `${HEADER}${bold}${body}${detail}</svg>\n`;
}

// ---- fusion pieces: partner behind, knight in front, both Chessnut ----

const FUSION = { T: 'K', A: 'B', C: 'R', Z: 'Q' };

/** The drawing inside a Chessnut SVG (everything between <svg …> and </svg>). */
function inner(file) {
  const svg = readFileSync(join(dir, file), 'utf8');
  return svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
}

function drawFusion(partner, color) {
  const back = `<g transform="translate(-30 -20) scale(0.82)">${inner(`${color}${partner}.svg`)}</g>`;
  const front = `<g transform="translate(170 150) scale(0.78)">${inner(`${color}N.svg`)}</g>`;
  return `${HEADER}${back}${front}</svg>\n`;
}

for (const color of ['w', 'b']) {
  for (const [type, shape] of Object.entries(SHAPES)) writeFileSync(join(dir, `${color}${type}.svg`), drawShape(shape, color));
  for (const [type, partner] of Object.entries(FUSION)) {
    writeFileSync(join(dir, `${color}${type}.svg`), drawFusion(partner, color));
  }
}
console.log('Wrote', 2 * (Object.keys(SHAPES).length + Object.keys(FUSION).length), 'fairy piece icons to', dir);
