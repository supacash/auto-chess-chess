import { averagePlace, averageScore, favouritePiece, matchKey, type Records, runKey } from '../game/records';
import {
  ACHIEVEMENT_GROUPS,
  ACHIEVEMENT_ICONS,
  ACHIEVEMENTS,
  achievementGroup,
  FUSION_RESULTS,
  SHOP_FAIRY,
} from '../game/achievements';
import { FINAL_ROUND } from '../rules/run';
import { ordinal } from '../multi/names';
import { DIFFICULTIES } from '../rules/difficulty';
import { MODES } from '../rules/mode';
import { PIECE_NAME } from '../rules/pieces';
import { inlinePiece } from '../ui/boardDom';
import { $, escapeHtml } from './dom';
import { matchLabel, type RecordBook, runLabel } from './recordBook';

type Tab = 'single' | 'multi' | 'history' | 'fun' | 'achievements';

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
            : this.tab === 'fun'
              ? fun(r)
              : achievementsTab(r);
  }
}

const stat = (label: string, value: string) =>
  `<div class="stat"><span class="stat-value">${value}</span><span class="stat-label">${label}</span></div>`;
const card = (title: string, stats: string, extra = '') =>
  `<div class="record-card"><h3>${title}</h3><div class="stats">${stats}</div>${extra}</div>`;
const empty = (text: string) => `<p class="profile-empty">${text}</p>`;
const fmt = (n: number | null, digits = 1) => (n === null ? '–' : n.toFixed(digits).replace(/\.0$/, ''));

function single(r: Records): string {
  const cards = [false, true]
    .flatMap((manual) =>
      MODES.flatMap((m) =>
        DIFFICULTIES.map((d) => {
          const s = r.runs[runKey(m.id, d.id, manual)];
          if (!s || (s.runs === 0 && s.best === 0 && s.rounds.w + s.rounds.l + s.rounds.d === 0)) return '';
          const { w, l, d: draws } = s.rounds;
          return card(
            runLabel({ mode: m.id, difficulty: d.id, manual }),
            stat('Runs', String(s.runs)) +
              stat('Best', String(s.best)) +
              stat('Average', fmt(averageScore(s))) +
              stat('W/L/D', `${w}/${l}/${draws}`),
            (s.completed > 0
              ? `<p class="record-note">🏆 Completed all ${FINAL_ROUND} rounds ${s.completed} time${s.completed === 1 ? '' : 's'}</p>`
              : '') + (s.prestige > 0 ? `<p class="record-note">★ Highest prestige: ${s.prestige}</p>` : ''),
          );
        }),
      ),
    )
    .join('');
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
          ? h.result >= FINAL_ROUND
            ? '<span class="win">🏆 Completed</span>'
            : `Won ${h.result} round${h.result === 1 ? '' : 's'}`
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
    card(
      'Most-bought piece',
      `<div class="favourite">${favourite}</div>`,
      '<p class="profile-note">Not counting pawns, Ferzes and Wazirs.</p>',
    ) +
    card(
      'Collections',
      stat('Fairy pieces fielded', `${r.collections.fielded.length}/${SHOP_FAIRY.length}`) +
        stat('Fusions made', `${r.collections.fused.length}/${FUSION_RESULTS.length}`),
    ) +
    card(
      'Battles',
      stat('Best win streak', String(f.bestWinStreak)) +
        stat('Current streak', String(f.winStreak)) +
        stat('Checkmates', String(f.checkmates)) +
        stat('Biggest comeback', f.biggestComeback ? `${f.biggestComeback} pts` : '–'),
    )
  );
}

/** Every achievement: unlocked ones with the date, the rest greyed out (secret ones hidden). */
function achievementsTab(r: Records): string {
  const open = ACHIEVEMENTS.filter((a) => !a.secret || r.achievements[a.id] !== undefined);
  const got = open.filter((a) => r.achievements[a.id] !== undefined).length;
  // Collection progress, shown under Zoo Keeper and Fusion Chef until they're done.
  const progress: Partial<Record<string, string>> = {
    zooKeeper: `${r.collections.fielded.length}/${SHOP_FAIRY.length} so far`,
    fusionChef: `${r.collections.fused.length}/${FUSION_RESULTS.length} so far`,
  };
  const item = (a: (typeof ACHIEVEMENTS)[number]) => {
    const at = r.achievements[a.id];
    if (at === undefined && a.secret) {
      return '<li class="achievement locked"><span class="badge" aria-hidden="true">?</span><span class="achievement-body"><span class="achievement-name">???</span><span class="achievement-text">A secret, for later.</span></span></li>';
    }
    const when =
      at === undefined
        ? progress[a.id]
          ? `<span class="achievement-date">${progress[a.id]}</span>`
          : ''
        : `<span class="achievement-date">${new Date(at).toLocaleDateString()}</span>`;
    const badge = `<span class="badge" aria-hidden="true">${ACHIEVEMENT_ICONS[a.id]}</span>`;
    return `<li class="achievement ${at === undefined ? 'locked' : 'unlocked'}">${badge}<span class="achievement-body"><span class="achievement-name">${escapeHtml(a.name)}</span><span class="achievement-text">${escapeHtml(a.description)}</span>${when}</span></li>`;
  };
  // By group, unlocked ones first within each.
  const groups = ACHIEVEMENT_GROUPS.map((g) => {
    const list = ACHIEVEMENTS.filter((a) => achievementGroup(a.id) === g.id).sort(
      (x, y) => Number(r.achievements[y.id] !== undefined) - Number(r.achievements[x.id] !== undefined),
    );
    const done = list.filter((a) => r.achievements[a.id] !== undefined).length;
    return `<h3 class="achievement-group">${g.name} <small>${done}/${list.filter((a) => !a.secret || r.achievements[a.id] !== undefined).length}</small></h3><ul class="achievements">${list.map(item).join('')}</ul>`;
  }).join('');
  const share = open.length ? Math.round((got / open.length) * 100) : 0;
  return `<div class="achievement-count"><span><strong>${got}</strong> of ${open.length} unlocked</span><span class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${open.length}" aria-valuenow="${got}" aria-label="Achievements unlocked"><span style="width:${share}%"></span></span></div>${groups}`;
}
