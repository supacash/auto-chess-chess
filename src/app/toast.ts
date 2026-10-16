import { $, escapeHtml } from './dom';

/** How long each notice stays up, and the pause before the next one. */
const SHOW_MS = 4500;
const GAP_MS = 250;

/** Gold for rewards (achievements, an extra life); teal for news about the run (the board grew). */
export type ToastTone = 'gold' | 'teal';

const queue: { title: string; detail: string; tone: ToastTone }[] = [];
let showing = false;
let timer = 0;

/**
 * A short notice at the top of the screen (e.g. an achievement unlocked), gone after a few seconds.
 * Notices that arrive while one is up wait their turn, so two unlocked at once are both seen.
 */
export function showToast(title: string, detail = '', tone: ToastTone = 'gold'): void {
  queue.push({ title, detail, tone });
  if (!showing) showNext();
}

function showNext(): void {
  const next = queue.shift();
  const el = $('#toast');
  if (!next) {
    showing = false;
    el.hidden = true;
    return;
  }
  showing = true;
  el.innerHTML = `<strong>${escapeHtml(next.title)}</strong>${next.detail ? `<span>${escapeHtml(next.detail)}</span>` : ''}`;
  el.dataset.tone = next.tone;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  // A tap clears it early: it sits over the run bar and Menu.
  el.onclick = dismiss;
  timer = window.setTimeout(dismiss, SHOW_MS);
}

/** Hides the notice on screen, then shows the next one waiting. */
function dismiss(): void {
  clearTimeout(timer);
  $('#toast').hidden = true;
  window.setTimeout(showNext, GAP_MS);
}
