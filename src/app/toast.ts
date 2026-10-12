import { $, escapeHtml } from './dom';

/** How long each notice stays up, and the pause before the next one. */
const SHOW_MS = 4500;
const GAP_MS = 250;

const queue: { title: string; detail: string }[] = [];
let showing = false;

/**
 * A short notice at the top of the screen (e.g. an achievement unlocked), gone after a few seconds.
 * Notices that arrive while one is up wait their turn, so two unlocked at once are both seen.
 */
export function showToast(title: string, detail = ''): void {
  queue.push({ title, detail });
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
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  window.setTimeout(() => {
    el.hidden = true;
    window.setTimeout(showNext, GAP_MS);
  }, SHOW_MS);
}
