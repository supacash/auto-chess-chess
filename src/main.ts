import './style.css';
import { BattleScreen } from './app/battleScreen';
import { $ } from './app/dom';
import { renderHeader } from './app/header';
import { renderLayout } from './app/layout';
import { NewRunDialog } from './app/newRunDialog';
import { PlacementScreen } from './app/placementScreen';
import { Session } from './app/session';
import { loadRules } from './chess/loadRules';
import { Engine } from './engine/stockfish';
import type { RunSettings } from './rules/difficulty';
import { hasStarted, isRunOver } from './rules/run';

const rng = Math.random;

renderLayout($('#app'));
const session = new Session(rng);
const placement = new PlacementScreen(session, () => void fight());
const battle = new BattleScreen(() => {
  if (isRunOver(session.run)) openNewRun();
  else showPlacement();
});
const newRun = new NewRunDialog(startNewRun);
$('#new-run').addEventListener('click', openNewRun);

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

/** Loads the engine on first use, plays the round, and shows the result. */
async function fight(): Promise<void> {
  if (busy || session.armyErrors().length) return;
  busy = true;
  placement.setBusy(true);
  try {
    if (!engine) {
      placement.setMessage('Loading engine…');
      const [loaded] = await Promise.all([Engine.create(), loadRules()]);
      engine = loaded;
      placement.setMessage('');
    }
    const start = session.resolveStart();
    const spec = session.board;
    session.persist(true);
    placement.hide();
    const result = await battle.play(engine, start.fen, start.firstMover, spec, rng);
    const outcome = session.finishBattle(result);
    renderHeader(session, outcome.playedRound);
    battle.showResult(result, outcome, spec, session.run.lives, session.best);
  } catch (err) {
    console.error(err);
    session.persist(); // the battle never finished, so don't count it as abandoned
    showPlacement();
    placement.setMessage(`Battle failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    busy = false;
    placement.setBusy(false);
  }
}

function boot(): void {
  const { notice, firstVisit } = session.restore();
  showPlacement();
  placement.setMessage(notice);
  if (firstVisit) openNewRun();
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
