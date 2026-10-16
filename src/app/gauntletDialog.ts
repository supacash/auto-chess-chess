import { dailyBattle, themeById } from '../rules/daily';
import { DAILY_BATTLES } from '../rules/run';
import { $, escapeHtml } from './dom';
import { miniBoard } from './scoutDialog';
import type { Session } from './session';

const RESULT_MARK = { w: '✓ Won', b: '✗ Lost', draw: '= Drawn' } as const;

/** The daily challenge's five armies, all of them, so the player can plan their spending. */
export class GauntletDialog {
  private readonly dialog = $<HTMLDialogElement>('#gauntlet-dialog');

  open(session: Session): void {
    const daily = session.run.daily;
    if (!daily) return;
    const theme = themeById(daily.theme);
    const current = dailyBattle(session.run.round);
    const played = session.run.history ?? [];
    const foe = session.run.color === 'w' ? 'b' : 'w';
    $('#gauntlet-status').textContent =
      `${theme.name}: ${theme.blurb}. Battle ${Math.min(current, DAILY_BATTLES)} of ${DAILY_BATTLES}.`;
    $('#gauntlet-body').innerHTML = session
      .gauntlet()
      .map((o, i) => {
        const battle = i + 1;
        const log = played[i];
        const state = log ? RESULT_MARK[log.winner] : battle === current ? '▶ Up now' : '';
        return `<section class="scout-section gauntlet-battle${battle === current ? ' current' : ''}"><h3>Battle ${battle} · ${escapeHtml(o.style.name)} · ${o.points} pts · ${o.board.files}×${o.board.ranks}${state ? ` · ${state}` : ''}</h3>${miniBoard(o.pieces, o.board, true, foe)}</section>`;
      })
      .join('');
    if (!this.dialog.open) this.dialog.showModal();
  }
}
