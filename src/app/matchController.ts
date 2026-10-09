import { plyLimit } from '../chess/boardSpec';
import type { Engine } from '../engine/stockfish';
import { runBattle } from '../game/runBattle';
import {
  alive,
  type MatchSettings,
  type Pairing,
  type PairingResult,
  START_HP,
  shopSeconds,
  streakBonus,
} from '../multi/match';
import { MatchSession, withKingPlaced } from '../multi/matchSession';
import { generateName, ordinal } from '../multi/names';
import type { RoomClient } from '../online/client';
import { canFinishRound, canStartBattle, type Room, shopDeadline } from '../online/room';
import type { BattleResult } from '../rules/battle';
import { randomSeed, seededRng } from '../rules/rng';
import { BattleAborted, type BattleScreen } from './battleScreen';
import { $, escapeHtml, sleep } from './dom';
import type { PlacementScreen } from './placementScreen';
import type { RecordBook } from './recordBook';

export interface MatchDeps {
  placement: PlacementScreen;
  battle: BattleScreen;
  ensureEngine: () => Promise<Engine>;
  records: RecordBook;
  /** Back to the main menu. */
  onExit: () => void;
}

/** An online match's connection: the room it's played in and its latest state. */
interface Online {
  client: RoomClient;
  code: string;
  room: Room;
  stopWatching: () => void;
  /** The round whose army has been uploaded. */
  submitted: number;
  /** The round whose battles are being (or have been) played on this device. */
  fought: number;
  /** The round whose results this device has computed (so its health list is up to date). */
  computed: number;
  /** The round the player has finished watching (pressed Continue on). */
  finished: number;
}

/**
 * Runs a 4-player match: the shop phase with a timer (Ready ends it early), then the round's
 * battles (yours animated, the others computed), health and knockouts, until the player is out or
 * wins. Offline, the other seats are bots and everything happens on this device. Online, the room
 * (src/online) keeps everyone in step: armies are uploaded at Ready, the shop closes when all are
 * ready or time runs out, and the round ends when everyone has watched their battle.
 */
export class MatchController {
  private match: MatchSession | null = null;
  private online: Online | null = null;
  private timer = 0;
  private busy = false;
  /** Bumped when a match ends, so work still running for an old match knows to stop. */
  private generation = 0;

  constructor(private readonly deps: MatchDeps) {
    // Leaving takes a second tap. Online, the seat stays in the match (its last army keeps fighting).
    const leave = $<HTMLButtonElement>('#match-leave');
    let armed = 0;
    leave.addEventListener('click', () => {
      if (!this.match) return;
      if (armed) {
        clearTimeout(armed);
        armed = 0;
        leave.textContent = 'Leave';
        this.exit();
        return;
      }
      leave.textContent = 'Tap to leave';
      armed = window.setTimeout(() => {
        armed = 0;
        leave.textContent = 'Leave';
      }, 3000);
    });
  }

  get active(): boolean {
    return this.match !== null;
  }

  /** Starts a match against three bots on this device. */
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

  /** Joins a started online match in `room` (from the lobby). */
  startOnline(client: RoomClient, room: Room): void {
    const m = new MatchSession(room.seed, client.uid, room.players, room.settings, Math.random);
    m.players = room.players;
    this.match = m;
    this.online = {
      client,
      code: room.code,
      room,
      stopWatching: () => {},
      submitted: 0,
      fought: 0,
      computed: 0,
      finished: 0,
    };
    this.online.stopWatching = client.watch(room.code, (r) => this.onRoom(r));
    // Share what's placed (types only) a moment after each change, so the next opponent can see it.
    let pending = 0;
    m.onArmyChange = (types) => {
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (this.match === m && this.online) void this.online.client.sharePreview(room.code, types).catch(console.warn);
      }, 800);
    };
    document.body.classList.add('in-match');
    this.enterShop();
  }

  /** Leaves the match (when it's over, or when a new single-player run starts). */
  exit(): void {
    this.generation++;
    this.deps.battle.abort();
    this.stopTimer();
    this.online?.stopWatching();
    this.online = null;
    this.match = null;
    document.body.classList.remove('in-match');
    $('#match-hud').hidden = true;
    this.deps.onExit();
  }

  private enterShop(): void {
    const m = this.match!;
    const { placement, battle } = this.deps;
    placement.use(m, { header: () => this.renderHud(), onReady: () => void this.ready() });
    battle.hide();
    placement.show();
    placement.setMessage('');
    // Pieces carry over between rounds: share them right away for the new round's opponent.
    if (this.online) void this.online.client.sharePreview(this.online.code, m.placedTypes()).catch(console.warn);
    this.startTimer();
  }

  /** Ready (or time's up): offline, fight now; online, upload the army and wait for the others. */
  private async ready(): Promise<void> {
    const m = this.match;
    if (!m || m.phase !== 'shop') return;
    if (!this.online) {
      await this.fight();
      return;
    }
    const o = this.online;
    if (o.submitted === m.round) return;
    o.submitted = m.round;
    m.setPieces(withKingPlaced(m.shop.pieces, m.board));
    this.deps.placement.setBusy(true);
    this.deps.placement.setMessage('Ready! Waiting for the other players…');
    try {
      await o.client.submitArmy(o.room, m.shop.pieces);
    } catch (err) {
      // Too late (the shop already closed): the room uses this player's previous army.
      console.warn('Army upload failed', err);
    }
    this.tick();
  }

  /** Time left in the shop: from the room's server-side deadline online, else from when the shop opened. */
  private startTimer(): void {
    this.stopTimer();
    const m = this.match!;
    const total = shopSeconds(m.settings);
    const localDeadline = this.online ? null : Date.now() + total * 1000;
    const deadline = () => {
      if (localDeadline !== null) return localDeadline;
      const o = this.online!;
      const server = shopDeadline(o.room);
      return server === null ? null : server - (o.client.serverNow() - Date.now());
    };
    const update = () => {
      const end = deadline();
      const left = end === null ? total : Math.max(0, (end - Date.now()) / 1000);
      if (this.match?.phase === 'shop') this.renderTimer(total, left);
      if (end !== null && left <= 0) void this.ready();
      this.tick();
    };
    update();
    this.timer = window.setInterval(update, 250);
  }

  private stopTimer(): void {
    clearInterval(this.timer);
    this.timer = 0;
    $('#match-timer').textContent = '';
    $('#timer-fill').style.width = '0%';
  }

  /** Online: moves the room along when it's time (any player may; the transactions make it happen once). */
  private tick(): void {
    const o = this.online;
    if (!o) return;
    const now = o.client.serverNow();
    if (canStartBattle(o.room, now)) void o.client.tryStartBattle(o.code).catch(console.warn);
    if (canFinishRound(o.room, now) && this.match && o.computed === o.room.round) {
      void o.client.tryFinishRound(o.code, o.room.round, this.match.players).catch(console.warn);
    }
  }

  /** Online: reacts to the room changing (shop closed → fight; round over → next shop). */
  private onRoom(room: Room | null): void {
    const o = this.online;
    const m = this.match;
    if (!o || !m || !room) return;
    o.room = room;
    m.previews = new Map(Object.entries(room.preview));
    if (m.phase === 'shop') this.deps.placement.refreshOpponent();
    if (room.phase === 'battle' && room.round === m.round && o.fought < room.round) {
      o.fought = room.round;
      void this.fight();
    } else if (
      o.finished === o.fought &&
      o.fought > 0 &&
      room.phase === 'shop' &&
      room.round === m.round &&
      this.deps.battle.isWaiting()
    ) {
      // Everyone's done with the round we watched: take the room's health (the same as ours) and shop on.
      m.players = room.players;
      this.enterShop();
    }
    this.renderHud();
    this.tick();
  }

  /** Locks every army and plays the round: the player's battle animated, then the others. */
  private async fight(): Promise<void> {
    const m = this.match;
    if (!m || m.phase !== 'shop') return;
    // A battle from a match the player just left may still be winding down: let it finish first.
    while (this.busy) await sleep(100);
    if (this.match !== m || m.phase !== 'shop') return;
    const generation = this.generation;
    const stale = () => generation !== this.generation;
    this.busy = true;
    this.stopTimer();
    const { placement, battle } = this.deps;
    placement.setBusy(true);
    try {
      const engine = await this.deps.ensureEngine();
      const armies = this.online ? await this.online.client.fetchArmies(this.online.room) : new Map();
      if (stale()) return;
      m.lockArmies(armies);
      this.renderHud();
      placement.hide();
      const mine = m.myPairing();
      const results: PairingResult[] = [];
      if (mine) results.push(await this.playMine(engine, mine));
      if (stale()) return;
      battle.setStatus('Waiting for the other battles…');
      for (const p of m.pairings) {
        if (p !== mine) results.push(await this.compute(engine, p, stale));
        if (stale()) return;
      }
      m.finishRound(results);
      if (this.online) this.online.computed = this.online.fought;
      this.renderHud();
      this.showRoundCard(mine, results);
    } catch (err) {
      if (err instanceof BattleAborted || stale()) return;
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
    const otherSide = flip ? 'w' : 'b';
    const other = m.player(flip ? pairing.white : pairing.black);
    const opponent = pairing.copy === otherSide ? `a copy of ${other.name}` : other.name;
    const { result, worstDeficit } = await this.deps.battle.play(
      engine,
      start.fen,
      start.firstMover,
      m.board,
      seededRng(pairing.seed),
      { flip, opponent, announceSide: true },
    );
    this.deps.records.battle(result, flip ? 'b' : 'w', worstDeficit);
    return { pairing, winner: result.winner, material: result.material };
  }

  /** Plays a battle the player isn't in, without showing it (stopping early if `stale` turns true). */
  private async compute(engine: Engine, pairing: Pairing, stale: () => boolean): Promise<PairingResult> {
    const m = this.match!;
    const { start } = m.battle(pairing);
    if (!start) return { pairing, winner: 'draw', material: { w: 0, b: 0 } };
    const result: BattleResult = await runBattle(
      start.fen,
      engine,
      seededRng(pairing.seed),
      async () => {
        if (stale()) throw new BattleAborted();
      },
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
        const whiteName = copy === 'w' ? `a copy of ${name(white)}` : name(white);
        const blackName = copy === 'b' ? `a copy of ${name(black)}` : name(black);
        if (r.winner === 'draw') return `${whiteName} drew with ${blackName}.`;
        const [winner, loser] = r.winner === 'w' ? [whiteName, blackName] : [blackName, whiteName];
        return `${winner} beat ${loser}.`;
      });
    const damageText = lost > 0 ? `You lost ${lost} HP (${Math.max(0, m.me.hp)} left).` : 'You took no damage.';
    const detail = [damageText, ...others].join(' ');

    if (m.phase === 'over') {
      const place = m.me.place ?? 1;
      this.deps.records.matchEnd(this.online !== null, m.settings.blitz, place);
      if (this.online) void this.online.client.markDone(this.online.code, this.online.fought).catch(console.warn);
      this.deps.battle.showCard({
        title: place === 1 ? 'You win the match!' : `You finished ${ordinal(place)}`,
        detail,
        tone: place === 1 ? 'w' : 'b',
        button: 'Back to menu',
        onButton: () => this.exit(),
      });
      return;
    }
    this.deps.battle.showCard({
      title: outcome === 'w' ? 'Victory' : outcome === 'b' ? 'Defeat' : 'Draw',
      detail,
      tone: outcome,
      button: `Round ${m.round}`,
      onButton: () => this.continueToShop(),
    });
  }

  /** After the round card: offline, straight to the shop; online, once everyone has finished the round. */
  private continueToShop(): void {
    const o = this.online;
    if (!o) {
      this.enterShop();
      return;
    }
    o.finished = o.fought;
    this.deps.battle.showWaiting('Waiting for the other players to finish their battles…');
    void o.client
      .markDone(o.code, o.fought)
      .then(() => this.tick())
      .catch(console.warn);
    this.startWaitingTicks();
    this.onRoom(o.room);
  }

  /** Online, between rounds: keeps checking whether the round can end (e.g. someone's timed out). */
  private startWaitingTicks(): void {
    this.stopTimer();
    this.timer = window.setInterval(() => this.tick(), 1000);
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
    const room = this.online ? ` · Room ${this.online.code}` : '';
    $('#match-round').textContent = `Round ${m.round} · ${phase} · ${alive(m.players).length} left${room}`;
    const rows = [...m.players].sort((a, b) => (a.place ?? 0) - (b.place ?? 0) || b.hp - a.hp);
    const ready = this.online?.room.ready ?? {};
    $('#match-players').innerHTML = rows
      .map((p) => {
        const hp = Math.max(0, p.hp);
        const lost = m.lastDamage.get(p.id);
        const classes = ['player', p.id === m.myId ? 'me' : '', p.place !== null && p.place > 1 ? 'out' : '']
          .filter(Boolean)
          .join(' ');
        const badge = p.place !== null ? `<span class="place">${ordinal(p.place)}</span>` : '';
        const hit = lost && m.phase === 'shop' ? `<span class="hit">−${lost}</span>` : '';
        const isReady =
          this.online && !p.bot && m.phase === 'shop' && ready[p.id] === m.round ? ' <small>✓ ready</small>' : '';
        const streak = m.streaks.get(p.id) ?? 0;
        const streakTag =
          Math.abs(streak) >= 2
            ? ` <small class="streak ${streak > 0 ? 'hot' : 'cold'}" title="${Math.abs(streak)} ${streak > 0 ? 'wins' : 'losses'} in a row: +${streakBonus(streak)} gold">${streak > 0 ? '🔥' : '❄️'}${Math.abs(streak)}</small>`
            : '';
        const tag = (p.bot ? ' <small>bot</small>' : isReady) + streakTag;
        return `<li class="${classes}">
          <span class="name">${p.id === m.myId ? 'You' : escapeHtml(p.name)}${tag}</span>
          <span class="hp-bar ${hp > 10 ? 'good' : hp > 5 ? 'warn' : 'low'}"><span style="width:${(hp / START_HP) * 100}%"></span></span>
          <span class="hp">${hp}</span><span class="extra">${hit || badge}</span>
        </li>`;
      })
      .join('');
  }
}
