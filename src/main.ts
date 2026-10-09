import './style.css';
import { type BoardSpec, homeSquares, pawnSquares, plyLimit } from './chess/boardSpec';
import { loadRules } from './chess/loadRules';
import { checkmateEval, evalShare, formatEval } from './engine/pick';
import { Engine } from './engine/stockfish';
import { runBattle } from './game/runBattle';
import { clearGame, loadBest, loadGame, SAVE_VERSION, saveBest, saveGame } from './game/storage';
import { AI_STYLES, type AiStyle, aiBudget, draftAiArmy, pickStyle, placeAiArmy } from './rules/aiArmy';
import { type BattleResult, type EndReason, material } from './rules/battle';
import { DEFAULT_SETTINGS, DIFFICULTIES, difficulty, isDifficultyId, type RunSettings } from './rules/difficulty';
import {
  buyPawn,
  PAWN_COST,
  roundIncome,
  sellPiece,
  sellValue,
  type ShopResult,
  UPGRADES,
  upgradeCost,
  upgradePiece,
} from './rules/economy';
import { MAX_ARMY, type Piece, type PieceType, PIECE_NAME, PIECE_VALUE } from './rules/pieces';
import { armyErrors, fitToBoard } from './rules/placement';
import { type StartPosition, startPosition } from './rules/position';
import { gameMode, isModeId, MODES } from './rules/mode';
import { applyResult, hasStarted, isRunOver, newRun, nextRound, type Run, runScore, START_LIVES } from './rules/run';
import { BattleView } from './ui/battleView';
import { inlineGlyph } from './ui/boardDom';
import { PlacementBoard } from './ui/board';

/** Base playback time per move at 1× speed. */
const MOVE_MS = 400;
const SPEEDS = [1, 2, 4];
const PIECE_ORDER: PieceType[] = ['K', 'Q', 'R', 'B', 'N', 'P'];
const HEART = '♥︎';
const rng = Math.random;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const REASON_TEXT: Record<EndReason, string> = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  repetition: 'by threefold repetition',
  insufficient: 'by insufficient material',
  'fifty-move': 'by the 50-move rule',
  'move-limit': 'on points',
  decisive: 'by a decisive material lead',
};

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
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

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const placementEl = $('#placement');
const battleEl = $('#battle');
const messageEl = $('#message');
const fightBtn = $<HTMLButtonElement>('#fight');
const battleStatusEl = $('#battle-status');
const evalBarEl = $('#eval-bar');
const evalFillEl = $('#eval-fill');
const evalLabelEl = $('#eval-label');
const resultEl = $('#result');

const state = {
  run: newRun() as Run,
  best: loadBest(),
  selected: null as string | null,
  aiPieces: [] as Piece[],
  aiStyle: AI_STYLES[0] as AiStyle,
  engine: null as Engine | null,
  speed: 1,
  skipping: false,
  busy: false,
  /** Variant of the board last shown in placement, to announce when it grows. */
  shownBoard: null as string | null,
  /** No saved run on load: offer the New run window so players see the modes. */
  firstVisit: false,
};

// ---- persistence ----

/** `battleInProgress` marks a battle as started, so leaving mid-battle counts as a loss on the next load. */
function persist(battleInProgress = false): void {
  saveGame({
    version: SAVE_VERSION,
    run: state.run,
    ai: { styleId: state.aiStyle.id, pieces: state.aiPieces },
    ...(battleInProgress ? { battleInProgress: true } : {}),
  });
}

/** Resumes a saved run, or starts a new one. Returns a notice to show if a battle was abandoned. */
function restoreOrStart(): string {
  const saved = loadGame();
  const style = saved && AI_STYLES.find((s) => s.id === saved.ai.styleId);
  if (!saved || !style) {
    state.run = newRun();
    draftOpponent();
    state.best = bestFor(state.run.settings);
    state.firstVisit = true;
    return '';
  }
  state.run = saved.run;
  state.aiStyle = style;
  state.aiPieces = saved.ai.pieces;
  state.best = bestFor(state.run.settings);
  if (!saved.battleInProgress) return '';

  // The page was closed or reloaded mid-battle: count it as a loss.
  state.run = applyResult(state.run, 'b');
  if (isRunOver(state.run)) {
    const score = runScore(state.run);
    const newBest = score > state.best;
    if (newBest) {
      state.best = score;
      saveBest(score, state.run.settings.difficulty, state.run.settings.mode);
    }
    state.run = newRun(state.run.settings);
    draftOpponent();
    persist();
    return (
      `Your last battle was interrupted and counted as a loss. Game over: you won ${score} round${score === 1 ? '' : 's'}` +
      (newBest ? ' (new best!).' : '.')
    );
  }
  state.run = nextRound(state.run);
  draftOpponent();
  persist();
  return `Your last battle was interrupted and counted as a loss (−1 life, ${state.run.lives} left).`;
}

// ---- rendering ----

/** The board a round is played on (in Growing mode it grows every few rounds). */
function boardOf(round = state.run.round): BoardSpec {
  return gameMode(state.run.settings.mode).board(round);
}

function currentBoard(): BoardSpec {
  return boardOf();
}

/** Best score for the run's mode and difficulty. */
function bestFor(settings: RunSettings): number {
  return loadBest(settings.difficulty, settings.mode);
}

function draftOpponent(): void {
  const spec = currentBoard();
  state.aiStyle = pickStyle(rng);
  const { settings } = state.run;
  const mode = gameMode(settings.mode);
  const budget = aiBudget(
    state.run.round,
    rng,
    difficulty(settings.difficulty).perRound,
    mode.roundOneDiscount,
    mode.aiBonus,
  );
  state.aiPieces = placeAiArmy(draftAiArmy(budget, state.aiStyle, rng, spec), state.aiStyle, rng, spec);
}

/** Shows the opponent's placement if the run was started with Reveal on. */
function renderReveal(): void {
  board.setEnemy(state.run.settings.reveal ? state.aiPieces : null);
}

const newRunDialog = $<HTMLDialogElement>('#new-run-dialog');

/** Opens the New run window, preset to the current run's settings. Runs start only from here. */
function openNewRunDialog(): void {
  if (state.busy) return;
  const { settings } = state.run;
  for (const radio of newRunDialog.querySelectorAll<HTMLInputElement>('input[name="nr-mode"]')) {
    radio.checked = radio.value === settings.mode;
  }
  $<HTMLSelectElement>('#nr-difficulty').value = settings.difficulty;
  $<HTMLInputElement>('#nr-reveal').checked = settings.reveal;
  $('#nr-warning').hidden = !hasStarted(state.run) || isRunOver(state.run);
  newRunDialog.returnValue = '';
  newRunDialog.showModal();
}

newRunDialog.addEventListener('close', () => {
  if (newRunDialog.returnValue !== 'start') return;
  const mode = newRunDialog.querySelector<HTMLInputElement>('input[name="nr-mode"]:checked')?.value;
  const level = $<HTMLSelectElement>('#nr-difficulty').value;
  startNewRun({
    mode: isModeId(mode) ? mode : DEFAULT_SETTINGS.mode,
    difficulty: isDifficultyId(level) ? level : DEFAULT_SETTINGS.difficulty,
    reveal: $<HTMLInputElement>('#nr-reveal').checked,
  });
});

function renderOpponent(): void {
  const types = state.aiPieces.map((p) => p.type).sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));
  const points = types.reduce((s, t) => s + PIECE_VALUE[t], 0);
  $('#opponent').innerHTML =
    `Opponent · <strong>${state.aiStyle.name}</strong>` +
    `: ` +
    `<span class="glyphs">${types.map(inlineGlyph).join('')}</span> · ${points} pts`;
}

/** `round` lets the result screen keep showing the round just played. */
function renderHeader(round = state.run.round): void {
  const { lives, record } = state.run;
  const spec = boardOf(round);
  $('#round').textContent = `Round ${round} · ${spec.files}×${spec.ranks}`;
  const livesEl = $('#lives');
  livesEl.innerHTML = Array.from(
    { length: START_LIVES },
    (_, i) => `<span class="heart ${i < lives ? 'full' : 'empty'}">${HEART}</span>`,
  ).join('');
  livesEl.setAttribute('aria-label', `${lives} of ${START_LIVES} lives`);
  $('#record').textContent = `${record.w}W ${record.l}L ${record.d}D`;
  const level = difficulty(state.run.settings.difficulty);
  $('#best').textContent =
    `Best ${Math.max(state.best, runScore(state.run))}${level.id === 'normal' ? '' : ` (${level.name})`}`;
  const { w, l, d } = record;
  $('#help').hidden = w + l + d > 0;
}

function updatePlacement(pieces: Piece[]): void {
  state.run = { ...state.run, shop: { ...state.run.shop, pieces } };
  const placed = pieces.filter((p) => p.square);
  const points = placed.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
  const spec = currentBoard();
  $('#points').textContent =
    `${placed.length}/${homeSquares(spec)} squares filled · ${points} pts on board · army ${pieces.length}/${MAX_ARMY}`;
  const errors = armyErrors(pieces, spec);
  fightBtn.disabled = state.busy || errors.length > 0;
  fightBtn.title = errors.join('\n');
  updateShop();
  persist();
}

/** Gold, the buy button, and upgrade/sell buttons for the selected piece. */
function updateShop(): void {
  const { gold, pieces } = state.run.shop;
  $('#gold').textContent = `${gold}g`;
  const buy = $<HTMLButtonElement>('#buy-pawn');
  buy.disabled = gold < PAWN_COST || pieces.length >= MAX_ARMY;
  // On a full board, more pawns only wait on the bench: point players at upgrades instead.
  const spec = currentBoard();
  const pawns = pieces.filter((p) => p.type === 'P').length;
  const boardFull = pieces.length >= homeSquares(spec) || pawns >= pawnSquares(spec);
  buy.textContent = boardFull ? `Board full: upgrade instead (pawn ${PAWN_COST}g)` : `Buy pawn · ${PAWN_COST}g`;
  buy.classList.toggle('muted', boardFull);

  const actions = $('#piece-actions');
  const piece = pieces.find((p) => p.id === state.selected);
  if (!piece) {
    actions.innerHTML = `<span class="hint">Tap a piece to upgrade or sell it.</span>`;
    return;
  }
  const upgrades = UPGRADES[piece.type]
    .map((to) => {
      const cost = upgradeCost(piece.type, to);
      const disabled = gold < cost ? 'disabled' : '';
      return `<button type="button" data-upgrade="${to}" ${disabled}>${inlineGlyph(to)} ${PIECE_NAME[to]} · ${cost}g</button>`;
    })
    .join('');
  const sell =
    piece.type === 'K' ? '' : `<button type="button" class="sell" data-sell>Sell · +${sellValue(piece.type)}g</button>`;
  const maxed = upgrades === '' && piece.type !== 'K' ? '<span class="hint">Fully upgraded</span>' : '';
  actions.innerHTML = `<span class="selected-name">${PIECE_NAME[piece.type]}</span>${upgrades}${maxed}${sell}`;
}

/** Applies a shop action, or shows why it failed. */
function applyShop(result: ShopResult): void {
  if (!result.ok) {
    messageEl.textContent = result.error;
    return;
  }
  messageEl.textContent = '';
  board.setPieces(result.shop.pieces);
  state.run = { ...state.run, shop: result.shop };
  updatePlacement(result.shop.pieces);
}

function showPlacement(): void {
  battleEl.hidden = true;
  placementEl.hidden = false;
  const spec = currentBoard();
  const grew = state.shownBoard !== null && state.shownBoard !== spec.variant;
  state.shownBoard = spec.variant;
  messageEl.textContent = '';
  const notice = $('#notice');
  notice.hidden = !grew;
  notice.textContent = grew ? `The board grew to ${spec.files}×${spec.ranks}: more room for your army!` : '';
  // Boards only grow, so placed pieces stay valid; this repairs saves from older versions.
  state.run = { ...state.run, shop: { ...state.run.shop, pieces: fitToBoard(state.run.shop.pieces, spec) } };
  board.setSpec(spec);
  board.setPieces(state.run.shop.pieces);
  renderReveal();
  renderOpponent();
  renderHeader();
  updatePlacement(state.run.shop.pieces);
}

// ---- wiring ----

const board = new PlacementBoard($('#board-root'), state.run.shop.pieces, {
  onChange: updatePlacement,
  onMessage: (text) => (messageEl.textContent = text),
  onSelect: (id) => {
    state.selected = id;
    updateShop();
  },
});
const battleView = new BattleView($('#battle-root'));

$('#clear').addEventListener('click', () => {
  const pieces = state.run.shop.pieces.map((p) => ({ ...p, square: null }));
  board.setPieces(pieces);
  messageEl.textContent = '';
  updatePlacement(pieces);
});

$('#buy-pawn').addEventListener('click', () => applyShop(buyPawn(state.run.shop)));

$('#piece-actions').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn || !state.selected) return;
  const shop = state.run.shop;
  if (btn.dataset.upgrade) applyShop(upgradePiece(shop, state.selected, btn.dataset.upgrade as PieceType));
  else if (btn.hasAttribute('data-sell')) applyShop(sellPiece(shop, state.selected));
});

fightBtn.addEventListener('click', () => void fight());

$('#playback').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
  if (!btn) return;
  if (btn.id === 'skip') state.skipping = true;
  else state.speed = Number(btn.dataset.speed);
  updatePlaybackButtons();
});

$('#next').addEventListener('click', () => {
  if (isRunOver(state.run)) openNewRunDialog();
  else showPlacement();
});

$('#new-run').addEventListener('click', openNewRunDialog);

/** Starts over, keeping the current settings unless new ones are given. */
function startNewRun(settings: RunSettings = state.run.settings): void {
  clearGame();
  state.run = newRun(settings);
  state.best = bestFor(settings);
  state.selected = null;
  state.shownBoard = null; // a new run's first board isn't "growth"
  draftOpponent();
  showPlacement();
}

function updatePlaybackButtons(): void {
  document.querySelectorAll<HTMLButtonElement>('.speed').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.speed) === state.speed && !state.skipping);
  });
  $<HTMLButtonElement>('#skip').disabled = state.skipping;
}

// ---- battle ----

async function fight(): Promise<void> {
  if (state.busy || armyErrors(state.run.shop.pieces, currentBoard()).length) return;
  state.busy = true;
  fightBtn.disabled = true;
  board.clearSelection();
  try {
    if (!state.engine) {
      messageEl.textContent = 'Loading engine…';
      const [engine] = await Promise.all([Engine.create(), loadRules()]);
      state.engine = engine;
      messageEl.textContent = '';
    }
    const start = resolveStart();
    persist(true);
    await playBattle(start.fen, start.firstMover);
  } catch (err) {
    console.error(err);
    persist(); // the battle never finished, so don't count it as abandoned
    messageEl.textContent = `Battle failed: ${err instanceof Error ? err.message : String(err)}`;
    battleEl.hidden = true;
    placementEl.hidden = false;
  } finally {
    state.busy = false;
    fightBtn.disabled = armyErrors(state.run.shop.pieces, currentBoard()).length > 0;
  }
}

/** Builds the start position, re-placing the AI army if both kings would start in check. */
function resolveStart(): Extract<StartPosition, { ok: true }> {
  for (;;) {
    const spec = currentBoard();
    const start = startPosition(state.run.shop.pieces, state.aiPieces, rng, spec);
    if (start.ok) return start;
    state.aiPieces = placeAiArmy(
      state.aiPieces.map((p) => p.type),
      state.aiStyle,
      rng,
      spec,
    );
  }
}

async function playBattle(fen: string, firstMover: 'w' | 'b'): Promise<void> {
  state.speed = 1;
  state.skipping = false;
  updatePlaybackButtons();
  placementEl.hidden = true;
  battleEl.hidden = false;
  resultEl.hidden = true;
  $('#playback').hidden = false;

  const spec = currentBoard();
  const limit = plyLimit(spec);
  battleView.render(fen, spec);
  showEval(0);
  battleStatusEl.textContent = firstMover === 'w' ? 'You move first' : 'Opponent moves first';
  await sleep(700);

  const result = await runBattle(
    fen,
    state.engine!,
    rng,
    async (move, game, plies, evalScore) => {
      const ms = state.skipping ? 0 : MOVE_MS / state.speed;
      battleView.render(game.fen(), game.spec, {
        last: move,
        animateMs: reduceMotion ? 0 : ms * 0.8,
        check: game.isCheck(),
      });
      if (evalScore !== null) showEval(evalScore);
      const mat = material(game.fen());
      battleStatusEl.textContent = state.skipping
        ? 'Skipping…'
        : `Move ${Math.ceil(plies / 2)}/${limit / 2} · Material ${mat.w}–${mat.b}`;
      if (ms) await sleep(ms);
    },
    { plyLimit: limit },
    spec,
  );

  if (result.reason === 'checkmate' && result.winner !== 'draw') showEval(checkmateEval(result.winner));
  showResult(result);
}

/** Updates the eval bar. Scores are from the player's (white's) side: positive = you're ahead. */
function showEval(score: number): void {
  const share = evalShare(score);
  evalFillEl.style.width = `${share * 100}%`;
  const label = formatEval(score);
  evalLabelEl.textContent = label;
  evalLabelEl.dataset.side = share > 0.5 ? 'you' : share < 0.5 ? 'them' : 'even';
  evalBarEl.setAttribute('aria-valuenow', String(Math.round(share * 100)));
  evalBarEl.setAttribute('aria-valuetext', `${label} (${share >= 0.5 ? 'you' : 'opponent'} ahead)`);
}

/**
 * Applies the result and, unless the run is over, immediately advances to the next round and
 * drafts its opponent, so reloading on the result screen can't replay the round.
 */
function showResult(result: BattleResult): void {
  const { winner, reason, material } = result;
  const playedRound = state.run.round;
  state.run = applyResult(state.run, winner);
  const over = isRunOver(state.run);
  const score = runScore(state.run);
  const newBest = over && score > state.best;

  if (over) {
    if (newBest) {
      state.best = score;
      saveBest(score, state.run.settings.difficulty, state.run.settings.mode);
    }
    clearGame();
  } else {
    state.run = nextRound(state.run);
    draftOpponent();
    persist();
  }
  renderHeader(playedRound);

  $('#playback').hidden = true;
  resultEl.hidden = false;
  resultEl.dataset.winner = over ? 'b' : winner;
  battleStatusEl.textContent = '';

  const moves = Math.ceil(result.plies / 2);
  const verb = winner === 'draw' ? 'Drawn' : winner === 'w' ? 'You won' : 'You lost';
  // A move-limit result is a normal way to win, so name it plainly instead of looking like a stuck game.
  const outcome =
    reason === 'move-limit'
      ? `${verb} on points, ${material.w}–${material.b}, at the ${plyLimit(boardOf(playedRound)) / 2}-move limit.`
      : `${verb} ${REASON_TEXT[reason]}. Material ${material.w}–${material.b} after ${moves} moves.`;
  if (over) {
    $('#result-title').textContent = 'Game over';
    $('#result-detail').textContent =
      `${outcome} You won ${score} round${score === 1 ? '' : 's'}. ${newBest ? 'New best!' : `Best: ${state.best}.`}`;
    $('#next').textContent = 'New run';
  } else {
    const title = winner === 'w' ? 'Victory' : winner === 'b' ? 'Defeat' : 'Draw';
    $('#result-title').textContent = reason === 'move-limit' ? `${title} on points` : title;
    const lifeNote = winner === 'b' ? ` −1 life (${state.run.lives} left).` : '';
    $('#result-detail').textContent = `${outcome} +${roundIncome(winner)} gold.${lifeNote}`;
    $('#next').textContent = 'Next round';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boot(): void {
  const notice = restoreOrStart();
  showPlacement();
  messageEl.textContent = notice;
  if (state.firstVisit) openNewRunDialog();
}

/**
 * On hosts without COOP/COEP headers, coi-serviceworker (index.html) reloads the page once on the
 * first visit to make it cross-origin isolated. Starting before that reload would save a default
 * run and skip the New run window, so wait for it; boot anyway if it never comes (e.g. service
 * workers blocked), and the engine reports the problem when a battle starts.
 */
const isolationReloadPending = !window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator;
if (isolationReloadPending) setTimeout(boot, 4000);
else boot();
