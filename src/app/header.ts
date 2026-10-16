import { difficulty } from '../rules/difficulty';
import { dailyBattle, dailyScore, themeById } from '../rules/daily';
import { DAILY_BATTLES, FINAL_ROUND, maxLives, runScore } from '../rules/run';
import { $ } from './dom';
import type { Session } from './session';

const HEART = '♥︎';

/** Round, lives, board size, side, record and best score. `round` lets the result screen keep showing the round just played. */
/** `color` is the player's colour in that round (the run may already have picked the next round's). */
export function renderHeader(session: Session, round = session.run.round, color = session.run.color): void {
  const { lives, record, settings } = session.run;
  const spec = session.boardOf(round);
  if (session.run.daily) {
    // The daily challenge: battle n of 5 and its theme instead of lives; the score so far (gold left counts at the end).
    $('#round').textContent = `Daily ${dailyBattle(round)}/${DAILY_BATTLES}`;
    const livesEl = $('#lives');
    livesEl.textContent = themeById(session.run.daily.theme).name;
    livesEl.setAttribute('aria-label', `Theme: ${livesEl.textContent}`);
    $('#board-size').textContent = `${spec.files}×${spec.ranks} · ${color === 'w' ? 'White' : 'Black'}`;
    $('#record').textContent = `${record.w}W ${record.l}L ${record.d}D`;
    $('#best').textContent = `Score ${dailyScore(record, 0)} + gold`;
    return;
  }
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
