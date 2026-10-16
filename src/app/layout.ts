import { USE_FAIRY } from '../engine/engineChoice';
import { DIFFICULTIES, SIDES } from '../rules/difficulty';
import { START_HP } from '../multi/match';
import { REROLL_COST } from '../rules/economy';
import { MODES } from '../rules/mode';
import { SPEEDS, VOLUME_MAX, VOLUME_MIN, VOLUME_STEP } from './settings';

/** The credits' engine line (Settings, About). A `fairy` build ships Fairy-Stockfish, which is GPLv3: credit it and link its source. */
const ENGINE_CREDIT = USE_FAIRY
  ? `Chess engine: <a href="https://github.com/fairy-stockfish/Fairy-Stockfish" target="_blank" rel="noopener">Fairy-Stockfish</a>
    via <a href="https://github.com/fairy-stockfish/fairy-stockfish.wasm" target="_blank" rel="noopener">fairy-stockfish.wasm</a>,
    licensed under the <a href="fairy/GPL-3.0.txt" target="_blank" rel="noopener">GPLv3</a> (source at that link).`
  : 'Chess engine: our own, written for the game.';

/** Renders the page shell: header, menu, Settings, placement and battle screens, and the dialogs. */
export function renderLayout(root: HTMLElement): void {
  root.innerHTML = `
  <header>
    <h1><img class="logo" src="${import.meta.env.BASE_URL}logo.svg" alt="" width="28" height="28" /><span>Pawned Up</span></h1>
    <div class="header-actions">
      <button id="menu-button" type="button" class="link">Menu</button>
    </div>
  </header>
  <section id="menu" class="menu" hidden>
    <div class="menu-drift" id="menu-drift" aria-hidden="true"></div>
    <button type="button" id="sound-toggle" class="icon-button menu-corner" aria-pressed="true"></button>
    <img class="menu-logo" src="${import.meta.env.BASE_URL}logo.svg" alt="" width="148" height="148" />
    <h2 class="menu-title">Pawned Up</h2>
    <p class="menu-badge">Chess Auto Battler</p>
    <p class="menu-notice" id="menu-notice" hidden></p>
    <div class="menu-buttons">
      <button type="button" id="menu-resume" class="primary">
        Resume game<small id="menu-resume-detail"></small>
      </button>
      <button type="button" id="menu-rejoin" class="primary" hidden>
        Rejoin match<small id="menu-rejoin-detail"></small>
      </button>
      <button type="button" id="menu-new" class="teal">New game</button>
      <button type="button" id="menu-multiplayer">Multiplayer</button>
      <button type="button" id="menu-profile">Profile</button>
      <button type="button" id="menu-settings">Settings</button>
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
  <!-- The run's line, beside Menu: round and lives, then the board, side, record and best. -->
  <div class="run-bar">
    <span id="round"></span>
    <span class="lives" id="lives"></span>
    <span class="run-meta"><span id="board-size"></span><span id="record"></span><span id="best"></span></span>
  </div>

  <section id="placement">
    <!-- The screen's two columns in landscape (style.css); in portrait the wrappers don't render. -->
    <div class="screen-top">
      <div class="tip" id="tip" role="status" hidden>
        <span class="tip-icon" aria-hidden="true">💡</span><span id="tip-text"></span>
        <button type="button" id="tip-close" class="tip-close" aria-label="Dismiss tip">×</button>
      </div>
      <p class="opponent" id="opponent"></p>
      <p class="opponent-info" id="opponent-info" role="status" hidden></p>
    </div>
    <div id="board-root"></div>
    <div class="screen-side">
      <div class="shop">
        <div class="shop-row">
          <span class="gold" id="gold" aria-label="Gold"></span>
          <button id="lock" type="button" class="lock" aria-pressed="false" title="Lock the shop: keep these offers for next round">🔓</button>
          <button id="reroll" type="button">Reroll · ${REROLL_COST}g</button>
        </div>
        <div class="offers" id="offers"></div>
        <!-- The selected offer, how it moves and Buy. -->
        <div class="offer-detail panel" id="offer-detail" hidden></div>
        <!-- A selected piece's merges, upgrades and Sell take the offers' place until it's put down. -->
        <div class="piece-actions panel" id="piece-actions" hidden></div>
      </div>
      <!-- Pinned to the bottom of the screen: what went wrong (or the time left in a match), then the fight buttons. -->
      <div class="fight-bar">
        <p id="message" role="status" aria-live="polite"></p>
        <!-- In a match: the shop's time left, in reach wherever the screen is scrolled. -->
        <div class="fight-timer" id="fight-timer" hidden>
          <span class="fight-timer-bar"><span id="fight-timer-fill"></span></span><span id="fight-timer-text"></span>
        </div>
        <div class="actions">
          <button id="clear" type="button">Clear</button>
          <button id="play" type="button" disabled>Play it</button>
          <button id="fight" type="button" class="primary" disabled>Auto fight</button>
        </div>
        <p class="fight-hint" id="fight-hint" hidden></p>
      </div>
      <p class="hint" id="points"></p>
      <button type="button" id="last-replay" class="link-button" hidden>Review your last battle</button>
    </div>
  </section>

  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>

  <section id="profile" class="profile" hidden>
    <div class="profile-head">
      <img class="profile-logo" src="${import.meta.env.BASE_URL}logo.svg" alt="" width="52" height="52" />
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

  <section id="settings" class="settings" hidden aria-labelledby="settings-title">
    <h2 class="screen-title" id="settings-title">Settings</h2>
    <div class="settings-body">
      <div class="record-card settings-card">
        <h3>Sound</h3>
        <label class="setting-row">
          <span>Sound effects</span>
          <input type="checkbox" role="switch" id="set-sound" class="switch" />
        </label>
        <label class="setting-row setting-slider">
          <span>Effects volume <output id="set-volume-value" for="set-volume"></output></span>
          <input type="range" id="set-volume" min="${VOLUME_MIN}" max="${VOLUME_MAX}" step="${VOLUME_STEP}" />
        </label>
      </div>
      <div class="record-card settings-card">
        <h3>Battles</h3>
        <div class="setting-row">
          <span id="set-speed-label">Start battles at</span>
          <div class="speeds" id="set-speed" role="radiogroup" aria-labelledby="set-speed-label">
            ${SPEEDS.map((s) => `<button type="button" class="speed" role="radio" data-speed="${s}">${s}×</button>`).join('')}
          </div>
        </div>
        <label class="setting-row">
          <span>Reduce motion<small>Fewer animations. Always on when your device asks for it.</small></span>
          <input type="checkbox" role="switch" id="set-motion" class="switch" />
        </label>
        <div class="setting-row">
          <span>Tips<small id="set-tips-note">Show the first-game tips again.</small></span>
          <button type="button" id="set-tips">Show again</button>
        </div>
      </div>
      <div class="record-card settings-card about">
        <h3>About</h3>
        <p>${ENGINE_CREDIT}</p>
        <p>Pieces: Chessnut by Alexis Luengas (<a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache 2.0</a>).</p>
        <p>Game code: <a href="https://github.com/supacash/auto-chess-chess" target="_blank" rel="noopener">MIT</a>.</p>
        <p><a href="${import.meta.env.BASE_URL}privacy.html" target="_blank" rel="noopener" id="privacy-link">Privacy policy</a></p>
      </div>
    </div>
    <div class="actions">
      <button type="button" id="settings-back" class="primary">Back to menu</button>
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
    <div class="screen-top">
      <p class="battle-status" id="battle-status" aria-live="polite"></p>
      <p class="battle-announce" id="battle-announce" role="status" hidden></p>
      <div class="eval" id="eval">
        <div class="eval-bar" id="eval-bar" role="meter" aria-label="Engine evaluation" aria-valuemin="0" aria-valuemax="100">
          <div class="eval-fill" id="eval-fill"></div>
        </div>
        <span class="eval-label" id="eval-label"></span>
      </div>
      <div class="side-pieces" id="side-them" hidden></div>
    </div>
    <div id="battle-root"></div>
    <div class="screen-side">
      <div class="side-pieces" id="side-you" hidden></div>
      <div class="actions" id="playback">
        <div class="speeds" role="group" aria-label="Playback speed">
          ${SPEEDS.map((s) => `<button type="button" class="speed" data-speed="${s}">${s}×</button>`).join('')}
        </div>
        <button type="button" id="skip">Skip ⏭</button>
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
        <div class="confetti" id="confetti" aria-hidden="true"></div>
        <h2 id="result-title"></h2>
        <p id="result-detail"></p>
        <div class="result-stats" id="result-stats" hidden></div>
        <p class="result-awards" id="result-awards" hidden></p>
        <div class="run-summary" id="run-summary" hidden></div>
        <div class="actions result-actions">
          <button type="button" id="replay">Review</button>
          <button type="button" id="next" class="primary">Next round</button>
        </div>
        <button type="button" id="revive" class="revive-button" hidden>▶ Watch an ad for an extra life</button>
        <div class="card-extras" id="card-extras" hidden></div>
        <button type="button" id="prestige" class="prestige-button" hidden></button>
      </div>
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
      <fieldset class="room-rules">
        <legend>Rules</legend>
        <div class="room-rules-box">
          <label class="check"><input type="checkbox" id="mp-growing" /> Growing board: 5×5 up to 9×9</label>
          <label class="check"><input type="checkbox" id="mp-fairy" /> Fairy pieces and fusion</label>
          <label class="check"><input type="checkbox" id="mp-blitz" /> Blitz: 20-second shop</label>
        </div>
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
  </dialog>`;
}
