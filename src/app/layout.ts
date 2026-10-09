import { DIFFICULTIES } from '../rules/difficulty';
import { PAWN_COST } from '../rules/economy';
import { MODES } from '../rules/mode';

/** Playback speeds offered during a battle. */
export const SPEEDS = [1, 2, 4];

/** Renders the page shell: header, placement and battle screens, the New run window and credits. */
export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
  <header>
    <h1>Auto Chess Chess</h1>
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
      Place your king and any other pieces in your home rows (the lit squares), spend gold on pawns and upgrades, then press
      <strong>Fight</strong>. The engine plays both sides. Lose a round and you lose a life.
    </p>
    <p class="notice" id="notice" role="status" hidden></p>
    <p class="opponent" id="opponent"></p>
    <div id="board-root"></div>
    <div class="shop">
      <div class="shop-row">
        <span class="gold" id="gold" aria-label="Gold"></span>
        <button id="buy-pawn" type="button">Buy pawn · ${PAWN_COST}g</button>
      </div>
      <div class="piece-actions" id="piece-actions"></div>
    </div>
    <p id="message" role="status" aria-live="polite"></p>
    <div class="actions">
      <button id="clear" type="button">Clear board</button>
      <button id="fight" type="button" class="primary" disabled>Fight</button>
    </div>
    <p class="hint" id="points"></p>
  </section>

  <section id="battle" hidden>
    <p class="battle-status" id="battle-status" aria-live="polite"></p>
    <div class="eval">
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
    <div class="result" id="result" hidden>
      <h2 id="result-title"></h2>
      <p id="result-detail"></p>
      <button type="button" id="next" class="primary">Next round</button>
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
    Game code: <a href="https://github.com/supacash/auto-chess-chess" target="_blank" rel="noopener">MIT</a>.
  </footer>`;
}
