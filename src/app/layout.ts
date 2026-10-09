import { DIFFICULTIES, SIDES } from '../rules/difficulty';
import { REROLL_COST } from '../rules/economy';
import { MODES } from '../rules/mode';

/** Playback speeds offered during a battle. */
export const SPEEDS = [1, 2, 4];

/** Renders the page shell: header, placement and battle screens, the New run window and credits. */
export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
  <header>
    <h1><img class="logo" src="${import.meta.env.BASE_URL}icon.svg" alt="" width="28" height="28" />Auto Chess Chess</h1>
    <button id="new-run" type="button" class="link">New run</button>
  </header>
  <div class="run-bar">
    <span id="round"></span>
    <span class="lives" id="lives"></span>
    <span id="record"></span>
    <span id="best"></span>
  </div>

  <section id="placement">
    <p class="help" id="help">
      Place your king and any other pieces in your home rows (the lit squares), buy pieces from the shop, upgrade or fuse them, then press
      <strong>Auto fight</strong> to let the engine play both sides, or <strong>Play it</strong> to move your own pieces. Lose a round and you lose a life.
    </p>
    <p class="notice" id="notice" role="status" hidden></p>
    <p class="opponent" id="opponent"></p>
    <p class="opponent-info" id="opponent-info" role="status" hidden></p>
    <div id="board-root"></div>
    <div class="shop">
      <div class="shop-row">
        <span class="gold" id="gold" aria-label="Gold"></span>
        <span class="offers-label">For sale</span>
        <button id="reroll" type="button">Reroll · ${REROLL_COST}g</button>
      </div>
      <div class="offers" id="offers"></div>
      <div class="offer-detail" id="offer-detail" hidden></div>
      <div class="piece-actions" id="piece-actions"></div>
    </div>
    <p id="message" role="status" aria-live="polite"></p>
    <div class="actions">
      <button id="clear" type="button">Clear</button>
      <button id="play" type="button" disabled>Play it</button>
      <button id="fight" type="button" class="primary" disabled>Auto fight</button>
    </div>
    <p class="fight-hint" id="fight-hint" hidden></p>
    <p class="hint" id="points"></p>
    <button type="button" id="last-replay" class="link-button" hidden>Watch your last battle</button>
  </section>

  <section id="battle" hidden>
    <p class="battle-status" id="battle-status" aria-live="polite"></p>
    <div class="eval" id="eval">
      <div class="eval-bar" id="eval-bar" role="meter" aria-label="Engine evaluation" aria-valuemin="0" aria-valuemax="100">
        <div class="eval-fill" id="eval-fill"></div>
      </div>
      <span class="eval-label" id="eval-label"></span>
    </div>
    <div id="battle-root"></div>
    <div class="actions" id="playback">
      ${SPEEDS.map((s) => `<button type="button" class="speed" data-speed="${s}">${s}×</button>`).join('')}
      <button type="button" id="skip">Skip</button>
    </div>
    <div class="promo" id="promo" hidden></div>
    <div class="actions" id="manual" hidden>
      <button type="button" id="undo">Undo</button>
      <button type="button" id="resign" class="sell">Resign</button>
    </div>
    <div class="actions" id="replay-actions">
      <button type="button" id="replay-done" class="primary" hidden>Done</button>
    </div>
    <div class="result" id="result" hidden>
      <h2 id="result-title"></h2>
      <p id="result-detail"></p>
      <div class="actions result-actions">
        <button type="button" id="replay">Watch replay</button>
        <button type="button" id="next" class="primary">Next round</button>
      </div>
    </div>
  </section>

  <dialog id="new-run-dialog" aria-labelledby="new-run-title">
    <form method="dialog" class="new-run-form">
      <h2 id="new-run-title">New run</h2>
      <fieldset>
        <legend>Board</legend>
        ${MODES.map(
          (m) => `<label class="choice">
            <input type="radio" name="nr-mode" value="${m.id}" />
            <span><strong>${m.name}</strong><small>${m.description}</small></span>
          </label>`,
        ).join('')}
      </fieldset>
      <label class="field">Difficulty
        <select id="nr-difficulty">
          ${DIFFICULTIES.map((d) => `<option value="${d.id}">${d.name} (+${d.perRound} AI pts/round)</option>`).join('')}
        </select>
      </label>
      <label class="field">Play as
        <select id="nr-side">
          ${SIDES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </label>
      <label class="check"><input type="checkbox" id="nr-fairy" /> Fairy pieces: new pieces and fusion in the shop and in opponents' armies</label>
      <label class="check"><input type="checkbox" id="nr-reveal" /> Reveal the opponent's placement (easier)</label>
      <p class="warning" id="nr-warning" hidden>Starting a new run abandons the one in progress.</p>
      <div class="actions">
        <button type="submit" value="cancel" formnovalidate>Cancel</button>
        <button type="submit" value="start" class="primary">Start run</button>
      </div>
    </form>
  </dialog>

  <footer class="credits">
    Chess engine: <a href="https://github.com/fairy-stockfish/Fairy-Stockfish" target="_blank" rel="noopener">Fairy-Stockfish</a>
    via <a href="https://github.com/fairy-stockfish/fairy-stockfish.wasm" target="_blank" rel="noopener">fairy-stockfish.wasm</a>
    and <a href="https://github.com/fairy-stockfish/Fairy-Stockfish/tree/master/src/ffishjs" target="_blank" rel="noopener">ffish.js</a>,
    licensed under the <a href="fairy/GPL-3.0.txt" target="_blank" rel="noopener">GPLv3</a> (source at those links).
    Pieces: Chessnut by Alexis Luengas (<a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache 2.0</a>).
    Game code: <a href="https://github.com/supacash/auto-chess-chess" target="_blank" rel="noopener">MIT</a>.
  </footer>`;
}
