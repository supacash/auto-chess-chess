import { type MatchPerk, type MatchPerkId, matchPerk } from '../multi/perks';
import { $, escapeHtml } from './dom';

/** The match perk pick: one of three perks to keep for the rest of the match. */
export class PerkDialog {
  private readonly dialog = $<HTMLDialogElement>('#perk-dialog');
  private onPick: ((id: MatchPerkId) => void) | null = null;
  private choices: MatchPerkId[] = [];

  constructor() {
    this.dialog.querySelector('form')?.addEventListener('submit', (e) => {
      const value = (e.submitter as HTMLButtonElement | null)?.value;
      if (value) this.pick(value as MatchPerkId);
    });
    // A pick is required: Escape doesn't close it (time running out picks the first).
    this.dialog.addEventListener('cancel', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Opens with `choices`; `owned` lists the perks picked earlier in the match. */
  open(choices: MatchPerkId[], owned: MatchPerk[], onPick: (id: MatchPerkId) => void): void {
    this.onPick = onPick;
    this.choices = choices;
    $('#perk-choices').innerHTML = choices
      .map(matchPerk)
      .map(
        (p) =>
          `<button type="submit" value="${p.id}" class="big-choice">${p.icon} ${escapeHtml(p.name)}<small>${escapeHtml(p.description)}</small></button>`,
      )
      .join('');
    const kept = $('#perk-owned');
    kept.hidden = owned.length === 0;
    kept.textContent = owned.length ? `Your perks: ${owned.map((p) => `${p.icon} ${p.name}`).join(', ')}.` : '';
    if (!this.dialog.open) this.dialog.showModal();
  }

  /** Time's up: takes the first choice. */
  pickFirst(): void {
    if (this.dialog.open && this.choices.length) this.pick(this.choices[0]);
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private pick(id: MatchPerkId): void {
    const onPick = this.onPick;
    this.onPick = null;
    this.close();
    onPick?.(id);
  }
}
