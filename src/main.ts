import type { MatchSettings } from './multi/match';
import '@fontsource/lilita-one/latin-400.css';
import '@fontsource-variable/nunito/wght.css';
import './style.css';
import {
  ACHIEVEMENT_ICONS,
  achievement,
  battleAchievements,
  PRESTIGIOUS_LEVEL,
  runAchievements,
} from './game/achievements';
import { adsAvailable, showRewardedAd } from './app/ads';
import { listenForBack } from './app/backButton';
import { startMenuDrift } from './app/menuDrift';
import { applyReduceMotion } from './app/settings';
import { SettingsScreen } from './app/settingsScreen';
import { setSoundOn, sfx, soundOn } from './app/sound';
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
import { GuideScreen } from './app/guideScreen';
import { RecordBook } from './app/recordBook';
import { Session } from './app/session';
import { loadRules } from './chess/loadRules';
import { createEngine, type GameEngine } from './engine/engine';
import { USE_FAIRY } from './engine/engineChoice';
import { ManualBattle } from './game/manualBattle';
import { clearMatch, loadMatch, loadReplay } from './game/storage';
import { GauntletDialog } from './app/gauntletDialog';
import { dailyBattle, dailyStreak, dailyTheme, type DailyDay } from './rules/daily';
import { generateName } from './multi/names';
import { isRoomCode, normalizeCode, versionError } from './online/room';
import type { RunSettings } from './rules/difficulty';
import type { BattleResult } from './rules/battle';
import type { StartSynergies } from './rules/position';
import { perk, perkChoices } from './rules/prestige';
import { seededRng } from './rules/rng';
import { hasStarted, isRunOver } from './rules/run';

const rng = Math.random;

renderLayout($('#app'));
applyReduceMotion();
startMenuDrift($('#menu-drift'));
/** The normal run, and the daily challenge (its own save and records); `session` is the one on screen. */
const runSession = new Session(rng);
const dailySession = new Session(rng, 'daily');
let session = runSession;
const records = new RecordBook();
const placement = new PlacementScreen(
  session,
  () => renderHeader(session),
  () => void fight(),
  () => void playYourself(),
  () => void watchReplay(),
);
const prestigeDialog = new PrestigeDialog();
const gauntletDialog = new GauntletDialog();
$('#gauntlet-open').addEventListener('click', () => gauntletDialog.open(session));

/** Puts `next` (the run or the daily challenge) on screen. */
function useSession(next: Session): void {
  if (session === next) return;
  session = next;
  session.lastReplay = loadReplay(); // the other session may have played the last battle
  placement.use(session, { header: () => renderHeader(session) });
  renderHeader(session);
}
const battle = new BattleScreen(
  () => {
    if (!isRunOver(session.run)) {
      showPlacement();
      return;
    }
    showMenu();
    // A finished run's New run / New game goes straight to the New game window (Cancel stays on the menu).
    if (!session.run.daily) openNewRun();
  },
  () => void watchReplay(),
  () => openPrestige(),
);

/** After a won run: pick a perk and start the next prestige level. */
function openPrestige(): void {
  const owned = session.run.perks.map(perk);
  prestigeDialog.open(
    session.run.prestige + 1,
    perkChoices(session.run.perks, rng, 3, session.run.settings.fairy, session.run.settings.reveal),
    owned,
    (id) => {
      session.startPrestige(id);
      if (session.run.prestige >= PRESTIGIOUS_LEVEL) records.unlock(['prestigious']);
      placement.resetForNewRun();
      showPlacement();
    },
  );
}
placement.onGained = (type) => records.bought(type);
placement.onAchievements = (ids) => records.unlock(ids);
placement.onCollect = (kind, types) => records.collect(kind, types);
/** Achievements unlocked during the battle being played, for its result card (null between battles). */
let battleAwards: string[] | null = null;
records.onUnlock = (id) => {
  const a = achievement(id);
  sfx('award');
  showToast(`${ACHIEVEMENT_ICONS[id]} Achievement unlocked: ${a.name}`, a.description);
  battleAwards?.push(a.name);
};
/** The menu's quick sound switch (also in Settings): a speaker, struck through when muted. */
const soundButton = $<HTMLButtonElement>('#sound-toggle');
const SPEAKER = '<path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/>';
function renderSoundButton(): void {
  const on = soundOn();
  const waves = on ? '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>' : '<path d="m16 9 5 6m0-6-5 6"/>';
  soundButton.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SPEAKER}${waves}</svg>`;
  soundButton.setAttribute('aria-pressed', String(on));
  soundButton.setAttribute('aria-label', on ? 'Sound on' : 'Sound off');
  soundButton.title = on ? 'Sound on: tap to mute' : 'Sound off: tap to turn it on';
}
soundButton.addEventListener('click', () => {
  setSoundOn(!soundOn());
  renderSoundButton();
  sfx('select');
});
renderSoundButton();
const profile = new ProfileScreen(
  records,
  playerName,
  renamePlayer,
  () => showMenu(),
  // An empty tab's button: off to play for it.
  (go) => {
    showMenu();
    if (go === 'new') openNewRun();
    else if (go === 'daily') openDaily();
    else openMultiplayer();
  },
);
$('#menu-profile').addEventListener('click', () => {
  $('#menu').hidden = true;
  profile.show();
});
const guide = new GuideScreen();
$('#menu-guide').addEventListener('click', () => guide.open());
// "How it moves" in a piece panel opens the guide on that piece; it closes when the shop does (a match's timer).
placement.onGuide = (type) => guide.open(type);
placement.onHide = () => guide.close();
const settingsScreen = new SettingsScreen(() => showMenu());
$('#menu-settings').addEventListener('click', () => {
  $('#menu').hidden = true;
  settingsScreen.show();
});
const newRun = new NewRunDialog(startNewRun);
$('#menu-button').addEventListener('click', () => {
  // During a Play it game, Menu pauses it (it's saved after every move); Resume game picks it up.
  if (busy) battle.pauseManual();
  else showMenu();
});
$('#menu-new').addEventListener('click', openNewRun);
$('#menu-daily').addEventListener('click', openDaily);
$('#menu-resume').addEventListener('click', () => {
  useSession(runSession);
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
    session = runSession;
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
function openMultiplayer(): void {
  if (busy) return;
  $('#mp-error').textContent = '';
  matchDialog.showModal();
}
$('#menu-multiplayer').addEventListener('click', openMultiplayer);
matchDialog.querySelector('form')?.addEventListener('submit', (e) => {
  const action = (e.submitter as HTMLButtonElement | null)?.value;
  const blitz = $<HTMLInputElement>('#mp-blitz').checked;
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
          ? await client.quickPlay(name, settings, Math.random)
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
    // The game updated since: this phone would compute its battles differently from everyone else's.
    const wrongVersion = versionError(room);
    if (wrongVersion) {
      clearMatch();
      showMenu(wrongVersion);
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

let engine: GameEngine | null = null;
let busy = false;

/** The end of a run that could still be revived, recorded once the player moves on (or leaves). */
let pendingRunEnd: (() => void) | null = null;

function recordPendingRunEnd(): void {
  pendingRunEnd?.();
  pendingRunEnd = null;
}
window.addEventListener('pagehide', recordPendingRunEnd);

/** Game over: watch a rewarded ad for one more life (once per run), then carry on with the next round. */
$('#revive').addEventListener('click', async () => {
  const button = $<HTMLButtonElement>('#revive');
  if (busy || !session.canRevive()) return;
  button.disabled = true;
  button.textContent = 'Loading ad…';
  const watched = await showRewardedAd();
  if (watched && session.revive()) {
    pendingRunEnd = null;
    renderHeader(session, session.run.round, session.run.color);
    showPlacement();
    showToast('❤️ Extra life', 'One more life: the run goes on.');
    return;
  }
  button.disabled = false;
  button.textContent = watched ? '▶ Watch an ad for an extra life' : 'No ad right now. Tap to try again';
});

function showPlacement(): void {
  hideMenu();
  battle.hide();
  placement.show();
}

/** The main menu: resume the single-player run, start a new one, or play multiplayer. */
function showMenu(notice = ''): void {
  recordPendingRunEnd();
  battle.hide();
  placement.hide();
  document.body.classList.add('in-menu');
  profile.hide();
  settingsScreen.hide();
  renderSoundButton();
  $('#menu').hidden = false;
  const run = runSession;
  const inProgress = run.manual !== null || (run.saved && !isRunOver(run.run));
  $('#menu-resume').hidden = !inProgress;
  const { round, lives } = run.run;
  $('#menu-resume-detail').textContent = run.manual
    ? `Round ${round} · your game is in progress`
    : `Round ${round} · ${lives} ${lives === 1 ? 'life' : 'lives'} left${run.run.settings.manual ? ' · Play yourself' : ''}${run.run.settings.synergies ? ' · Synergies' : ''}`;
  renderDailyButton();
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
  settingsScreen.hide();
}

function openNewRun(): void {
  if (busy) return;
  newRun.open(runSession.run.settings, hasStarted(runSession.run) && !isRunOver(runSession.run));
}

function startNewRun(settings: RunSettings): void {
  useSession(runSession);
  session.startNewRun(settings);
  placement.resetForNewRun();
  showPlacement();
}

/** The menu's Daily challenge entry: today's theme and status, and the day streak. */
function renderDailyButton(): void {
  const today = dailySession.today();
  const done = records.dailyOf(today);
  const streak = dailyStreak(records.records.daily, today);
  const flame = streak > 0 ? ` · 🔥 ${streak}` : '';
  const daily = dailySession.saved ? dailySession.run.daily : undefined;
  const button = $<HTMLButtonElement>('#menu-daily');
  let detail: string;
  if (daily) {
    const played = dailySession.manual ? 'your game is in progress' : `battle ${dailyBattle(dailySession.run.round)}/5`;
    detail = `${daily.date === today ? 'Resume' : 'Finish yesterday’s'} · ${played}${flame}`;
  } else if (done) {
    detail = `Done today · ${done.score} points${flame} · next at midnight UTC`;
  } else {
    const theme = dailyTheme(today);
    detail = `${theme.name}: ${theme.blurb}${flame}`;
  }
  $('#menu-daily-detail').textContent = detail;
  button.disabled = !daily && done !== undefined;
  button.classList.toggle('done', !daily && done !== undefined);
}

/** Opens the daily challenge: resumes the one in progress, or starts today's (one attempt a day). */
function openDaily(): void {
  if (busy) return;
  const started = !dailySession.saved;
  if (started && !dailySession.startDaily(records.dailyOf(dailySession.today()) !== undefined)) {
    showMenu('Today’s challenge is done. A new one comes at midnight UTC.');
    return;
  }
  useSession(dailySession);
  if (started) placement.resetForNewRun();
  if (session.manual) {
    hideMenu();
    resumeManual();
  } else showPlacement();
}

/** Records a finished daily challenge; returns the day streak with it. */
function recordDaily(day: DailyDay): number {
  records.dailyEnd(day);
  return dailyStreak(records.records.daily, dailySession.today());
}

let background: Promise<GameEngine> | null = null;

/**
 * A second engine for battles the player doesn't watch (multiplayer), so they run alongside the one
 * on screen instead of after it.
 */
function backgroundEngine(): Promise<GameEngine> {
  background ??= ensureEngine().then(() => createEngine());
  background.catch(() => {
    background = null;
  });
  return background;
}

/** Loads the engine and rules on first use. */
async function ensureEngine(): Promise<GameEngine> {
  if (!engine) {
    placement.setMessage('Loading engine…');
    const [loaded] = await Promise.all([createEngine(), loadRules()]);
    engine = loaded;
    placement.setMessage('');
  }
  return engine;
}

/**
 * Runs one round: `play` shows and plays the battle and returns its result, which is then applied
 * to the run and shown. Errors return to placement without counting the battle.
 */
async function runRound(play: (engine: GameEngine) => Promise<BattleResult>): Promise<void> {
  if (busy) return;
  // Fairy-Stockfish (a `fairy` build) needs the page cross-origin isolated; our engine doesn't.
  if (USE_FAIRY && !engine && !window.crossOriginIsolated && reloadForIsolation()) return;
  busy = true;
  placement.setBusy(true);
  try {
    const loaded = await ensureEngine();
    battleAwards = [];
    const spec = session.board;
    const color = session.run.color;
    placement.hide();
    // Auto battles can't be left midway (leaving counts as a loss); Play it games can be paused.
    $<HTMLButtonElement>('#menu-button').disabled = !session.manual;
    const result = await play(loaded);
    const settings = session.run.settings;
    // Spyglass shows the opponent's placement like the Reveal setting (Warlord needs neither).
    const revealed = session.revealOpponent();
    const outcome = session.finishBattle(result);
    if (outcome.daily) outcome.dailyStreak = recordDaily(outcome.daily);
    // A run lost on lives can be revived once with a rewarded ad (Android app): it's only recorded
    // as ended once the player moves on without reviving.
    const offerRevive = outcome.over && session.canRevive() && adsAvailable();
    const endRun = () => records.runEnd(settings, outcome.score, outcome.won, outcome.prestige);
    if (offerRevive) pendingRunEnd = endRun;
    else if (outcome.over && !outcome.isDaily) endRun();
    if (!outcome.isDaily) {
      records.unlock(runAchievements(outcome.won, outcome.record.l, { ...settings, reveal: revealed }));
    }
    renderHeader(session, outcome.playedRound, color);
    battle.showResult(result, outcome, spec, session.run.lives, session.best);
    battle.showAwards(battleAwards);
    const revive = $<HTMLButtonElement>('#revive');
    revive.hidden = !offerRevive;
    revive.disabled = false;
    revive.textContent = '▶ Watch an ad for an extra life';
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
    battleAwards = null;
    busy = false;
    placement.setBusy(false);
    $<HTMLButtonElement>('#menu-button').disabled = false;
  }
}

/** The settings a battle's per-mode records go under: none for the daily challenge (it has its own). */
function runSettings(): RunSettings | undefined {
  return session.run.daily ? undefined : session.run.settings;
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
      { synergies: start.synergies },
    );
    session.saveReplay({ ...record, moves, evals, result });
    records.battle(result, 'w', worstDeficit, runSettings());
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
    return playManual(loaded, new ManualBattle(start.fen, session.board, [], seed), start.synergies);
  });
}

async function playManual(loaded: GameEngine, game: ManualBattle, synergies?: StartSynergies): Promise<BattleResult> {
  const record = session.startRecord(game.start, game.seed, true);
  try {
    const result = await battle.playManual(loaded, game, (state) => session.saveManual(state), synergies);
    session.saveReplay({ ...record, moves: [...game.moves], evals: [], result });
    records.battle(result, 'w', battle.manualWorstDeficit, runSettings());
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

/**
 * Android's back button: closes the window or screen on top, else does what Menu or Leave would.
 * Returns false on the menu, where there's nowhere further back.
 */
function goBack(): boolean {
  const dialog = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')].pop();
  if (dialog) {
    // Choices are read on submit (not on close), so closing is Cancel. A match's perk pick can't be skipped.
    if (dialog.id !== 'perk-dialog') dialog.close();
    return true;
  }
  if (guide.isOpen) guide.close();
  else if (!$('#profile').hidden || !$('#settings').hidden) showMenu();
  else if (document.body.classList.contains('in-lobby')) $('#lobby-leave').click();
  // Leave asks for a second tap, so a second press of back leaves the match.
  else if (match.active) $('#match-leave').click();
  else if (!$('#menu').hidden) return false;
  // The shop, a battle or a replay: Menu, which pauses a Play it game (it's disabled while an auto battle plays).
  else $('#menu-button').click();
  return true;
}

const ISOLATION_RELOAD_KEY = 'acc.isolation-reload';

/**
 * Without cross-origin isolation Fairy-Stockfish (a `fairy` build) can't run. A page that lost it (e.g. Safari restarted
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
  const { notice } = runSession.restore();
  const daily = dailySession.restore();
  if (daily.daily) recordDaily(daily.daily);
  renderHeader(session);
  showMenu([notice, daily.notice].filter(Boolean).join(' '));
  void listenForBack(goBack);
}

/**
 * In a `fairy` build, on hosts without COOP/COEP headers, coi-serviceworker reloads the page once on the
 * first visit to make it cross-origin isolated. Starting before that reload would save a default
 * run and skip the New run window, so wait for it; boot anyway if it never comes (e.g. service
 * workers blocked), and the engine reports the problem when a battle starts.
 */
const isolationReloadPending =
  USE_FAIRY && !window.crossOriginIsolated && window.isSecureContext && 'serviceWorker' in navigator;
if (isolationReloadPending) setTimeout(boot, 4000);
else boot();
