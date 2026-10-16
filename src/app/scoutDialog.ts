import type { BoardSpec } from '../chess/boardSpec';
import { START_HP, streakBonus } from '../multi/match';
import type { MatchSession } from '../multi/matchSession';
import { matchPerk } from '../multi/perks';
import { ordinal } from '../multi/names';
import { POOL_KINDS, poolKindName } from '../multi/pool';
import type { Piece, PieceType } from '../rules/pieces';
import { inlinePiece } from '../ui/boardDom';
import { $, escapeHtml } from './dom';

/** Scouting: tap a player in the health list to see their health so far, perks, pawns and armies. */
export class ScoutDialog {
  private readonly dialog = $<HTMLDialogElement>('#scout-dialog');

  open(m: MatchSession, id: string): void {
    const p = m.player(id);
    const me = id === m.myId;
    const hp = Math.max(0, p.hp);
    const streak = m.streaks.get(id) ?? 0;
    const status = p.place !== null ? `${ordinal(p.place)} place` : `${hp}/${START_HP} HP`;
    const streakText =
      Math.abs(streak) >= 2
        ? ` · ${Math.abs(streak)} ${streak > 0 ? 'wins' : 'losses'} in a row (+${streakBonus(streak)} gold)`
        : '';
    $('#scout-title').textContent = me ? 'You' : p.name;
    $('#scout-status').textContent = `${p.bot ? 'Bot · ' : ''}${status}${streakText}`;

    const sections: string[] = [];
    const history = m.healthOf(id);
    if (history.length > 1) sections.push(section('Health by round', sparkline(history)));

    const perks = m.perksOf(id).map(matchPerk);
    sections.push(
      section(
        'Perks',
        perks.length
          ? `<ul class="scout-perks">${perks.map((x) => `<li>${x.icon} <strong>${escapeHtml(x.name)}</strong> · ${escapeHtml(x.description)}</li>`).join('')}</ul>`
          : '<p class="muted">None yet.</p>',
      ),
    );

    const held = m.holdingsOf(id);
    const pooled = POOL_KINDS.filter((k) => (held[k] ?? 0) > 0).map((k) => {
      const icon = k === 'F' || k === 'W' ? inlinePiece(k) : inlinePiece('P', 'w', k);
      const n = held[k] ?? 0;
      return `${icon} ${n} ${poolKindName(k).toLowerCase()}${n === 1 ? '' : 's'}`;
    });
    sections.push(
      section('From the shared pool', pooled.length ? `<p>${pooled.join(' · ')}</p>` : '<p class="muted">None.</p>'),
    );

    const now = m.phase === 'shop' && p.place === null ? m.currentTypes(id) : null;
    if (now) sections.push(section(me ? 'Placed now' : 'Placing now', pieceRow(now)));

    const last = m.army(id);
    if (last.length && m.lockedBoard) {
      const label = m.phase === 'battle' ? 'This round’s army' : 'Last round’s army';
      sections.push(section(label, miniBoard(last, m.lockedBoard)));
    }

    $('#scout-body').innerHTML = sections.join('');
    if (!this.dialog.open) {
      this.dialog.showModal();
      this.dialog.scrollTop = 0; // opening focuses Close, at the bottom: start at the top
    }
  }
}

function section(title: string, body: string): string {
  return `<section class="scout-section"><h3>${escapeHtml(title)}</h3>${body}</section>`;
}

function pieceRow(types: PieceType[]): string {
  if (types.length === 0) return '<p class="muted">Nothing yet.</p>';
  const order = 'KQRBNP';
  const sorted = [...types].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  return `<p class="scout-pieces">${sorted.map((t) => inlinePiece(t)).join('')}</p>`;
}

/**
 * A player's home rows with their army on it, as they placed it (their side at the bottom). `facing`
 * draws an opponent's army as seen from across the board instead: back row on top, in `color`.
 */
export function miniBoard(pieces: Piece[], spec: BoardSpec, facing = false, color: 'w' | 'b' = 'w'): string {
  const rows: string[] = [];
  for (let i = 0; i < spec.homeRows; i++) {
    const rank = facing ? i : spec.homeRows - 1 - i;
    for (let file = 0; file < spec.files; file++) {
      const piece = pieces.find((x) => x.square?.file === file && x.square.rank === rank);
      const shade = (file + rank) % 2 === 0 ? 'dark' : 'light';
      rows.push(
        `<span class="mini-square ${shade}">${piece ? inlinePiece(piece.type, color, piece.affinity) : ''}</span>`,
      );
    }
  }
  return `<div class="mini-board" style="grid-template-columns: repeat(${spec.files}, 1fr)">${rows.join('')}</div>`;
}

/** Health after each round as a small line chart. */
function sparkline(values: number[]): string {
  const w = 240;
  const h = 44;
  const x = (i: number) => (values.length === 1 ? 0 : (i / (values.length - 1)) * w);
  const y = (v: number) => h - 2 - (Math.max(0, v) / START_HP) * (h - 4);
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="sparkline" viewBox="-2 0 ${w + 4} ${h}" role="img" aria-label="Health: ${values.join(', ')}"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" /></svg><p class="muted scout-hp">${values.join(' → ')}</p>`;
}
