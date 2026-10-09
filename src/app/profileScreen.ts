import { averagePlace, averageScore, favouritePiece, matchKey, type Records, runKey } from '../game/records';
import { ordinal } from '../multi/names';
import { DIFFICULTIES } from '../rules/difficulty';
import { MODES } from '../rules/mode';
import { PIECE_NAME } from '../rules/pieces';
import { inlinePiece } from '../ui/boardDom';
import { $, escapeHtml } from './dom';
import { matchLabel, type RecordBook, runLabel } from './recordBook';

type Tab = 'single' | 'multi' | 'history' | 'fun';

/** The Profile screen: the player's name and their records, by tab. */
export class ProfileScreen {
  private readonly section = $('#profile');
  private tab: Tab = 'single';

  constructor(
    private readonly book: RecordBook,
    private readonly name: () => string,
    private readonly newName: () => string,
    onBack: () => void,
  ) {
    $('#profile-tabs').addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-tab]');
      if (!btn) return;
      this.tab = btn.dataset.tab as Tab;
      this.render();
    });
    $('#profile-rename').addEventListener('click', () => {
      $('#profile-name').textContent = this.newName();
    });
    $('#profile-back').addEventListener('click', onBack);
  }

  show(): void {
    this.section.hidden = false;
    $('#profile-name').textContent = this.name();
    this.render();
  }

  hide(): void {
    this.section.hidden = true;
  }

  private render(): void {
    for (const btn of document.querySelectorAll<HTMLButtonElement>('#profile-tabs button')) {
      const active = btn.dataset.tab === this.tab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    }
    const r = this.book.records;
    const body = $('#profile-body');
    body.innerHTML =
      this.tab === 'single'
        ? single(r)
        : this.tab === 'multi'
          ? multi(r)
          : this.tab === 'history'
            ? history(r)
            : fun(r);
  }
}

const stat = (label: string, value: string) =>
  `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
const card = (title: string, stats: string, extra = '') =>
  `<div class="record-card"><h3>${title}</h3><div class="stats">${stats}</div>${extra}</div>`;
const empty = (text: string) => `<p class="profile-empty">${text}</p>`;
const fmt = (n: number | null, digits = 1) => (n === null ? '–' : n.toFixed(digits).replace(/\.0$/, ''));

function single(r: Records): string {
  const cards = MODES.flatMap((m) =>
    DIFFICULTIES.map((d) => {
      const s = r.runs[runKey(m.id, d.id)];
      if (!s || (s.runs === 0 && s.best === 0 && s.rounds.w + s.rounds.l + s.rounds.d === 0)) return '';
      const { w, l, d: draws } = s.rounds;
      return card(
        runLabel({ mode: m.id, difficulty: d.id }),
        stat('Runs', String(s.runs)) +
          stat('Best', String(s.best)) +
          stat('Average', fmt(averageScore(s))) +
          stat('Rounds W/L/D', `${w}/${l}/${draws}`),
      );
    }),
  ).join('');
  return cards || empty('No single-player runs yet. Start one from New game!');
}

function multi(r: Records): string {
  const cards = [true, false]
    .flatMap((online) =>
      [false, true].map((blitz) => {
        const s = r.matches[matchKey(online, blitz)];
        if (!s || s.matches === 0) return '';
        const [first, second] = s.places;
        const bar = `<div class="place-bar">${s.places
          .map(
            (n, i) =>
              `<span class="place-${i + 1}" style="flex:${n || 0}" title="${ordinal(i + 1)}: ${n}">${n ? ordinal(i + 1) : ''}</span>`,
          )
          .join('')}</div>`;
        return card(
          matchLabel(online, blitz),
          stat('Matches', String(s.matches)) +
            stat('Wins', String(first)) +
            stat('Avg place', fmt(averagePlace(s))) +
            stat('Top 2', `${Math.round(((first + second) / s.matches) * 100)}%`),
          bar,
        );
      }),
    )
    .join('');
  return cards || empty('No multiplayer matches yet. Try one from Multiplayer!');
}

function history(r: Records): string {
  if (r.history.length === 0) return empty('Finished runs and matches will show up here.');
  const when = (at: number) => {
    const d = new Date(at);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? `Today ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  return `<ol class="history">${r.history
    .map((h) => {
      const result =
        h.kind === 'run'
          ? `Won ${h.result} round${h.result === 1 ? '' : 's'}`
          : `<span class="${h.result === 1 ? 'win' : ''}">${ordinal(h.result)} place</span>`;
      return `<li><span class="history-mode">${escapeHtml(h.mode)}</span><span class="history-result">${result}</span><span class="history-when">${when(h.at)}</span></li>`;
    })
    .join('')}</ol>`;
}

function fun(r: Records): string {
  const f = r.fun;
  const top = favouritePiece(f);
  const favourite = top
    ? `${inlinePiece(top.type)} ${PIECE_NAME[top.type]} <small>×${top.count}</small>`
    : '<small>none yet</small>';
  return (
    card('Most-bought piece', `<div class="favourite">${favourite}</div>`) +
    card(
      'Battles',
      stat('Best win streak', String(f.bestWinStreak)) +
        stat('Current streak', String(f.winStreak)) +
        stat('Checkmates', String(f.checkmates)) +
        stat('Biggest comeback', f.biggestComeback ? `${f.biggestComeback} pts` : '–'),
    )
  );
}
