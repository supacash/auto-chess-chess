import './style.css';
import { BattleScreen } from './app/battleScreen';
import { $ } from './app/dom';
import { renderHeader } from './app/header';
import { renderLayout } from './app/layout';
import { NewRunDialog } from './app/newRunDialog';
import { PlacementScreen } from './app/placementScreen';
import { LobbyScreen } from './app/lobbyScreen';
import { MatchController } from './app/matchController';
import { Session } from './app/session';
import { loadRules } from './chess/loadRules';
import { Engine } from './engine/stockfish';
import { ManualBattle } from './game/manualBattle';
import { generateName } from './multi/names';
import { isRoomCode, normalizeCode } from './online/room';
import type { RunSettings } from './rules/difficulty';
import type { BattleResult } from './rules/battle';
import { seededRng } from './rules/rng';
import { hasStarted, isRunOver } from './rules/run';

const rng = Math.random;

renderLayout($('#app'));
const session = new Session(rng);
const placement = new PlacementScreen(
  session,
  () => renderHeader(session),
  () => void fight(),
  () => void playYourself(),
  () => void watchReplay(),
);
const battle = new BattleScreen(
  () => {
    if (isRunOver(session.run)) openNewRun();
    else showPlacement();
  },
  () => void watchReplay(),
);
const newRun = new NewRunDialog(startNewRun);
$('#new-run').addEventListener('click', openNewRun);
const match = new MatchController({
  placement,
  battle,
  ensureEngine,
  onExit: () => {
    placement.use(session, { header: () => renderHeader(session) });
    showPlacement();
  },
});
const lobby = new LobbyScreen(
  (client, room) => {
    document.body.classList.remove('in-lobby');
    match.startOnline(client, room);
  },
  () => {
    document.body.classList.remove('in-lobby');
    showPlacement();
  },
  () => [1, 2, 3].map(() => generateName(Math.random)),
);
const matchDialog = $<HTMLDialogElement>('#match-dialog');
$('#multiplayer').addEventListener('click', () => {
  if (busy) return;
  $('#mp-error').textContent = '';
  matchDialog.showModal();
});
matchDialog.querySelector('form')?.addEventListener('submit', (e) => {
  const action = (e.submitter as HTMLButtonElement | null)?.value;
  const blitz = $<HTMLInputElement>('#mp-blitz').checked;
  if (action === 'bots') match.startOffline({ blitz });
  else if (action === 'create' || action === 'join') {
    e.preventDefault(); // keep the window open until the room is ready (or show what went wrong)
    void openRoom(action, blitz);
  }
});

/** The player's generated name, kept so friends recognise them from game to game. */
function playerName(): string {
  try {
    const saved = localStorage.getItem('acc.name.v1');
    if (saved) return saved;
    const name = generateName(Math.random);
    localStorage.setItem('acc.name.v1', name);
    return name;
  } catch {
    return generateName(Math.random);
  }
}

/** Creates or joins an online room, then shows its lobby. The Firebase code loads only now. */
async function openRoom(action: 'create' | 'join', blitz: boolean): Promise<void> {
  const error = $('#mp-error');
  const code = normalizeCode($<HTMLInputElement>('#mp-code').value);
  if (action === 'join' && !isRoomCode(code)) {
    error.textContent = 'Enter the 4-letter room code.';
    return;
  }
  error.textContent = action === 'create' ? 'Creating a room…' : 'Joining…';
  try {
    const { RoomClient } = await import('./online/client');
    const client = await RoomClient.connect();
    const name = playerName();
    const roomCode = action === 'create' ? await client.createRoom(name, { blitz }, Math.random) : code;
    if (action === 'join') await client.joinRoom(code, name);
    matchDialog.close();
    placement.hide();
    battle.hide();
    document.body.classList.add('in-lobby');
    lobby.open(client, roomCode);
  } catch (err) {
    console.error(err);
    error.textContent = err instanceof Error ? err.message : String(err);
  }
}

let engine: Engine | null = null;
let busy = false;

function showPlacement(): void {
  battle.hide();
  placement.show();
}

function openNewRun(): void {
  if (busy) return;
  newRun.open(session.run.settings, hasStarted(session.run) && !isRunOver(session.run));
}

function startNewRun(settings: RunSettings): void {
  session.startNewRun(settings);
  placement.resetForNewRun();
  showPlacement();
}

/** Loads the engine and rules on first use. */
async function ensureEngine(): Promise<Engine> {
  if (!engine) {
    placement.setMessage('Loading engine…');
    const [loaded] = await Promise.all([Engine.create(), loadRules()]);
    engine = loaded;
    placement.setMessage('');
  }
  return engine;
}

/**
 * Runs one round: `play` shows and plays the battle and returns its result, which is then applied
 * to the run and shown. Errors return to placement without counting the battle.
 */
async function runRound(play: (engine: Engine) => Promise<BattleResult>): Promise<void> {
  if (busy) return;
  if (!engine && !window.crossOriginIsolated && reloadForIsolation()) return;
  busy = true;
  placement.setBusy(true);
  try {
    const loaded = await ensureEngine();
    const spec = session.board;
    const color = session.run.color;
    placement.hide();
    const result = await play(loaded);
    const outcome = session.finishBattle(result);
    renderHeader(session, outcome.playedRound, color);
    battle.showResult(result, outcome, spec, session.run.lives, session.best);
  } catch (err) {
    console.error(err);
    session.manual = null;
    session.persist(); // the battle never finished, so don't count it as abandoned
    showPlacement();
    placement.setMessage(`Battle failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    busy = false;
    placement.setBusy(false);
  }
}

/** The engine plays both sides. */
function fight(): void {
  if (session.armyErrors().length) return;
  void runRound(async (loaded) => {
    const start = session.resolveStart();
    const seed = session.newSeed();
    const record = session.startRecord(start.fen, seed, false);
    session.persist(true);
    const { result, moves, evals } = await battle.play(
      loaded,
      start.fen,
      start.firstMover,
      session.board,
      seededRng(seed),
    );
    session.saveReplay({ ...record, moves, evals, result });
    return result;
  });
}

/** The player moves their own pieces; the engine plays the opponent. Saved after every move. */
function playYourself(): void {
  if (session.armyErrors().length) return;
  void runRound((loaded) => {
    const start = session.resolveStart();
    const seed = session.newSeed();
    session.saveManual({ fen: start.fen, moves: [], seed });
    return playManual(loaded, new ManualBattle(start.fen, session.board, [], seed));
  });
}

async function playManual(loaded: Engine, game: ManualBattle): Promise<BattleResult> {
  const record = session.startRecord(game.start, game.seed, true);
  try {
    const result = await battle.playManual(loaded, game, (state) => session.saveManual(state));
    session.saveReplay({ ...record, moves: [...game.moves], evals: [], result });
    return result;
  } finally {
    game.delete();
  }
}

/** Replays the last finished battle (from the result screen, or from placement). */
async function watchReplay(): Promise<void> {
  const record = session.lastReplay;
  if (busy || !record) return;
  try {
    await loadRules(); // the replay steps through moves with the rules library (normally loaded with the engine)
  } catch (err) {
    placement.setMessage(`Couldn't load the replay: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  placement.hide();
  await battle.replay(record, showPlacement);
}

/** Picks a saved manual game back up after a reload. */
function resumeManual(): void {
  const saved = session.manual;
  if (!saved) return;
  void runRound(async (loaded) => {
    let game: ManualBattle;
    try {
      game = new ManualBattle(saved.fen, session.board, saved.moves, saved.seed);
    } catch {
      throw new Error("Your saved game couldn't be resumed");
    }
    return playManual(loaded, game);
  });
}

const ISOLATION_RELOAD_KEY = 'acc.isolation-reload';

/**
 * Without cross-origin isolation the engine can't run. A page that lost it (e.g. Safari restarted
 * the service worker, or a hard reload bypassed it) usually gets it back on a normal reload. The run
 * is already saved, so reload once per tab; if that didn't help, the engine reports the error.
 */
function reloadForIsolation(): boolean {
  try {
    if (sessionStorage.getItem(ISOLATION_RELOAD_KEY)) return false;
    sessionStorage.setItem(ISOLATION_RELOAD_KEY, '1');
  } catch {
    return false;
  }
  placement.setMessage('Reloading to start the engine…');
  location.reload();
  return true;
}

function boot(): void {
  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(ISOLATION_RELOAD_KEY);
    } catch {
      // ignore
    }
  }
  const { notice, firstVisit } = session.restore();
  showPlacement();
  placement.setMessage(notice);
  if (firstVisit) openNewRun();
  else if (session.manual) resumeManual();
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
