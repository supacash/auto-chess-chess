import { difficulty } from '../rules/difficulty';
import { runScore, START_LIVES } from '../rules/run';
import { $ } from './dom';
import type { Session } from './session';

const HEART = '♥︎';

/** Round, board size, lives, record and best score. `round` lets the result screen keep showing the round just played. */
/** `color` is the player's colour in that round (the run may already have picked the next round's). */
export function renderHeader(session: Session, round = session.run.round, color = session.run.color): void {
  const { lives, record, settings } = session.run;
  const spec = session.boardOf(round);
  $('#round').textContent = `Round ${round} · ${spec.files}×${spec.ranks} · ${color === 'w' ? 'White' : 'Black'}`;
  const livesEl = $('#lives');
  livesEl.innerHTML = Array.from(
    { length: START_LIVES },
    (_, i) => `<span class="heart ${i < lives ? 'full' : 'empty'}">${HEART}</span>`,
  ).join('');
  livesEl.setAttribute('aria-label', `${lives} of ${START_LIVES} lives`);
  $('#record').textContent = `${record.w}W ${record.l}L ${record.d}D`;
  const level = difficulty(settings.difficulty);
  $('#best').textContent =
    `Best ${Math.max(session.best, runScore(session.run))}${level.id === 'normal' ? '' : ` (${level.name})`}`;
  $('#help').hidden = record.w + record.l + record.d > 0;
}
