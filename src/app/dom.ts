/** The element matching `selector`. The app's layout is fixed, so a missing element is a bug. */
export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element ${selector}`);
  return el;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A number of points: "1 pt", "5 pts". */
export function pts(n: number): string {
  return `${n} ${n === 1 ? 'pt' : 'pts'}`;
}

/** Escapes text for use inside HTML (e.g. names that came from other players). */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
