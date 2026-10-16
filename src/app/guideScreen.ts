import { AFFINITY_PRICE } from '../rules/economy';
import {
  GUIDE_GROUPS,
  type GuideGroup,
  type GuidePart,
  type GuideWay,
  guideGroup,
  guidePieces,
  isFairyPiece,
  isFairyWay,
  waysToGet,
} from '../rules/pieceGuide';
import { AFFINITIES, HEIR_WORTH, PIECE_NAME, PIECE_VALUE, PIECES, type PieceType } from '../rules/pieces';
import { inlinePiece } from '../ui/boardDom';
import { moveDiagram } from '../ui/moveDiagram';
import { $ } from './dom';

const GROUP_TITLE: Record<GuideGroup, string> = {
  standard: 'Standard',
  pawns: 'Pawns',
  fairy: 'Fairy',
  fusions: 'Fusions',
};

const GROUP_NOTE: Record<GuideGroup, string> = {
  standard: 'The chess pieces, in every run.',
  pawns: 'Pawns move forward and promote on the last rank, for that battle only. They can’t stand on the back row.',
  fairy: 'Fairy pieces show up only with Fairy pieces on (New game).',
  fusions:
    'Made by fusing two pieces or merging three, with Fairy pieces on (two Rooks or three Knights or Bishops make a Queen in every run).',
};

/**
 * The Piece guide: every piece a player can meet, by section, with its move diagram, value, what it
 * does and how to get it (pieceGuide.ts reads that off the shop rules). It opens over whatever is on
 * screen, from the menu or a piece panel in the shop, and Back goes back there.
 */
export class GuideScreen {
  private readonly section = $('#guide');
  private group: GuideGroup = 'standard';
  /** Where focus was before the guide opened, to put it back. */
  private returnFocus: HTMLElement | null = null;

  constructor() {
    $('#guide-tabs').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-group]');
      if (!btn) return;
      this.group = btn.dataset.group as GuideGroup;
      this.render();
      this.section.scrollTop = 0;
    });
    $('#guide-back').addEventListener('click', () => this.close());
    this.section.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  get isOpen(): boolean {
    return !this.section.hidden;
  }

  /** Opens the guide, on `type`'s entry if given. */
  open(type?: PieceType): void {
    if (!this.isOpen) this.returnFocus = document.activeElement as HTMLElement | null;
    if (type) this.group = guideGroup(type);
    this.section.hidden = false;
    document.body.classList.add('guide-open');
    this.render();
    const entry = type ? this.section.querySelector<HTMLElement>(`[data-piece="${type}"]`) : null;
    if (entry) {
      entry.scrollIntoView({ block: 'start' });
      entry.classList.add('flash');
      entry.addEventListener('animationend', () => entry.classList.remove('flash'), { once: true });
    } else this.section.scrollTop = 0;
    this.section.querySelector<HTMLElement>('#guide-tabs button.active')?.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    this.section.hidden = true;
    document.body.classList.remove('guide-open');
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  private render(): void {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#guide-tabs button')) {
      const active = btn.dataset.group === this.group;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    const entries = guidePieces(this.group).map(entry).join('');
    $('#guide-body').innerHTML = `<p class="profile-note guide-note">${GROUP_NOTE[this.group]}</p>${entries}`;
  }
}

/** The tab buttons, for layout.ts. */
export function guideTabs(): string {
  return GUIDE_GROUPS.map((g) => `<button type="button" role="tab" data-group="${g}">${GROUP_TITLE[g]}</button>`).join(
    '',
  );
}

/** One piece's card. */
function entry(type: PieceType): string {
  const fairy = isFairyPiece(type) ? '<span class="guide-tag">Fairy</span>' : '';
  const ways = waysToGet(type)
    .map(
      (w) =>
        `<li>${wayText(type, w)}${isFairyWay(w) && !isFairyPiece(type) ? ' <span class="guide-tag">Fairy</span>' : ''}</li>`,
    )
    .join('');
  return (
    `<article class="record-card guide-entry" id="guide-${type}" data-piece="${type}">` +
    `<div class="guide-entry-head">${moveDiagram(type)}<div class="guide-entry-text">` +
    `<h3>${inlinePiece(type)}<span class="guide-name">${PIECE_NAME[type]}</span>${value(type)}${fairy}</h3>` +
    `<p class="guide-desc">${PIECES[type].description}${extra(type)}</p></div></div>` +
    `<p class="guide-get">How to get it</p><ul class="guide-ways">${ways}</ul></article>`
  );
}

function value(type: PieceType): string {
  if (type === 'K') return '';
  const pts = type === 'J' ? HEIR_WORTH : PIECE_VALUE[type];
  return `<span class="guide-value">${pts} ${pts === 1 ? 'pt' : 'pts'}</span>`;
}

/** What the one-line description leaves out. */
function extra(type: PieceType): string {
  if (type === 'J')
    return ` Counts ${HEIR_WORTH} points in your army (the three Queens) but none in battle. One per army (two with the Dynasty perk); can’t be sold.`;
  return '';
}

function plural(name: string, count: number): string {
  if (count === 1) return `a ${name}`;
  return `${count} ${name === 'Man' ? 'Men' : `${name}s`}`;
}

function part({ type, affinity, count }: GuidePart): string {
  const name = affinity ? `${PIECE_NAME[affinity]}-pawn` : PIECE_NAME[type];
  const each = affinity ? ` (${AFFINITY_PRICE[affinity]} gold each)` : '';
  return `${inlinePiece(type, 'w', affinity)} ${plural(name, count)}${each}`;
}

function wayText(type: PieceType, way: GuideWay): string {
  switch (way.kind) {
    case 'start':
      return type === 'K' ? 'Every army has one; it can’t be sold.' : `You start with ${way.count}.`;
    case 'shop':
      return `Shop offer: ${way.gold} gold${way.fromRound > 1 ? `, from round ${way.fromRound}` : ''}.`;
    case 'affinityPawns': {
      const prices = AFFINITIES.map((a) => AFFINITY_PRICE[a]);
      const names = AFFINITIES.map((a) => inlinePiece('P', 'w', a)).join('');
      return `Shop: ${names} affinity pawns (${Math.min(...prices)}–${Math.max(...prices)} gold) fight as Pawns until merged.`;
    }
    case 'merge': {
      const others = way.oneOf
        ? ` + ${way.oneOf.map((t) => inlinePiece(t)).join('')} a ${way.oneOf
            .map((t) => PIECE_NAME[t])
            .join(', ')
            .replace(/, ([^,]*)$/, ' or $1')}`
        : '';
      return `Merge ${way.parts.map(part).join(' + ')}${others}.`;
    }
    case 'upgrade':
      return `Upgrade a plain ${inlinePiece(way.from)} ${PIECE_NAME[way.from]} for ${way.gold} gold.`;
    case 'fusion':
      return `Fuse ${way.parts.map(part).join(' + ')}.`;
  }
}
