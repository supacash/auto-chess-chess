import { $, escapeHtml } from './dom';

let timer = 0;

/** A short notice at the top of the screen (e.g. an achievement unlocked), gone after a few seconds. */
export function showToast(title: string, detail = ''): void {
  const el = $('#toast');
  el.innerHTML = `<strong>${escapeHtml(title)}</strong>${detail ? `<span>${escapeHtml(detail)}</span>` : ''}`;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth; // restart the animation
  el.classList.add('show');
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    el.hidden = true;
  }, 4500);
}
