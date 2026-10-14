import { plyLimit } from '../chess/boardSpec';
import type { Engine } from '../engine/engine';
import { battleAchievements, matchAchievements, SPECTER_WATCHES } from '../game/achievements';
import { runBattle } from '../game/runBattle';
import {
  alive,
  type MatchSettings,
  type Pairing,
  type PairingResult,
  roundDamage,
  START_HP,
  shopSeconds,
  streakBonus,
} from '../multi/match';
import { matchPerk, perksUpTo } from '../multi/perks';
import { type MatchBattle, MatchSession, withKingPlaced } from '../multi/matchSession';
import { generateName, ordinal } from '../multi/names';
import type { RoomClient } from '../online/client';
import { botBattleComputer, canFinishRound, canStartBattle, resultKey, type Room, shopDeadline } from '../online/room';
import { clearMatch, type SavedMatch, saveMatch } from '../game/storage';
import { randomSeed, seededRng } from '../rules/rng';
import { BattleAborted, type BattleScreen, type CardButton } from './battleScreen';
import { $, escapeHtml, sleep } from './dom';
import { PerkDialog } from './perkDialog';
import type { PlacementScreen } from './placementScreen';
import { ScoutDialog } from './scoutDialog';
import type { RecordBook } from './recordBook';

/** How long the other phones wait before moving the room along themselves (see MatchController.tick). */
const FALLBACK_MS = 2_000;

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
  private readonly perkDialog = new PerkDialog();
  private readonly scout = new ScoutDialog();
  /** True while the player watches another battle of the round. */
  private watching = false;
  /** Knocked out and watching the rest of the match. */
  private spectating = false;
  /** Battles watched after being knocked out, this match (Specter). */
  private spectatorWatches = 0;
  /** Offline spectating: the last round's results. */
  private spectatorResults: PairingResult[] = [];
  /** Shows the card the player was on again (after watching a battle). */
  private lastCard: (() => void) | null = null;
  /** The match's result has been recorded (once, however often the final card is shown). */
  private recorded = false;

  constructor(private readonly deps: MatchDeps) {
    // Scouting: tap a player in the health list.
    $('#match-players').addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('li[data-id]');
      if (row && this.match) this.scout.open(this.match, row.dataset.id!);
    });
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

  /**
   * Joins a started online match in `room`: from the lobby, or rejoining one after a reload with
   * what this device saved (its shop and streak).
   */
  startOnline(client: RoomClient, room: Room, saved: SavedMatch | null = null): void {
    const m = new MatchSession(room.seed, client.uid, room.players, room.settings, Math.random);
    m.players = room.players;
    this.syncShared(m, room);
    if (saved) m.resume(saved, room.round);
    this.match = m;
    const o: Online = {
      client,
      code: room.code,
      room,
      stopWatching: () => {},
      submitted: 0,
      fought: 0,
      botsComputed: 0,
    };
    this.online = o;
    const inBattle = room.phase === 'battle';
    // Rejoining after this device already finished the round's battle: wait for the others.
    const finished = inBattle && room.done[client.uid] === room.round;
    if (finished) o.fought = room.round;
    if (!inBattle && room.ready[client.uid] === room.round) o.submitted = room.round;
    o.stopWatching = client.watch(room.code, (r) => this.onRoom(r));
    // Share what's placed (types only) a moment after each change, so the next opponent can see it.
    let pending = 0;
    m.onArmyChange = (types) => {
      this.save();
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        if (this.match === m && this.online) void this.online.client.sharePreview(room.code, types).catch(console.warn);
      }, 800);
    };
    // Perk picks and affinity pawns (for the shared pool) go to the room as they happen.
    m.onPerkPick = (round, perk) => {
      if (this.match === m && this.online)
        void this.online.client.sharePerk(room.code, round, perk).catch(console.warn);
    };
    m.onHeldChange = (held) => {
      if (this.match === m && this.online) void this.online.client.shareHeld(room.code, held).catch(console.warn);
    };
    this.begin();
    if (finished) {
      m.lockArmies();
      this.stopTimer();
      this.deps.placement.hide();
      this.deps.battle.showWaiting('Waiting for the other players to finish their battles…');
      this.startWaitingTicks();
      this.renderHud();
    } else if (o.submitted === room.round) {
      this.deps.placement.setBusy(true);
      this.deps.placement.setMessage('Ready! Waiting for the other players…');
    }
  }

  /** Online: takes other people's perk picks and affinity pawns from the room (the player's own stay local). */
  private syncShared(m: MatchSession, room: Room): void {
    const mine = { ...room.perks[m.myId], ...m.picks.get(m.myId) };
    m.picks = new Map(Object.entries({ ...room.perks, [m.myId]: mine }));
    m.held = new Map(Object.entries(room.held).filter(([id]) => id !== m.myId));
  }

  /** Opens the perk pick when this round has one the player hasn't made. */
  private offerPerk(): void {
    const m = this.match;
    const choices = m?.perkChoices();
    if (!m || !choices) return;
    const owned = perksUpTo(m.picksOf(m.myId), m.round - 1).map(matchPerk);
    this.perkDialog.open(choices, owned, (perk) => {
      if (this.match !== m || !m.choosePerk(perk)) return;
      this.deps.placement.refresh();
      this.renderHud();
    });
  }

  /** Online: keeps this device's side of the match (shop, streak) so a reload can rejoin it. */
  private save(): void {
    const m = this.match;
    if (!this.online || !m) return;
    saveMatch({
      code: this.online.code,
      uid: m.myId,
      round: m.round,
      shop: m.shop,
      streak: m.streaks.get(m.myId) ?? 0,
      at: Date.now(),
    });
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
    this.perkDialog.close();
    this.watching = false;
    this.spectating = false;
    this.spectatorResults = [];
    this.spectatorWatches = 0;
    this.lastCard = null;
    this.recorded = false;
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
    this.offerPerk();
    if (this.online) {
      this.save();
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
    this.perkDialog.pickFirst(); // time's up (or Ready) with the perk still to pick
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
    const step = `${o.room.round}:${o.room.phase}`;
    const due = canStartBattle(o.room, now) || canFinishRound(o.room, now);
    if (!due) return;
    // One phone moves the room along (the first person still in); the others step in only if it
    // hasn't a moment later (it left, or is slow). Fewer clashing transactions that way.
    if (this.dueSince?.step !== step) this.dueSince = { step, at: Date.now() };
    const lead = botBattleComputer(o.room) === this.match?.myId;
    if (!lead && Date.now() - this.dueSince.at < FALLBACK_MS) return;
    if (o.room.phase === 'shop') void o.client.tryStartBattle(o.code).catch(console.warn);
    else void o.client.tryFinishRound(o.code, o.room.round).catch(console.warn);
  }

  /** When this phone first saw the room's current step due (see tick). */
  private dueSince: { step: string; at: number } | null = null;

  /** Online: reacts to the room changing (shop closed → fight; round over → next shop). */
  private onRoom(room: Room | null): void {
    const o = this.online;
    const m = this.match;
    if (!o || !m || !room) return;
    o.room = room;
    m.previews = new Map(Object.entries(room.preview));
    if (this.spectating) {
      void this.onSpectatedRoom(room);
      return;
    }
    const poolBefore = JSON.stringify(m.poolLeft());
    this.syncShared(m, room);
    if (m.phase === 'shop') {
      this.deps.placement.refreshOpponent();
      if (JSON.stringify(m.poolLeft()) !== poolBefore) this.deps.placement.refreshShop();
    }
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
    this.perkDialog.pickFirst();
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
    const { result, worstDeficit, moves } = await this.deps.battle.play(
      engine,
      start.fen,
      start.firstMover,
      m.board,
      seededRng(pairing.seed),
      { flip, opponent, announceSide: true },
    );
    this.deps.records.battle(result, flip ? 'b' : 'w', worstDeficit);
    this.deps.records.unlock(
      battleAchievements({ fen: start.fen, moves, spec: m.board, side: flip ? 'b' : 'w', result, worstDeficit }),
    );
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
    m.noteHealth((m.phase as string) === 'over' ? m.round : m.round - 1);
    this.renderHud();
    if (this.watching) {
      // Watching another battle: stop it and come back to this round's card, now final.
      this.lastCard = () => this.showRoundCard(myResult, true, full);
      this.deps.battle.abort();
      return;
    }
    if ((m.phase as string) === 'over') {
      this.showRoundCard(myResult, true, full);
      return;
    }
    if (this.deps.battle.isWaiting() || !this.deps.battle.cardShowing()) this.enterShop();
    else this.deps.battle.setCardButton(`On to round ${m.round}`, () => this.enterShop());
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
        : (roundDamage(m.round, [myResult], (id) => m.picksOf(id)).get(m.myId) ?? 0);
    const hpLeft = final ? Math.max(0, m.me.hp) : Math.max(0, m.me.hp - lost);
    const damageText =
      final || outcome === 'b'
        ? lost > 0
          ? `You lost ${lost} HP (${hpLeft} left).`
          : 'You took no damage.'
        : 'You took no damage.';
    const detail = () => [damageText, ...this.otherResults(myResult, results)].join(' ');
    this.lastCard = () => this.showRoundCard(myResult, final, results);
    const watch = this.watchButtons(m.lockedPairings.filter((p) => p !== myResult?.pairing));

    if (final && m.phase === 'over') {
      const place = m.me.place ?? 1;
      if (!this.recorded) {
        this.recorded = true;
        // An online match only counts as online with at least one other person in it: a quick play
        // room that filled up with bots is recorded as a match against bots.
        const withPeople = m.players.some((p) => !p.bot && p.id !== m.myId);
        this.deps.records.matchEnd(this.online !== null && withPeople, m.settings.blitz, place);
        const winner = m.players.find((p) => p.place === 1);
        this.deps.records.unlock(matchAchievements(place, m.myLosses, winner ? winner.hp : 0));
        if (this.online) clearMatch();
        if (this.online) void this.online.client.markDone(this.online.code, this.online.fought).catch(console.warn);
      }
      // Knocked out while others play on: they can stay and watch the rest.
      const goesOn = this.online ? this.online.room.status !== 'over' : alive(m.players).length > 1;
      this.deps.battle.showCard({
        title: place === 1 ? 'You win the match!' : `You finished ${ordinal(place)}`,
        detail: detail(),
        tone: place === 1 ? 'w' : 'b',
        button: 'Back to menu',
        onButton: () => this.exit(),
        extras: [...watch, ...(goesOn ? [{ label: 'Keep watching the match', onClick: () => this.spectate() }] : [])],
      });
      return;
    }
    this.cardDetail = detail;
    this.deps.battle.showCard({
      title: outcome === 'w' ? 'Victory' : outcome === 'b' ? 'Defeat' : 'Draw',
      detail: detail(),
      tone: outcome,
      button: final ? `On to round ${m.round}` : 'Continue',
      onButton: () => this.continueToShop(),
      extras: watch,
    });
    // Both kings would have started in check: nothing was played (the board shows an earlier game).
    if (myResult && !m.battle(myResult.pairing).start) {
      this.deps.battle.setStatus('Both kings would start in check, so this battle is a draw');
    }
  }

  // ---- watching other battles ----

  /** A Watch button for each of `pairings` that was played. */
  private watchButtons(pairings: Pairing[]): CardButton[] {
    const m = this.match!;
    // A battle that never started (both kings in check) has nothing to watch.
    pairings = pairings.filter((p) => m.battle(p).start !== null);
    return pairings.map((p) => ({
      label: `Watch ${this.sideNames(p).join(' vs ')}`,
      onClick: () => void this.watch(p),
    }));
  }

  /** The names of a battle's sides (White first), "a copy of …" for a copied army. */
  private sideNames(p: Pairing): [string, string] {
    const m = this.match!;
    const name = (id: string) => (id === m.myId ? 'You' : m.player(id).name);
    return [
      p.copy === 'w' ? `a copy of ${p.white === m.myId ? 'you' : name(p.white)}` : name(p.white),
      p.copy === 'b' ? `a copy of ${p.black === m.myId ? 'you' : name(p.black)}` : name(p.black),
    ];
  }

  /**
   * Plays another battle of the round on screen. Battles are deterministic from their armies and
   * seed, so it goes exactly as it did on whichever phone computed it. Afterwards, back to the card.
   */
  private async watch(pairing: Pairing): Promise<void> {
    const m = this.match;
    if (!m || this.watching || this.busy) return;
    const { start } = m.battle(pairing);
    if (!start) return;
    const o = this.online;
    // Online: watching mustn't hold the others up, so this player's round counts as finished now.
    if (o && !this.spectating && m.phase === 'battle' && o.fought === m.round) {
      void o.client
        .markDone(o.code, o.fought)
        .then(() => this.tick())
        .catch(console.warn);
    }
    const generation = this.generation;
    const [white, black] = this.sideNames(pairing);
    this.watching = true;
    this.cardDetail = null;
    if (this.spectating && ++this.spectatorWatches >= SPECTER_WATCHES) this.deps.records.unlock(['specter']);
    // Hide the card at once: its buttons mustn't be usable while the replay starts up.
    this.deps.battle.showWaiting(`Watching ${white} (White) vs ${black} (Black)`);
    try {
      const engine = await this.deps.ensureEngine();
      await this.deps.battle.play(
        engine,
        start.fen,
        start.firstMover,
        m.lockedBoard ?? m.board,
        seededRng(pairing.seed),
        { watching: `Watching ${white} (White) vs ${black} (Black)` },
      );
    } catch (err) {
      if (!(err instanceof BattleAborted)) console.warn(err);
    } finally {
      this.watching = false;
    }
    if (generation !== this.generation || this.match !== m) return;
    this.lastCard?.();
  }

  // ---- watching the rest of the match after being knocked out ----

  private spectate(): void {
    const m = this.match;
    if (!m) return;
    this.spectating = true;
    this.renderHud();
    if (this.online) {
      void this.onSpectatedRoom(this.online.room);
      return;
    }
    void this.spectateRoundOffline();
  }

  /** Offline: plays the bots' next round (on the background engine), then shows its results. */
  private async spectateRoundOffline(): Promise<void> {
    const m = this.match;
    if (!m || this.busy) return;
    const generation = this.generation;
    const stale = () => generation !== this.generation;
    m.startSpectatorRound();
    m.lockArmies();
    this.renderHud();
    this.deps.battle.showWaiting(`Round ${m.round}: the others are playing their battles…`);
    this.busy = true;
    try {
      const results = await this.computeInBackground(m.pairings, stale);
      if (stale()) return;
      m.finishRound(results);
      this.spectatorResults = results;
    } catch (err) {
      if (!(err instanceof BattleAborted)) console.warn(err);
      return;
    } finally {
      this.busy = false;
    }
    this.renderHud();
    this.showSpectatorCard();
  }

  /** Online: follows the room as a spectator (the armies of each round once its shop closes). */
  private async onSpectatedRoom(room: Room): Promise<void> {
    const o = this.online;
    const m = this.match;
    if (!o || !m) return;
    const roundOver = room.round > m.round || room.status === 'over';
    m.players = room.players;
    if (roundOver) m.noteHealth(room.status === 'over' ? room.round : room.round - 1);
    if (room.phase === 'battle' && room.round > (m.lockedRound ?? 0) && !this.busy) {
      this.busy = true;
      try {
        const armies = await o.client.fetchArmies(room);
        if (this.online !== o) return;
        m.round = room.round;
        m.phase = 'shop';
        m.lockArmies(armies);
      } finally {
        this.busy = false;
      }
    }
    this.renderHud();
    if (!this.watching) this.showSpectatorCard();
  }

  /** The spectator's card: the latest round's results so far, a Watch button for each battle. */
  private showSpectatorCard(): void {
    const m = this.match!;
    const o = this.online;
    this.lastCard = () => this.showSpectatorCard();
    const results = o
      ? m.lockedPairings.flatMap((pairing, i) => {
          const r = o.room.results[resultKey(m.lockedRound ?? m.round, i)];
          return r ? [{ pairing, winner: r.winner, material: r.material }] : [];
        })
      : this.spectatorResults;
    const winner = m.players.find((p) => p.place === 1);
    const lines = results.map((r) => this.describeResult(r));
    if (o && !winner) {
      if (m.lockedPairings.length === 0 || o.room.round > (m.lockedRound ?? m.round))
        lines.push(`Round ${o.room.round}: the others are shopping…`);
      else if (results.length < m.lockedPairings.length) lines.push('Other battles are still being played…');
    }
    const next = !o && !winner;
    this.deps.battle.showCard({
      title: winner ? `${winner.id === m.myId ? 'You' : winner.name} won the match` : `Watching · round ${m.round}`,
      detail: lines.join(' '),
      tone: 'draw',
      button: next ? `On to round ${m.round + 1}` : 'Back to menu',
      onButton: next ? () => void this.spectateRoundOffline() : () => this.exit(),
      extras: [
        ...this.watchButtons(m.lockedPairings),
        ...(next ? [{ label: 'Back to menu', onClick: () => this.exit() }] : []),
      ],
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
    const known =
      results ??
      m.pairings.flatMap((pairing, i) => {
        const r = this.online?.room.results[resultKey(m.round, i)];
        return r ? [{ pairing, winner: r.winner, material: r.material }] : [];
      });
    const lines = known.filter((r) => r.pairing !== myResult?.pairing).map((r) => this.describeResult(r));
    const waiting = m.pairings.length - 1 - lines.length;
    if (!results && waiting > 0) lines.push('Other battles are still being played…');
    return lines;
  }

  /** "X beat Y." or "X drew with Y." */
  private describeResult(r: PairingResult): string {
    const [whiteName, blackName] = this.sideNames(r.pairing);
    const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
    if (r.winner === 'draw') return `${upper(whiteName)} drew with ${blackName}.`;
    const [winner, loser] = r.winner === 'w' ? [whiteName, blackName] : [blackName, whiteName];
    return `${upper(winner)} beat ${loser}.`;
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
    const phase = this.spectating
      ? 'Watching'
      : m.phase === 'shop'
        ? 'Shop'
        : m.phase === 'battle'
          ? 'Battle'
          : 'Final';
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
        const badge = p.place !== null ? `<span class="place">${escapeHtml(ordinal(p.place))}</span>` : '';
        const hit = lost && m.phase === 'shop' ? `<span class="hit">−${lost}</span>` : '';
        const isReady =
          this.online && !p.bot && m.phase === 'shop' && ready[p.id] === m.round ? ' <small>✓ ready</small>' : '';
        const streak = m.streaks.get(p.id) ?? 0;
        const streakTag =
          Math.abs(streak) >= 2
            ? ` <small class="streak ${streak > 0 ? 'hot' : 'cold'}" title="${Math.abs(streak)} ${streak > 0 ? 'wins' : 'losses'} in a row: +${streakBonus(streak)} gold">${streak > 0 ? '🔥' : '❄️'}${Math.abs(streak)}</small>`
            : '';
        const perks = m.perksOf(p.id).map(matchPerk);
        const perkTag = perks.length
          ? ` <small class="perks" title="${escapeHtml(perks.map((x) => x.name).join(', '))}">${perks.map((x) => x.icon).join('')}</small>`
          : '';
        const tag = (p.bot ? ' <small>bot</small>' : isReady) + streakTag + perkTag;
        return `<li class="${classes}" data-id="${escapeHtml(p.id)}" title="Scout ${p.id === m.myId ? 'yourself' : escapeHtml(p.name)}">
          <span class="name">${p.id === m.myId ? 'You' : escapeHtml(p.name)}${tag}</span>
          <span class="hp-bar ${hp > START_HP / 2 ? 'good' : hp > START_HP / 4 ? 'warn' : 'low'}"><span style="width:${(hp / START_HP) * 100}%"></span></span>
          <span class="hp">${hp}</span><span class="extra">${hit || badge}</span>
        </li>`;
      })
      .join('');
  }
}
