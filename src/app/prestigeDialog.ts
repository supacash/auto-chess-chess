import type { Perk, PerkId } from '../rules/prestige';
import { $, escapeHtml } from './dom';

/** The Prestige window: pick one of three perks to keep, and the next prestige level starts. */
export class PrestigeDialog {
  private readonly dialog = $<HTMLDialogElement>('#prestige-dialog');
  private onPick: ((id: PerkId) => void) | null = null;

  constructor() {
    this.dialog.querySelector('form')?.addEventListener('submit', (e) => {
      const value = (e.submitter as HTMLButtonElement | null)?.value;
      if (!value || value === 'cancel') return;
      this.onPick?.(value as PerkId);
    });
  }

  /** Opens for prestige level `level`, offering `choices`; `owned` lists the perks kept so far. */
  open(level: number, choices: Perk[], owned: Perk[], onPick: (id: PerkId) => void): void {
    this.onPick = onPick;
    $('#prestige-title').textContent = `Prestige ★${level}`;
    $('#prestige-intro').textContent =
      `Start again from round 1 against tougher opponents (they grow a little faster with each prestige). Pick a perk to keep for good.`;
    $('#prestige-choices').innerHTML = choices
      .map(
        (p) =>
          `<button type="submit" value="${p.id}" class="big-choice">${escapeHtml(p.name)}<small>${escapeHtml(p.description)}</small></button>`,
      )
      .join('');
    const kept = $('#prestige-owned');
    kept.hidden = owned.length === 0;
    kept.textContent = owned.length ? `Kept so far: ${owned.map((p) => p.name).join(', ')}.` : '';
    this.dialog.showModal();
  }
}
