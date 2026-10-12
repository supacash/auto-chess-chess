import type { MatchSettings } from './multi/match';
import './style.css';
import { achievement, battleAchievements, PRESTIGIOUS_LEVEL } from './game/achievements';
import { showToast } from './app/toast';
import { battleVariant } from './chess/boardSpec';
import { whiteEval } from './engine/pick';
import { SEARCH_DEPTH } from './game/runBattle';
import { BattleScreen, GamePaused } from './app/battleScreen';
import { $ } from './app/dom';
import { renderHeader } from './app/header';
import { renderLayout } from './app/layout';
import { NewRunDialog } from './app/newRunDialog';
import { PlacementScreen } from './app/placementScreen';
import { LobbyScreen } from './app/lobbyScreen';
import { MatchController } from './app/matchController';
import { PrestigeDialog } from './app/prestigeDialog';
import { ProfileScreen } from './app/profileScreen';
import { RecordBook } from './app/recordBook';
import { Session } from './app/session';
import { loadRules } from './chess/loadRules';
import { Engine } from './engine/stockfish';
import { ManualBattle } from './game/manualBattle';
import { clearMatch, loadMatch } from './game/storage';
import { generateName } from './multi/names';
import { isRoomCode, normalizeCode } from './online/room';
import type { RunSettings } from './rules/difficulty';
import type { BattleResult } from './rules/battle';
import { perk, perkChoices } from './rules/prestige';
import { seededRng } from './rules/rng';
import { hasStarted, isRunOver } from './rules/run';

const rng = Math.random;

renderLayout($('#app'));
const session = new Session(rng);
const records = new RecordBook();
const placement = new PlacementScreen(
  session,
  () => renderHeader(session),
  () => void fight(),
  () => void playYourself(),
  () => void watchReplay(),
);
const prestigeDialog = new PrestigeDialog();
const battle = new BattleScreen(
  () => {
    if (isRunOver(session.run)) showMenu();
    else showPlacement();
  },
  () => void watchReplay(),
  () => openPrestige(),
);

/** After a won run: pick a perk and start the next prestige level. */
function openPrestige(): void {
  const owned = session.run.perks.map(perk);
  prestigeDialog.open(session.run.prestige + 1, perkChoices(session.run.perks, rng), owned, (id) => {
    session.startPrestige(id);
    if (session.run.prestige >= PRESTIGIOUS_LEVEL) records.unlock(['prestigious']);
    placement.resetForNewRun();
    showPlacement();
  });
}
placement.onGained = (type) => records.bought(type);
placement.onAchievements = (ids) => records.unlock(ids);
placement.onCollect = (kind, types) => records.collect(kind, types);
records.onUnlock = (id) => {
  const a = achievement(id);
  showToast(`🏆 Achievement unlocked: ${a.name}`, a.description);
};
const profile = new ProfileScreen(records, playerName, renamePlayer, () => showMenu());
$('#menu-profile').addEventListener('click', () => {
  $('#menu').hidden = true;
  profile.show();
});
const newRun = new NewRunDialog(startNewRun);
$('#menu-button').addEventListener('click', () => {
  // During a Play it game, Menu pauses it (it's saved after every move); Resume game picks it up.
  if (busy) battle.pauseManual();
  else showMenu();
});
$('#menu-new').addEventListener('click', openNewRun);
$('#menu-resume').addEventListener('click', () => {
  if (session.manual) {
    hideMenu();
    resumeManual();
  } else showPlacement();
});
$('#menu-replay').addEventListener('click', () => void watchReplay());
$('#menu-rejoin').addEventListener('click', () => void rejoinMatch());
const match = new MatchController({
  placement,
  battle,
  ensureEngine,
  backgroundEngine,
  records,
  onExit: () => {
    placement.use(session, { header: () => renderHeader(session) });
    showMenu();
  },
});
const lobby = new LobbyScreen(
  (client, room) => {
    document.body.classList.remove('in-lobby');
    match.startOnline(client, room);
  },
  () => {
    document.body.classList.remove('in-lobby');
    showMenu();
  },
  () => [1, 2, 3].map(() => generateName(Math.random)),
);
const matchDialog = $<HTMLDialogElement>('#match-dialog');
$('#menu-multiplayer').addEventListener('click', () => {
  if (busy) return;
  $('#mp-error').textContent = '';
  matchDialog.showModal();
});
matchDialog.querySelector('form')?.addEventListener('submit', (e) => {
  const action = (e.submitter as HTMLButtonElement | null)?.value;
  const blitz = $<HTMLInputElement>('#mp-blitz').checked;
  // Growing board and Fairy pieces are for rooms the player creates and games vs bots (Quick play is Classic).
  const settings: MatchSettings = {
    blitz,
    mode: $<HTMLInputElement>('#mp-growing').checked ? 'growing' : 'classic',
    fairy: $<HTMLInputElement>('#mp-fairy').checked,
  };
  if (action === 'bots') {
    hideMenu();
    match.startOffline(settings);
  } else if (action === 'create' || action === 'join' || action === 'quick') {
    e.preventDefault(); // keep the window open until the room is ready (or show what went wrong)
    void openRoom(action, settings);
  }
});

/** Picks a new random name for the player (used in online rooms from then on). */
function renamePlayer(): string {
  const name = generateName(Math.random);
  try {
    localStorage.setItem('acc.name.v1', name);
  } catch {
    // ignore
  }
  return name;
}

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

/** Creates or joins an online room (or finds a quick play one), then shows its lobby. The Firebase code loads only now. */
async function openRoom(action: 'create' | 'join' | 'quick', settings: MatchSettings): Promise<void> {
  const error = $('#mp-error');
  const code = normalizeCode($<HTMLInputElement>('#mp-code').value);
  if (action === 'join' && !isRoomCode(code)) {
    error.textContent = 'Enter the 4-letter room code.';
    return;
  }
  error.textContent = action === 'create' ? 'Creating a room…' : action === 'quick' ? 'Finding a match…' : 'Joining…';
  try {
    const { RoomClient } = await import('./online/client');
    const client = await RoomClient.connect();
    const name = playerName();
    const roomCode =
      action === 'create'
        ? await client.createRoom(name, settings, Math.random)
        : action === 'quick'
          ? await client.quickPlay(name, settings.blitz, Math.random)
          : code;
    if (action === 'join') await client.joinRoom(code, name);
    matchDialog.close();
    hideMenu();
    placement.hide();
    battle.hide();
    document.body.classList.add('in-lobby');
    lobby.open(client, roomCode);
  } catch (err) {
    console.error(err);
    error.textContent = err instanceof Error ? err.message : String(err);
  }
}

/** Rejoins the online match this device was in (after a reload, or after leaving it). */
async function rejoinMatch(): Promise<void> {
  const saved = loadMatch();
  if (!saved || busy || match.active) return;
  const button = $<HTMLButtonElement>('#menu-rejoin');
  button.disabled = true;
  $('#menu-rejoin-detail').textContent = 'Connecting…';
  try {
    const { RoomClient } = await import('./online/client');
    const client = await RoomClient.connect();
    const room = await client.getRoom(saved.code);
    const me = room?.players.find((p) => p.id === client.uid);
    if (!room || client.uid !== saved.uid || room.status !== 'playing' || !me || me.place !== null) {
      clearMatch();
      showMenu(room?.status === 'over' ? 'That match has finished.' : 'That match can’t be rejoined any more.');
      return;
    }
    hideMenu();
    match.startOnline(client, room, saved);
  } catch (err) {
    console.error(err);
    showMenu(`Couldn’t rejoin the match: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    button.disabled = false;
  }
}

let engine: Engine | null = null;
let busy = false;

function showPlacement(): void {
  hideMenu();
  battle.hide();
  placement.show();
}

/** The main menu: resume the single-player run, start a new one, or play multiplayer. */
function showMenu(notice = ''): void {
  battle.hide();
  placement.hide();
  document.body.classList.add('in-menu');
  profile.hide();
  $('#menu').hidden = false;
  const inProgress = session.manual !== null || (session.saved && !isRunOver(session.run));
  $('#menu-resume').hidden = !inProgress;
  const { round, lives } = session.run;
  $('#menu-resume-detail').textContent = session.manual
    ? `Round ${round} · your game is in progress`
    : `Round ${round} · ${lives} ${lives === 1 ? 'life' : 'lives'} left${session.run.settings.manual ? ' · Play yourself' : ''}`;
  const saved = match.active ? null : loadMatch();
  $('#menu-rejoin').hidden = !saved;
  $('#menu-rejoin-detail').textContent = saved ? `Room ${saved.code} · round ${saved.round}` : '';
  $('#menu-resume').classList.toggle('primary', !saved);
  $('#menu-new').classList.toggle('primary', !inProgress && !saved);
  $('#menu-replay').hidden = !session.lastReplay;
  const note = $('#menu-notice');
  note.hidden = !notice;
  note.textContent = notice;
}

function hideMenu(): void {
  document.body.classList.remove('in-menu');
  $('#menu').hidden = true;
  profile.hide();
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

let background: Promise<Engine> | null = null;

/**
 * A second engine for battles the player doesn't watch (multiplayer), so they run alongside the one
 * on screen instead of after it.
 */
function backgroundEngine(): Promise<Engine> {
  background ??= ensureEngine().then(() => Engine.create());
  background.catch(() => {
    background = null;
  });
  return background;
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
    // Auto battles can't be left midway (leaving counts as a loss); Play it games can be paused.
    $<HTMLButtonElement>('#menu-button').disabled = !session.manual;
    const result = await play(loaded);
    const settings = session.run.settings;
    const outcome = session.finishBattle(result);
    if (outcome.over) records.runEnd(settings, outcome.score, outcome.won, outcome.prestige);
    if (outcome.won && outcome.record.l === 0) records.unlock(['undefeated']);
    renderHeader(session, outcome.playedRound, color);
    battle.showResult(result, outcome, spec, session.run.lives, session.best);
  } catch (err) {
    if (err instanceof GamePaused) {
      showMenu();
      return;
    }
    console.error(err);
    session.manual = null;
    session.persist(); // the battle never finished, so don't count it as abandoned
    showPlacement();
    placement.setMessage(`Battle failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    busy = false;
    placement.setBusy(false);
    $<HTMLButtonElement>('#menu-button').disabled = false;
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
    const { result, moves, evals, worstDeficit } = await battle.play(
      loaded,
      start.fen,
      start.firstMover,
      session.board,
      seededRng(seed),
    );
    session.saveReplay({ ...record, moves, evals, result });
    records.battle(result, 'w', worstDeficit, session.run.settings);
    records.unlock(battleAchievements({ fen: start.fen, moves, spec: session.board, side: 'w', result, worstDeficit }));
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
    records.battle(result, 'w', battle.manualWorstDeficit, session.run.settings);
    records.unlock([
      ...battleAchievements({
        fen: game.start,
        moves: game.moves,
        spec: game.spec,
        side: 'w',
        result,
        worstDeficit: battle.manualWorstDeficit,
      }),
      ...(result.winner === 'w' ? (['diy'] as const) : []),
    ]);
    return result;
  } finally {
    game.delete();
  }
}

/** Replays the last finished battle (from the result screen, placement or the menu). */
async function watchReplay(): Promise<void> {
  const record = session.lastReplay;
  if (busy || !record) return;
  const fromMenu = !$('#menu').hidden;
  try {
    await loadRules(); // the replay steps through moves with the rules library (normally loaded with the engine)
  } catch (err) {
    placement.setMessage(`Couldn't load the replay: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  hideMenu();
  placement.hide();
  await battle.replay(record, fromMenu ? () => showMenu() : showPlacement, {
    prepare: async (spec, fen) => {
      const engine = await ensureEngine();
      await engine.newGame(battleVariant(spec, fen));
    },
    evaluate: async (fen, history) => {
      const engine = await ensureEngine();
      const turn = fen.split(' ')[1] === 'b' ? 'b' : 'w';
      return whiteEval(await engine.candidates(fen, SEARCH_DEPTH, history), turn);
    },
    save: (evals) => {
      // Only while this battle is still the last one (a newer battle replaces it).
      if (session.lastReplay?.fen !== record.fen || session.lastReplay.seed !== record.seed) return;
      session.saveReplay({ ...session.lastReplay, evals });
    },
  });
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
  const { notice } = session.restore();
  renderHeader(session);
  showMenu(notice);
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
