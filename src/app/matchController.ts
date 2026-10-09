import { plyLimit } from '../chess/boardSpec';
import type { Engine } from '../engine/stockfish';
import { runBattle } from '../game/runBattle';
import {
  alive,
  lossDamage,
  type MatchSettings,
  type Pairing,
  type PairingResult,
  START_HP,
  shopSeconds,
  streakBonus,
} from '../multi/match';
import { type MatchBattle, MatchSession, withKingPlaced } from '../multi/matchSession';
import { generateName, ordinal } from '../multi/names';
import type { RoomClient } from '../online/client';
import { botBattleComputer, canFinishRound, canStartBattle, resultKey, type Room, shopDeadline } from '../online/room';
import { randomSeed, seededRng } from '../rules/rng';
import { BattleAborted, type BattleScreen } from './battleScreen';
import { $, escapeHtml, sleep } from './dom';
import type { PlacementScreen } from './placementScreen';
import type { RecordBook } from './recordBook';

export interface MatchDeps {
  placement: PlacementScreen;
  battle: BattleScreen;
  /** The engine that plays the battle the player watches. */
  ensureEngine: () => Promise<Engine>;
  /** A second engine for battles the player doesn't watch, so they run alongside theirs. */
  backgroundEngine: () => Promise<Engine>;
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
  /** The round whose battles have started on this device. */
  fought: number;
  /** The round whose early bot-vs-bot battles this device has started computing. */
  botsComputed: number;
}

/**
 * Runs a 4-player match: the shop phase with a timer (Ready ends it early), then the round's
 * battles, health and knockouts, until the player is out or wins.
 *
 * Offline, the other seats are bots and this device computes every battle: the player's on screen,
 * the others on a background engine at the same time.
 *
 * Online, the room (src/online) keeps everyone in step. Each phone computes only its own battle and
 * reports the result; bot-vs-bot battles are computed by one person's phone (mostly during the shop,
 * when their armies are already known). The round ends once everyone has watched their battle and
 * all results are in (or after a timeout), and every phone applies it from the room's results, so all
 * health lists match. A phone that falls behind skips ahead when the room moves on.
 */
export class MatchController {
  private match: MatchSession | null = null;
  private online: Online | null = null;
  private timer = 0;
  private busy = false;
  /** Set when the room moved on while this phone's battle was still playing: apply the round once it stops. */
  private catchUp = false;
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
    this.begin();
  }

  /** Joins a started online match in `room` (from the lobby). */
  startOnline(client: RoomClient, room: Room): void {
    const m = new MatchSession(room.seed, client.uid, room.players, room.settings, Math.random);
    m.players = room.players;
    this.match = m;
    this.online = { client, code: room.code, room, stopWatching: () => {}, submitted: 0, fought: 0, botsComputed: 0 };
    this.online.stopWatching = client.watch(room.code, (r) => this.onRoom(r));
    // Share what's placed (types only) a moment after each change, so the next opponent can see it.
    let pending = 0;
    m.onArmyChange = (types) => {
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (this.match === m && this.online) void this.online.client.sharePreview(room.code, types).catch(console.warn);
      }, 800);
    };
    this.begin();
  }

  private begin(): void {
    document.body.classList.add('in-match');
    this.catchUp = false;
    // Load the engines now, while the player shops, rather than at the first battle.
    void this.deps.ensureEngine().catch(console.warn);
    void this.deps.backgroundEngine().catch(console.warn);
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
    if (this.online) {
      // Pieces carry over between rounds: share them right away for the new round's opponent.
      void this.online.client.sharePreview(this.online.code, m.placedTypes()).catch(console.warn);
      this.computeEarlyBotBattles();
    }
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
    if (canFinishRound(o.room, now)) void o.client.tryFinishRound(o.code, o.room.round).catch(console.warn);
  }

  /** Online: reacts to the room changing (shop closed → fight; round over → next shop). */
  private onRoom(room: Room | null): void {
    const o = this.online;
    const m = this.match;
    if (!o || !m || !room) return;
    o.room = room;
    m.previews = new Map(Object.entries(room.preview));
    if (m.phase === 'shop') this.deps.placement.refreshOpponent();
    if (room.phase === 'battle' && room.round === m.round && m.phase === 'shop' && o.fought < room.round) {
      o.fought = room.round;
      void this.fight();
    } else if (m.phase === 'battle' && (room.round > m.round || room.status === 'over')) {
      // The room has applied the round this phone was fighting.
      if (this.busy) {
        // Still playing (a slow phone, or the room timed out): stop and catch up.
        this.catchUp = true;
        this.deps.battle.abort();
      } else {
        this.applyRoomRound();
      }
    } else if (room.phase === 'battle') {
      // New results reported: keep the round card's summary of the other battles up to date.
      this.refreshOthers();
    }
    this.renderHud();
    this.tick();
  }

  /** Locks every army and plays the round's battles. */
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
    const { placement } = this.deps;
    placement.setBusy(true);
    try {
      const engine = await this.deps.ensureEngine();
      const o = this.online;
      const armies = o ? await o.client.fetchArmies(o.room) : new Map();
      if (stale()) return;
      m.lockArmies(armies);
      this.renderHud();
      placement.hide();
      const mine = m.myPairing();
      // Battles nobody is watching here: offline, all the others; online, bots-only ones not computed
      // yet, if it's this phone's job. They run on the background engine alongside the player's.
      const others = o
        ? this.isBotComputer()
          ? m.pairings.filter((p) => m.isBotsOnly(p) && !this.reported(p))
          : []
        : m.pairings.filter((p) => p !== mine);
      const background = this.computeInBackground(others, stale);
      const myResult = mine ? await this.playMine(engine, mine) : null;
      if (stale()) return;
      if (o) {
        if (myResult) void this.report(myResult);
        this.showRoundCard(myResult, false);
        return;
      }
      this.deps.battle.setStatus('Waiting for the other battles…');
      const results = [...(myResult ? [myResult] : []), ...(await background)];
      if (stale()) return;
      m.finishRound(results);
      this.renderHud();
      this.showRoundCard(myResult, true, results);
    } catch (err) {
      if (stale()) return;
      if (err instanceof BattleAborted) {
        if (this.catchUp) this.applyRoomRound();
        return;
      }
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

  /** Plays battles nobody watches here, one after another on the background engine. */
  private async computeInBackground(pairings: Pairing[], stale: () => boolean): Promise<PairingResult[]> {
    if (pairings.length === 0) return [];
    const engine = await this.deps.backgroundEngine();
    const m = this.match!;
    const out: PairingResult[] = [];
    for (const p of pairings) {
      if (stale()) break;
      const result = await this.compute(engine, m.battle(p), stale);
      out.push(result);
      if (this.online) void this.report(result);
    }
    return out;
  }

  /** Plays one battle without showing it (stopping early if `stale` turns true). */
  private async compute(engine: Engine, battle: MatchBattle, stale: () => boolean): Promise<PairingResult> {
    const { pairing, start } = battle;
    if (!start) return { pairing, winner: 'draw', material: { w: 0, b: 0 } };
    const board = this.match!.board;
    const result = await runBattle(
      start.fen,
      engine,
      seededRng(pairing.seed),
      async () => {
        if (stale()) throw new BattleAborted();
      },
      { plyLimit: plyLimit(board) },
      board,
    );
    return { pairing, winner: result.winner, material: result.material };
  }

  // ---- online: sharing results ----

  /** True when this phone computes the room's bot-vs-bot battles. */
  private isBotComputer(): boolean {
    return this.online !== null && botBattleComputer(this.online.room) === this.match?.myId;
  }

  private pairingIndex(pairing: Pairing): number {
    const m = this.match!;
    const list = m.pairings.length > 0 ? m.pairings : m.upcomingPairings();
    return list.findIndex((p) => p.white === pairing.white && p.black === pairing.black && p.copy === pairing.copy);
  }

  private reported(pairing: Pairing): boolean {
    const o = this.online!;
    return resultKey(this.match!.round, this.pairingIndex(pairing)) in o.room.results;
  }

  private async report(result: PairingResult): Promise<void> {
    const o = this.online;
    const m = this.match;
    if (!o || !m) return;
    const index = this.pairingIndex(result.pairing);
    if (index < 0) return;
    await o.client
      .reportResult(o.code, m.round, index, { winner: result.winner, material: result.material })
      .catch(console.warn);
  }

  /**
   * During the shop, the phone in charge computes battles between two bots: their armies and the
   * pairings are already known, and the background engine is idle.
   */
  private computeEarlyBotBattles(): void {
    const o = this.online!;
    const m = this.match!;
    if (o.botsComputed >= m.round || !this.isBotComputer()) return;
    o.botsComputed = m.round;
    const generation = this.generation;
    const round = m.round;
    const stale = () => generation !== this.generation || this.match?.round !== round;
    const early = m.upcomingPairings().filter((p) => m.armiesKnownEarly(p));
    void (async () => {
      if (early.length === 0) return;
      const engine = await this.deps.backgroundEngine();
      for (const p of early) {
        if (stale()) return;
        const result = await this.compute(engine, m.earlyBattle(p), stale);
        if (!stale()) await this.report(result);
      }
    })().catch((err) => {
      if (!(err instanceof BattleAborted)) console.warn(err);
    });
  }

  /**
   * The room has applied the round this phone fought: take its results (the same everywhere) for
   * health, streaks and income, then go to the next shop, or show the final place.
   */
  private applyRoomRound(): void {
    const o = this.online;
    const m = this.match;
    if (!o || !m || m.phase !== 'battle') return;
    this.catchUp = false;
    const results = m.pairings.map(
      (_, i) => o.room.results[resultKey(m.round, i)] ?? { winner: 'draw' as const, material: { w: 0, b: 0 } },
    );
    const full = results.map((r, i) => ({ pairing: m.pairings[i], winner: r.winner, material: r.material }));
    const mine = m.myPairing();
    const myResult = full.find((r) => r.pairing === mine) ?? null;
    m.finishRound(full);
    m.players = o.room.players;
    this.renderHud();
    if ((m.phase as string) === 'over') {
      this.showRoundCard(myResult, true, full);
      return;
    }
    if (this.deps.battle.isWaiting() || !this.deps.battle.cardShowing()) this.enterShop();
    else this.deps.battle.setCardButton(`Round ${m.round}`, () => this.enterShop());
  }

  // ---- round card ----

  /**
   * The round card: the player's result and health lost, and the other battles' results (online,
   * as they're reported). `final` means the round has been applied (offline always; online once the
   * room has moved on).
   */
  private showRoundCard(myResult: PairingResult | null, final: boolean, results?: PairingResult[]): void {
    const m = this.match!;
    const mySide = myResult?.pairing.white === m.myId ? 'w' : 'b';
    const outcome = !myResult || myResult.winner === 'draw' ? 'draw' : myResult.winner === mySide ? 'w' : 'b';
    const lost =
      final || !myResult || outcome !== 'b'
        ? (m.lastDamage.get(m.myId) ?? 0)
        : lossDamage(m.round, myResult.material[myResult.winner as 'w' | 'b']);
    const hpLeft = final ? Math.max(0, m.me.hp) : Math.max(0, m.me.hp - lost);
    const damageText =
      final || outcome === 'b'
        ? lost > 0
          ? `You lost ${lost} HP (${hpLeft} left).`
          : 'You took no damage.'
        : 'You took no damage.';
    const detail = () => [damageText, ...this.otherResults(myResult, results)].join(' ');

    if (final && m.phase === 'over') {
      const place = m.me.place ?? 1;
      this.deps.records.matchEnd(this.online !== null, m.settings.blitz, place);
      if (this.online) void this.online.client.markDone(this.online.code, this.online.fought).catch(console.warn);
      this.deps.battle.showCard({
        title: place === 1 ? 'You win the match!' : `You finished ${ordinal(place)}`,
        detail: detail(),
        tone: place === 1 ? 'w' : 'b',
        button: 'Back to menu',
        onButton: () => this.exit(),
      });
      return;
    }
    this.cardDetail = detail;
    this.deps.battle.showCard({
      title: outcome === 'w' ? 'Victory' : outcome === 'b' ? 'Defeat' : 'Draw',
      detail: detail(),
      tone: outcome,
      button: final ? `Round ${m.round}` : 'Continue',
      onButton: () => this.continueToShop(),
    });
  }

  /** Rebuilds the round card's text, for updating the other battles' results as they come in. */
  private cardDetail: (() => string) | null = null;

  private refreshOthers(): void {
    if (this.cardDetail && this.deps.battle.cardShowing()) this.deps.battle.setCardDetail(this.cardDetail());
  }

  /** "X beat Y." for each other battle with a result (online: those reported so far). */
  private otherResults(myResult: PairingResult | null, results?: PairingResult[]): string[] {
    const m = this.match!;
    const name = (id: string) => (id === m.myId ? 'You' : m.player(id).name);
    const known =
      results ??
      m.pairings.flatMap((pairing, i) => {
        const r = this.online?.room.results[resultKey(m.round, i)];
        return r ? [{ pairing, winner: r.winner, material: r.material }] : [];
      });
    const lines = known
      .filter((r) => r.pairing !== myResult?.pairing)
      .map((r) => {
        const { white, black, copy } = r.pairing;
        const whiteName = copy === 'w' ? `a copy of ${name(white)}` : name(white);
        const blackName = copy === 'b' ? `a copy of ${name(black)}` : name(black);
        if (r.winner === 'draw') return `${whiteName} drew with ${blackName}.`;
        const [winner, loser] = r.winner === 'w' ? [whiteName, blackName] : [blackName, whiteName];
        return `${winner} beat ${loser}.`;
      });
    const waiting = m.pairings.length - 1 - lines.length;
    if (!results && waiting > 0) lines.push('Other battles are still being played…');
    return lines;
  }

  /** After the round card: offline, straight to the shop; online, once everyone has finished the round. */
  private continueToShop(): void {
    const o = this.online;
    const m = this.match!;
    this.cardDetail = null;
    if (!o || m.phase === 'shop') {
      this.enterShop();
      return;
    }
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
