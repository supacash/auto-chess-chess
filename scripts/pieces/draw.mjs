// Drawing helpers for the piece art (scripts/make-pieces.mjs). Every piece is drawn on a 100 × 100
// grid as { shapes, details }:
// - shapes: filled parts, later ones in front. A shape is a path, or { d, s, tx, ty }: a path scaled by
//   s and moved by (tx, ty), so one piece can reuse another's parts.
// - details: inner lines ({ d }) and filled dots ({ d, fill: true }), placed the same way.
//
// render() paints a piece in three passes: every shape stroked thick in the line colour (the outer
// outline), then every shape filled and stroked thin in the detail colour (the inner separations), then
// the details. Colours are CSS variables, so the game can recolour pieces (src/ui/boardDom.ts).

/** The thin line width; the outline is OUTLINE times it. */
export const LINE = 2.6;
const OUTLINE = 2.4;

export const rr = (x1, y1, x2, y2, r) =>
  `M${x1 + r} ${y1}H${x2 - r}Q${x2} ${y1} ${x2} ${y1 + r}V${y2 - r}Q${x2} ${y2} ${x2 - r} ${y2}H${x1 + r}Q${x1} ${y2} ${x1} ${y2 - r}V${y1 + r}Q${x1} ${y1} ${x1 + r} ${y1}Z`;
export const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
export const diamond = (cx, cy, rx, ry) => `M${cx} ${cy - ry}L${cx + rx} ${cy}L${cx} ${cy + ry}L${cx - rx} ${cy}Z`;
/** A filled detail (an eye, a jewel). */
export const dot = (d) => ({ d, fill: true });
/** A detail line. */
export const line = (d) => ({ d });

const round = (n) => Math.round(n * 10) / 10;

/** A band along the line from (x1, y1) to (x2, y2), w1 wide at the start and w2 at the end. */
export function band(x1, y1, x2, y2, w1, w2 = w1) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const [nx, ny] = [-(y2 - y1) / len, (x2 - x1) / len];
  const p = [
    [x1 + (nx * w1) / 2, y1 + (ny * w1) / 2],
    [x2 + (nx * w2) / 2, y2 + (ny * w2) / 2],
    [x2 - (nx * w2) / 2, y2 - (ny * w2) / 2],
    [x1 - (nx * w1) / 2, y1 - (ny * w1) / 2],
  ];
  return `M${p.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
}

/** The point t of the way along the line from (x1, y1) to (x2, y2). */
export const along = (x1, y1, x2, y2, t) => [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];

/** `n` spokes of a wheel of radius r, through its hub. */
export const spokes = (cx, cy, r, n) =>
  Array.from({ length: n }, (_, i) => {
    const a = (Math.PI * i) / n + Math.PI / 8;
    const [x, y] = [r * Math.cos(a), r * Math.sin(a)];
    return line(`M${round(cx + x)} ${round(cy + y)}L${round(cx - x)} ${round(cy - y)}`);
  });

/** Mirrors an absolute M/L/C/Q/Z path left to right, across x = 50. */
export const mirror = (d) =>
  d.replace(/([MLCQ])([^MLCQZ]*)/g, (_, cmd, args) => {
    const n = args
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    return cmd + n.map((v, i) => (i % 2 === 0 ? 100 - v : v)).join(' ');
  });

export const plain = (shapes, details = []) => ({ shapes, details });
export const join = (...pieces) => ({
  shapes: pieces.flatMap((p) => p.shapes),
  details: pieces.flatMap((p) => p.details),
});

/** A piece's parts scaled by s and moved by (tx, ty). */
export function part(piece, s, tx, ty) {
  const place = (x) =>
    typeof x === 'string'
      ? { d: x, s, tx, ty }
      : { ...x, s: s * (x.s ?? 1), tx: tx + s * (x.tx ?? 0), ty: ty + s * (x.ty ?? 0) };
  return { shapes: piece.shapes.map(place), details: piece.details.map(place) };
}

/** One path, placed if it's a part, with its line width kept the same on screen. */
function path(x, width, attrs = '') {
  if (typeof x === 'string') return `<path d="${x}"${attrs}/>`;
  const { d, s = 1, tx = 0, ty = 0 } = x;
  if (s === 1 && tx === 0 && ty === 0) return `<path d="${d}"${attrs}/>`;
  return `<path d="${d}" transform="translate(${round(tx)} ${round(ty)}) scale(${s})" stroke-width="${+(width / s).toFixed(3)}"${attrs}/>`;
}

/**
 * The piece's SVG markup (no <svg> around it). `paint` gives its colours; by default the CSS
 * variables --piece-fill, --piece-line and --piece-detail (which defaults to the line colour).
 */
export function render({ shapes, details }, paint = {}) {
  const fill = paint.fill ?? 'var(--piece-fill, #fff)';
  const outline = paint.line ?? 'var(--piece-line, #111)';
  const detail = paint.detail ?? 'var(--piece-detail, var(--piece-line, #111))';
  const thick = LINE * OUTLINE;
  return [
    `<g fill="${outline}" stroke="${outline}" stroke-width="${thick}" stroke-linejoin="round">${shapes.map((x) => path(x, thick)).join('')}</g>`,
    `<g fill="${fill}" stroke="${detail}" stroke-width="${LINE}" stroke-linejoin="round">${shapes.map((x) => path(x, LINE)).join('')}</g>`,
    `<g fill="none" stroke="${detail}" stroke-width="${LINE}" stroke-linecap="round" stroke-linejoin="round">${details
      .map((x) => path(x.s ? x : x.d, LINE, x.fill ? ` fill="${detail}" stroke="none"` : ''))
      .join('')}</g>`,
  ].join('');
}
