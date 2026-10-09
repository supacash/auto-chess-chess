import { DEFAULT_SETTINGS, isDifficultyId, isSideId, type RunSettings } from '../rules/difficulty';
import { isModeId } from '../rules/mode';
import { $ } from './dom';

/** The New run window: board (game mode), difficulty, side and reveal. Runs start only from here. */
export class NewRunDialog {
  private readonly dialog = $<HTMLDialogElement>('#new-run-dialog');

  constructor(onStart: (settings: RunSettings) => void) {
    // Read the choice on submit rather than on the dialog's close event: submit fires right away,
    // while Chrome can hold back close until the page next renders (e.g. in a background tab).
    this.dialog.querySelector('form')?.addEventListener('submit', (e) => {
      if ((e.submitter as HTMLButtonElement | null)?.value !== 'start') return;
      const mode = this.dialog.querySelector<HTMLInputElement>('input[name="nr-mode"]:checked')?.value;
      const level = $<HTMLSelectElement>('#nr-difficulty').value;
      const side = $<HTMLSelectElement>('#nr-side').value;
      onStart({
        mode: isModeId(mode) ? mode : DEFAULT_SETTINGS.mode,
        difficulty: isDifficultyId(level) ? level : DEFAULT_SETTINGS.difficulty,
        reveal: $<HTMLInputElement>('#nr-reveal').checked,
        side: isSideId(side) ? side : DEFAULT_SETTINGS.side,
      });
    });
  }

  /** Opens preset to `current`; `warnAbandon` shows that starting ends the run in progress. */
  open(current: RunSettings, warnAbandon: boolean): void {
    for (const radio of this.dialog.querySelectorAll<HTMLInputElement>('input[name="nr-mode"]')) {
      radio.checked = radio.value === current.mode;
    }
    $<HTMLSelectElement>('#nr-difficulty').value = current.difficulty;
    $<HTMLInputElement>('#nr-reveal').checked = current.reveal;
    $<HTMLSelectElement>('#nr-side').value = current.side;
    $('#nr-warning').hidden = !warnAbandon;
    this.dialog.showModal();
  }
}
