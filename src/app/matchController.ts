import { plyLimit } from '../chess/boardSpec';
import type { Engine } from '../engine/stockfish';
import { runBattle } from '../game/runBattle';
import type { BattleResult } from '../rules/battle';
import { randomSeed, seededRng } from '../rules/rng';
import { alive, type MatchSettings, type Pairing, type PairingResult, START_HP, shopSeconds } from '../multi/match';
import { MatchSession } from '../multi/matchSession';
import { generateName, ordinal } from '../multi/names';
import type { BattleScreen } from './battleScreen';
import { $ } from './dom';
import type { PlacementScreen } from './placementScreen';

export interface MatchDeps {
  placement: PlacementScreen;
  battle: BattleScreen;
  ensureEngine: () => Promise<Engine>;
  /** Back to the single-player run. */
  onExit: () => void;
}

/**
 * Runs a 4-player match on this device: shop phase with a timer (Ready ends it early), then every
 * round's battles (yours animated, the others computed), health and knockouts, until the player is
 * out or wins. Offline for now: the other three seats are bots.
 */
export class MatchController {
  private match: MatchSession | null = null;
  private timer = 0;
  private deadline = 0;
  private busy = false;

  constructor(private readonly deps: MatchDeps) {}

  get active(): boolean {
    return this.match !== null;
  }

  /** Starts a match against three bots. */
  startOffline(settings: MatchSettings): void {
    const rng = Math.random;
    const entries = [
      { id: 'me', name: 'You', bot: false },
      ...[1, 2, 3].map((i) => ({ id: `bot${i}`, name: generateName(rng), bot: true })),
    ];
    this.match = new MatchSession(randomSeed(rng), 'me', entries, settings, rng);
    document.body.classList.add('in-match');
    this.enterShop();
  }

  /** Leaves the match (when it's over, or when a new single-player run starts). */
  exit(): void {
    this.stopTimer();
    this.match = null;
    document.body.classList.remove('in-match');
    $('#match-hud').hidden = true;
    this.deps.onExit();
  }

  private enterShop(): void {
    const m = this.match!;
    const { placement, battle } = this.deps;
    placement.use(m, { header: () => this.renderHud(), onReady: () => void this.fight() });
    battle.hide();
    placement.show();
    placement.setMessage('');
    this.startTimer(shopSeconds(m.settings));
  }

  private startTimer(seconds: number): void {
    this.stopTimer();
    this.deadline = Date.now() + seconds * 1000;
    this.renderTimer(seconds);
    this.timer = window.setInterval(() => {
      const left = Math.max(0, (this.deadline - Date.now()) / 1000);
      this.renderTimer(seconds, left);
      if (left <= 0) void this.fight();
    }, 250);
  }

  private stopTimer(): void {
    clearInterval(this.timer);
    this.timer = 0;
    $('#match-timer').textContent = '';
    $('#timer-fill').style.width = '0%';
  }

  /** Locks every army and plays the round: the player's battle animated, then the others. */
  private async fight(): Promise<void> {
    const m = this.match;
    if (!m || this.busy || m.phase !== 'shop') return;
    this.busy = true;
    this.stopTimer();
    const { placement, battle } = this.deps;
    placement.setBusy(true);
    try {
      const engine = await this.deps.ensureEngine();
      m.lockArmies();
      this.renderHud();
      placement.hide();
      const mine = m.myPairing();
      const results: PairingResult[] = [];
      if (mine) results.push(await this.playMine(engine, mine));
      battle.setStatus('Waiting for the other battles…');
      for (const p of m.pairings) if (p !== mine) results.push(await this.compute(engine, p));
      m.finishRound(results);
      this.renderHud();
      this.showRoundCard(mine, results);
    } catch (err) {
      console.error(err);
      placement.setMessage(`Battle failed: ${err instanceof Error ? err.message : String(err)}`);
      this.exit();
    } finally {
      this.busy = false;
      placement.setBusy(false);
    }
  }

  private async playMine(engine: Engine, pairing: Pairing): Promise<PairingResult> {
    const m = this.match!;
    const { start } = m.battle(pairing);
    if (!start) return { pairing, winner: 'draw', material: { w: 0, b: 0 } };
    const flip = pairing.black === m.myId;
    const other = m.player(flip ? pairing.white : pairing.black);
    const opponent = pairing.copy && !flip ? `a copy of ${other.name}` : other.name;
    const { result } = await this.deps.battle.play(
      engine,
      start.fen,
      start.firstMover,
      m.board,
      seededRng(pairing.seed),
      { flip, opponent },
    );
    return { pairing, winner: result.winner, material: result.material };
  }

  /** Plays a battle the player isn't in, without showing it. */
  private async compute(engine: Engine, pairing: Pairing): Promise<PairingResult> {
    const m = this.match!;
    const { start } = m.battle(pairing);
    if (!start) return { pairing, winner: 'draw', material: { w: 0, b: 0 } };
    const result: BattleResult = await runBattle(
      start.fen,
      engine,
      seededRng(pairing.seed),
      async () => {},
      { plyLimit: plyLimit(m.board) },
      m.board,
    );
    return { pairing, winner: result.winner, material: result.material };
  }

  private showRoundCard(mine: Pairing | null, results: PairingResult[]): void {
    const m = this.match!;
    const name = (id: string) => (id === m.myId ? 'You' : m.player(id).name);
    const lost = m.lastDamage.get(m.myId) ?? 0;
    const myResult = results.find((r) => r.pairing === mine);
    const mySide = mine?.white === m.myId ? 'w' : 'b';
    const outcome = !myResult || myResult.winner === 'draw' ? 'draw' : myResult.winner === mySide ? 'w' : 'b';
    const others = results
      .filter((r) => r !== myResult)
      .map((r) => {
        const { white, black, copy } = r.pairing;
        const blackName = copy ? `a copy of ${name(black)}` : name(black);
        if (r.winner === 'draw') return `${name(white)} drew with ${blackName}.`;
        const [winner, loser] = r.winner === 'w' ? [name(white), blackName] : [blackName, name(white)];
        return `${winner} beat ${loser}.`;
      });
    const damageText = lost > 0 ? `You lost ${lost} HP (${Math.max(0, m.me.hp)} left).` : 'You took no damage.';
    const detail = [damageText, ...others].join(' ');

    if (m.phase === 'over') {
      const place = m.me.place ?? 1;
      this.deps.battle.showCard({
        title: place === 1 ? 'You win the match!' : `You finished ${ordinal(place)}`,
        detail,
        tone: place === 1 ? 'w' : 'b',
        button: 'Back to single player',
        onButton: () => this.exit(),
      });
      return;
    }
    this.deps.battle.showCard({
      title: outcome === 'w' ? 'Victory' : outcome === 'b' ? 'Defeat' : 'Draw',
      detail,
      tone: outcome,
      button: `Round ${m.round}`,
      onButton: () => this.enterShop(),
    });
  }

  private renderTimer(total: number, left = total): void {
    $('#match-timer').textContent = `${Math.ceil(left)}s`;
    $('#timer-fill').style.width = `${(left / total) * 100}%`;
  }

  /** The players' health list and round, shown above the board during a match. */
  private renderHud(): void {
    const m = this.match;
    if (!m) return;
    $('#match-hud').hidden = false;
    const phase = m.phase === 'shop' ? 'Shop' : m.phase === 'battle' ? 'Battle' : 'Final';
    $('#match-round').textContent = `Round ${m.round} · ${phase} · ${alive(m.players).length} left`;
    const rows = [...m.players].sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.hp - a.hp);
    $('#match-players').innerHTML = rows
      .map((p) => {
        const hp = Math.max(0, p.hp);
        const lost = m.lastDamage.get(p.id);
        const classes = ['player', p.id === m.myId ? 'me' : '', p.place !== null && p.place > 1 ? 'out' : '']
          .filter(Boolean)
          .join(' ');
        const badge = p.place !== null ? `<span class="place">${ordinal(p.place)}</span>` : '';
        const hit = lost && m.phase === 'shop' ? `<span class="hit">−${lost}</span>` : '';
        return `<li class="${classes}">
          <span class="name">${p.id === m.myId ? 'You' : p.name}${p.bot ? ' <small>bot</small>' : ''}</span>
          <span class="hp-bar ${hp > 10 ? 'good' : hp > 5 ? 'warn' : 'low'}"><span style="width:${(hp / START_HP) * 100}%"></span></span>
          <span class="hp">${hp}</span>${hit}${badge}
        </li>`;
      })
      .join('');
  }
}
