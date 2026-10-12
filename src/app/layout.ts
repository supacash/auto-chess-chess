import { DIFFICULTIES, SIDES } from '../rules/difficulty';
import { START_HP } from '../multi/match';
import { REROLL_COST } from '../rules/economy';
import { MODES } from '../rules/mode';

/** Playback speeds offered during a battle. */
export const SPEEDS = [1, 2, 4];

/** Renders the page shell: header, placement and battle screens, the New run window and credits. */
export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
  <header>
    <h1><img class="logo" src="${import.meta.env.BASE_URL}icon.svg" alt="" width="28" height="28" /><span>Auto Chess<sup>2</sup></span></h1>
    <div class="header-actions">
      <button id="menu-button" type="button" class="link">Menu</button>
    </div>
  </header>
  <section id="menu" class="menu" hidden>
    <img class="menu-logo" src="${import.meta.env.BASE_URL}icon.svg" alt="" width="104" height="104" />
    <h2 class="menu-title">Auto Chess<sup>2</sup></h2>
    <p class="menu-tagline">Draft an army, place it, and let the engine fight it out.</p>
    <p class="menu-notice" id="menu-notice" hidden></p>
    <div class="menu-buttons">
      <button type="button" id="menu-resume" class="primary">
        Resume game<small id="menu-resume-detail"></small>
      </button>
      <button type="button" id="menu-rejoin" class="primary" hidden>
        Rejoin match<small id="menu-rejoin-detail"></small>
      </button>
      <button type="button" id="menu-new">New game</button>
      <button type="button" id="menu-multiplayer">Multiplayer</button>
      <button type="button" id="menu-profile">Profile</button>
    </div>
    <button type="button" id="menu-replay" class="link-button" hidden>Review your last battle</button>
  </section>
  <section id="match-hud" class="match-hud" hidden>
    <div class="match-top">
      <span id="match-round"></span>
      <span class="match-top-right">
        <span id="match-timer" class="match-timer"></span>
        <button type="button" id="match-leave" class="leave-button">Leave</button>
      </span>
    </div>
    <div class="timer-bar"><div id="timer-fill"></div></div>
    <ol id="match-players" class="match-players"></ol>
  </section>
  <div class="run-bar">
    <span id="round"></span>
    <span class="lives" id="lives"></span>
    <span id="record"></span>
    <span id="best"></span>
  </div>

  <section id="placement">
    <div class="tip" id="tip" role="status" hidden>
      <span class="tip-icon" aria-hidden="true">💡</span><span id="tip-text"></span>
      <button type="button" id="tip-close" class="tip-close" aria-label="Dismiss tip">×</button>
    </div>
    <p class="notice" id="notice" role="status" hidden></p>
    <p class="opponent" id="opponent"></p>
    <p class="opponent-info" id="opponent-info" role="status" hidden></p>
    <div id="board-root"></div>
    <div class="shop">
      <div class="shop-row">
        <span class="gold" id="gold" aria-label="Gold"></span>
        <button id="lock" type="button" class="lock" aria-pressed="false" title="Lock the shop: keep these offers for next round">🔓</button>
        <button id="reroll" type="button">Reroll · ${REROLL_COST}g</button>
      </div>
      <div class="offers" id="offers"></div>
      <div class="offer-detail" id="offer-detail" hidden></div>
      <div class="piece-actions" id="piece-actions"></div>
    </div>
    <p id="message" role="status" aria-live="polite"></p>
    <div class="fight-bar">
      <div class="actions">
        <button id="clear" type="button">Clear</button>
        <button id="play" type="button" disabled>Play it</button>
        <button id="fight" type="button" class="primary" disabled>Auto fight</button>
      </div>
      <p class="fight-hint" id="fight-hint" hidden></p>
    </div>
    <p class="hint" id="points"></p>
    <button type="button" id="last-replay" class="link-button" hidden>Review your last battle</button>
  </section>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>

  <section id="profile" class="profile" hidden>
    <div class="profile-head">
      <img class="profile-logo" src="${import.meta.env.BASE_URL}icon.svg" alt="" width="52" height="52" />
      <div>
        <p class="profile-name"><span id="profile-name"></span>
          <button type="button" id="profile-rename" class="leave-button" title="Pick a new random name">New name</button>
        </p>
        <p class="dialog-text muted">Your records are saved on this device.</p>
      </div>
    </div>
    <div class="tabs" id="profile-tabs" role="tablist">
      <button type="button" role="tab" data-tab="single">Single</button>
      <button type="button" role="tab" data-tab="multi">Multiplayer</button>
      <button type="button" role="tab" data-tab="history">History</button>
      <button type="button" role="tab" data-tab="fun">Fun</button>
      <button type="button" role="tab" data-tab="achievements">Awards</button>
    </div>
    <div id="profile-body" class="profile-body"></div>
    <div class="actions">
      <button type="button" id="profile-back" class="primary">Back to menu</button>
    </div>
  </section>

  <section id="lobby" class="lobby" hidden>
    <p class="lobby-label" id="lobby-label">Room code</p>
    <p class="lobby-code" id="lobby-code"></p>
    <p class="lobby-rules" id="lobby-rules"></p>
    <p class="dialog-text muted" id="lobby-status"></p>
    <ol class="lobby-seats" id="lobby-seats"></ol>
    <p class="dialog-text error" id="lobby-message"></p>
    <div class="actions">
      <button type="button" id="lobby-leave">Leave</button>
      <button type="button" id="lobby-start" class="primary">Start match</button>
    </div>
  </section>

  <section id="battle" hidden>
    <p class="battle-status" id="battle-status" aria-live="polite"></p>
    <p class="battle-announce" id="battle-announce" role="status" hidden></p>
    <div class="eval" id="eval">
      <div class="eval-bar" id="eval-bar" role="meter" aria-label="Engine evaluation" aria-valuemin="0" aria-valuemax="100">
        <div class="eval-fill" id="eval-fill"></div>
      </div>
      <span class="eval-label" id="eval-label"></span>
    </div>
    <div class="side-pieces" id="side-them" hidden></div>
    <div id="battle-root"></div>
    <div class="side-pieces" id="side-you" hidden></div>
    <div class="actions" id="playback">
      ${SPEEDS.map((s) => `<button type="button" class="speed" data-speed="${s}">${s}×</button>`).join('')}
      <button type="button" id="skip">Skip</button>
    </div>
    <div class="promo" id="promo" hidden></div>
    <div class="actions" id="manual" hidden>
      <button type="button" id="undo">Undo</button>
      <button type="button" id="resign" class="sell">Resign</button>
    </div>
    <div class="review" id="review" hidden>
      <input type="range" id="review-slider" min="0" max="0" value="0" aria-label="Move" />
      <div class="actions review-buttons">
        <button type="button" data-step="first" aria-label="First move">⏮</button>
        <button type="button" data-step="prev" aria-label="Previous move">◀</button>
        <button type="button" data-step="play" id="review-play" aria-label="Play">▶︎ Play</button>
        <button type="button" data-step="next" aria-label="Next move">▶</button>
        <button type="button" data-step="last" aria-label="Last move">⏭</button>
      </div>
    </div>
    <div class="actions" id="replay-actions">
      <button type="button" id="replay-done" class="primary" hidden>Done</button>
    </div>
    <div class="result" id="result" hidden>
      <h2 id="result-title"></h2>
      <p id="result-detail"></p>
      <div class="run-summary" id="run-summary" hidden></div>
      <div class="actions result-actions">
        <button type="button" id="replay">Review</button>
        <button type="button" id="next" class="primary">Next round</button>
      </div>
      <button type="button" id="revive" class="revive-button" hidden>▶ Watch an ad for an extra life</button>
      <div class="card-extras" id="card-extras" hidden></div>
      <button type="button" id="prestige" class="prestige-button" hidden></button>
    </div>
  </section>

  <dialog id="match-dialog" aria-labelledby="match-title">
    <form method="dialog" class="new-run-form">
      <h2 id="match-title">Multiplayer</h2>
      <p class="dialog-text">
        Four players, ${START_HP} HP each. Everyone shops at the same time, then the engine plays the battles. Last one
        standing wins.
      </p>
      <details class="rules">
        <summary>How it works</summary>
        <p class="dialog-text muted">
          Auto battles, on Classic 8×8 with standard pieces unless you pick Growing board or Fairy
          pieces. The shop lasts 45 seconds (or until everyone is ready). Losing a battle costs the round
          number plus 1 HP per 5 points the winner has left. Quick play matches you with anyone looking for a
          game with the same rules; empty seats get bots after 30 seconds.
        </p>
      </details>
      <label class="check"><input type="checkbox" id="mp-blitz" /> Blitz: 20-second shop</label>
      <fieldset class="room-rules">
        <legend>Rules</legend>
        <label class="check"><input type="checkbox" id="mp-growing" /> Growing board: 5×5 up to 9×9</label>
        <label class="check"><input type="checkbox" id="mp-fairy" /> Fairy pieces and fusion</label>
      </fieldset>
      <button type="submit" value="quick" class="primary big-choice">
        Quick play<small>Play with anyone looking for a game</small>
      </button>
      <div class="actions">
        <button type="submit" value="create">Create room</button>
        <button type="submit" value="bots">Play vs bots</button>
      </div>
      <div class="join-row">
        <input id="mp-code" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="4"
          placeholder="Room code" aria-label="Room code" />
        <button type="submit" value="join">Join room</button>
      </div>
      <p class="dialog-text error" id="mp-error"></p>
      <button type="submit" value="cancel" class="link-button" formnovalidate>Cancel</button>
    </form>
  </dialog>

  <dialog id="scout-dialog" aria-labelledby="scout-title">
    <form method="dialog" class="new-run-form scout">
      <h2 id="scout-title"></h2>
      <p class="dialog-text muted" id="scout-status"></p>
      <div id="scout-body"></div>
      <button type="submit" value="close" class="primary">Close</button>
    </form>
  </dialog>

  <dialog id="perk-dialog" aria-labelledby="perk-title">
    <form method="dialog" class="new-run-form">
      <h2 id="perk-title">Pick a perk</h2>
      <p class="dialog-text">Keep one for the rest of the match. The shop timer keeps running.</p>
      <div class="prestige-choices" id="perk-choices"></div>
      <p class="dialog-text muted" id="perk-owned" hidden></p>
    </form>
  </dialog>

  <dialog id="prestige-dialog" aria-labelledby="prestige-title">
    <form method="dialog" class="new-run-form">
      <h2 id="prestige-title">Prestige</h2>
      <p class="dialog-text" id="prestige-intro"></p>
      <div class="prestige-choices" id="prestige-choices"></div>
      <p class="dialog-text muted" id="prestige-owned" hidden></p>
      <button type="submit" value="cancel" class="link-button" formnovalidate>Not now</button>
    </form>
  </dialog>

  <dialog id="new-run-dialog" aria-labelledby="new-run-title">
    <form method="dialog" class="new-run-form">
      <h2 id="new-run-title">New game</h2>
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
          ${DIFFICULTIES.map((d) => `<option value="${d.id}">${d.name}: ${d.blurb}</option>`).join('')}
        </select>
      </label>
      <label class="field">Play as
        <select id="nr-side">
          ${SIDES.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}
        </select>
      </label>
      <label class="check"><input type="checkbox" id="nr-fairy" /> Fairy pieces</label>
      <label class="check"><input type="checkbox" id="nr-reveal" /> Reveal opponent's setup (easier)</label>
      <label class="check"><input type="checkbox" id="nr-manual" /> Play yourself (harder)</label>
      <p class="warning" id="nr-warning" hidden>Starting a new game abandons the one in progress.</p>
      <div class="actions">
        <button type="submit" value="cancel" formnovalidate>Cancel</button>
        <button type="submit" value="start" class="primary">Start game</button>
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
