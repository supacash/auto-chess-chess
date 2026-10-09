import './style.css';
import { Chess } from 'chess.js';
import { Engine } from './engine/stockfish';
import { runBattle } from './game/runBattle';
import { clearGame, loadBest, loadGame, saveBest, saveGame } from './game/storage';
import { AI_STYLES, type AiStyle, aiBudget, draftAiArmy, pickStyle, placeAiArmy } from './rules/aiArmy';
import { type BattleResult, type EndReason, material, PLY_LIMIT } from './rules/battle';
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
import { armyErrors } from './rules/placement';
import { type StartPosition, startPosition } from './rules/position';
import { applyResult, isRunOver, newRun, nextRound, type Run, runScore, START_LIVES } from './rules/run';
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
  'move-limit': 'on material at the move limit',
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
      Place your king and any other pieces in your three rows, spend gold on pawns and upgrades, then press
      <strong>Fight</strong>. The engine plays both sides. Lose a round and you lose a life.
    </p>
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

  <footer class="credits">
    Chess engine: <a href="https://stockfishchess.org" target="_blank" rel="noopener">Stockfish</a> 19 via
    <a href="https://github.com/nmrugg/stockfish.js" target="_blank" rel="noopener">Stockfish.js</a>, licensed under the
    <a href="engine/STOCKFISH-LICENSE.txt" target="_blank" rel="noopener">GPLv3</a>
    (<a href="https://github.com/nmrugg/stockfish.js/tree/v19.0.0" target="_blank" rel="noopener">source</a>).
    Game code: <a href="https://github.com/supacash/auto-chess-chess" target="_blank" rel="noopener">MIT</a>.
  </footer>`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const placementEl = $('#placement');
const battleEl = $('#battle');
const messageEl = $('#message');
const fightBtn = $<HTMLButtonElement>('#fight');
const battleStatusEl = $('#battle-status');
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
};

// ---- persistence ----

/** `battleInProgress` marks a battle as started, so leaving mid-battle counts as a loss on the next load. */
function persist(battleInProgress = false): void {
  saveGame({
    version: 1,
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
    return '';
  }
  state.run = saved.run;
  state.aiStyle = style;
  state.aiPieces = saved.ai.pieces;
  if (!saved.battleInProgress) return '';

  // The page was closed or reloaded mid-battle: count it as a loss.
  state.run = applyResult(state.run, 'b');
  if (isRunOver(state.run)) {
    const score = runScore(state.run);
    const newBest = score > state.best;
    if (newBest) {
      state.best = score;
      saveBest(score);
    }
    state.run = newRun();
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

function draftOpponent(): void {
  state.aiStyle = pickStyle(rng);
  state.aiPieces = placeAiArmy(draftAiArmy(aiBudget(state.run.round, rng), state.aiStyle, rng), state.aiStyle, rng);
}

function renderOpponent(): void {
  const types = state.aiPieces.map((p) => p.type).sort((a, b) => PIECE_ORDER.indexOf(a) - PIECE_ORDER.indexOf(b));
  const points = types.reduce((s, t) => s + PIECE_VALUE[t], 0);
  $('#opponent').innerHTML =
    `Opponent · <strong>${state.aiStyle.name}</strong>: ` +
    `<span class="glyphs">${types.map(inlineGlyph).join('')}</span> · ${points} pts`;
}

/** `round` lets the result screen keep showing the round just played. */
function renderHeader(round = state.run.round): void {
  const { lives, record } = state.run;
  $('#round').textContent = `Round ${round}`;
  const livesEl = $('#lives');
  livesEl.innerHTML = Array.from(
    { length: START_LIVES },
    (_, i) => `<span class="heart ${i < lives ? 'full' : 'empty'}">${HEART}</span>`,
  ).join('');
  livesEl.setAttribute('aria-label', `${lives} of ${START_LIVES} lives`);
  $('#record').textContent = `${record.w}W ${record.l}L ${record.d}D`;
  $('#best').textContent = `Best ${Math.max(state.best, runScore(state.run))}`;
  const { w, l, d } = record;
  $('#help').hidden = w + l + d > 0;
}

function updatePlacement(pieces: Piece[]): void {
  state.run = { ...state.run, shop: { ...state.run.shop, pieces } };
  const placed = pieces.filter((p) => p.square);
  const points = placed.reduce((sum, p) => sum + PIECE_VALUE[p.type], 0);
  $('#points').textContent =
    `${placed.length}/${pieces.length} placed · ${points} pts on board · army ${pieces.length}/${MAX_ARMY}`;
  const errors = armyErrors(pieces);
  fightBtn.disabled = state.busy || errors.length > 0;
  fightBtn.title = errors.join('\n');
  updateShop();
  persist();
}

/** Gold, the buy button, and upgrade/sell buttons for the selected piece. */
function updateShop(): void {
  const { gold, pieces } = state.run.shop;
  $('#gold').textContent = `${gold}g`;
  $<HTMLButtonElement>('#buy-pawn').disabled = gold < PAWN_COST || pieces.length >= MAX_ARMY;

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
  messageEl.textContent = '';
  board.setPieces(state.run.shop.pieces);
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
  if (isRunOver(state.run)) startNewRun();
  else showPlacement();
});

$('#new-run').addEventListener('click', () => {
  if (state.busy) return;
  const started = state.run.round > 1 || state.run.record.w + state.run.record.l + state.run.record.d > 0;
  if (started && !window.confirm('Abandon this run and start over?')) return;
  startNewRun();
});

function startNewRun(): void {
  clearGame();
  state.run = newRun();
  state.selected = null;
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
  if (state.busy || armyErrors(state.run.shop.pieces).length) return;
  state.busy = true;
  fightBtn.disabled = true;
  board.clearSelection();
  try {
    if (!state.engine) {
      messageEl.textContent = 'Loading engine…';
      state.engine = await Engine.create();
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
    fightBtn.disabled = armyErrors(state.run.shop.pieces).length > 0;
  }
}

/** Builds the start position, re-placing the AI army if both kings would start in check. */
function resolveStart(): Extract<StartPosition, { ok: true }> {
  for (;;) {
    const start = startPosition(state.run.shop.pieces, state.aiPieces, rng);
    if (start.ok) return start;
    state.aiPieces = placeAiArmy(
      state.aiPieces.map((p) => p.type),
      state.aiStyle,
      rng,
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

  battleView.render(new Chess(fen, { skipValidation: true }));
  battleStatusEl.textContent = firstMover === 'w' ? 'You move first' : 'Opponent moves first';
  await sleep(700);

  const result = await runBattle(fen, state.engine!, rng, async (move, chess, plies) => {
    const ms = state.skipping ? 0 : MOVE_MS / state.speed;
    battleView.render(chess, move, reduceMotion ? 0 : ms * 0.8);
    const mat = material(chess);
    battleStatusEl.textContent = state.skipping
      ? 'Skipping…'
      : `Move ${Math.ceil(plies / 2)}/${PLY_LIMIT / 2} · Material ${mat.w}–${mat.b}`;
    if (ms) await sleep(ms);
  });

  showResult(result);
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
      saveBest(score);
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

  const outcome =
    `${winner === 'draw' ? 'Drawn' : winner === 'w' ? 'You won' : 'You lost'} ${REASON_TEXT[reason]}. ` +
    `Material ${material.w}–${material.b} after ${Math.ceil(result.plies / 2)} moves.`;
  if (over) {
    $('#result-title').textContent = 'Game over';
    $('#result-detail').textContent =
      `${outcome} You won ${score} round${score === 1 ? '' : 's'}. ` +
      (newBest ? 'New best!' : `Best: ${state.best}.`);
    $('#next').textContent = 'New run';
  } else {
    $('#result-title').textContent = winner === 'w' ? 'Victory' : winner === 'b' ? 'Defeat' : 'Draw';
    const lifeNote = winner === 'b' ? ` −1 life (${state.run.lives} left).` : '';
    $('#result-detail').textContent = `${outcome} +${roundIncome(winner)} gold.${lifeNote}`;
    $('#next').textContent = 'Next round';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const notice = restoreOrStart();
showPlacement();
messageEl.textContent = notice;
