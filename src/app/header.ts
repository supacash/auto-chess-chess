import { difficulty } from '../rules/difficulty';
import { FINAL_ROUND, maxLives, runScore } from '../rules/run';
import { $ } from './dom';
import type { Session } from './session';

const HEART = '♥︎';

/** Round, lives, board size, side, record and best score. `round` lets the result screen keep showing the round just played. */
/** `color` is the player's colour in that round (the run may already have picked the next round's). */
export function renderHeader(session: Session, round = session.run.round, color = session.run.color): void {
  const { lives, record, settings } = session.run;
  const spec = session.boardOf(round);
  const star = session.run.prestige > 0 ? ` ★${session.run.prestige}` : '';
  $('#round').textContent = `Round ${round}/${FINAL_ROUND}${star}`;
  const most = maxLives(session.run.perks);
  const livesEl = $('#lives');
  livesEl.innerHTML = Array.from(
    { length: most },
    (_, i) => `<span class="heart ${i < lives ? 'full' : 'empty'}">${HEART}</span>`,
  ).join('');
  livesEl.setAttribute('aria-label', `${lives} of ${most} lives`);
  $('#board-size').textContent = `${spec.files}×${spec.ranks} · ${color === 'w' ? 'White' : 'Black'}`;
  $('#record').textContent = `${record.w}W ${record.l}L ${record.d}D`;
  const level = difficulty(settings.difficulty);
  $('#best').textContent =
    `Best ${Math.max(session.best, runScore(session.run))}${level.id === 'normal' ? '' : ` (${level.name})`}`;
}
