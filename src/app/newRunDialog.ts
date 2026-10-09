import { DEFAULT_SETTINGS, isDifficultyId, type RunSettings } from '../rules/difficulty';
import { isModeId } from '../rules/mode';
import { $ } from './dom';

/** The New run window: board (game mode), difficulty and reveal. Runs start only from here. */
export class NewRunDialog {
  private readonly dialog = $<HTMLDialogElement>('#new-run-dialog');

  constructor(onStart: (settings: RunSettings) => void) {
    this.dialog.addEventListener('close', () => {
      if (this.dialog.returnValue !== 'start') return;
      const mode = this.dialog.querySelector<HTMLInputElement>('input[name="nr-mode"]:checked')?.value;
      const level = $<HTMLSelectElement>('#nr-difficulty').value;
      onStart({
        mode: isModeId(mode) ? mode : DEFAULT_SETTINGS.mode,
        difficulty: isDifficultyId(level) ? level : DEFAULT_SETTINGS.difficulty,
        reveal: $<HTMLInputElement>('#nr-reveal').checked,
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
    $('#nr-warning').hidden = !warnAbandon;
    this.dialog.returnValue = '';
    this.dialog.showModal();
  }
}
