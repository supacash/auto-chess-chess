import type { PlacementSession } from '../app/placementSession';
import type { BoardSpec } from '../chess/boardSpec';
import type { Color } from '../chess/fen';
import type { Winner } from '../rules/battle';
import {
  BASE_INCOME,
  interest,
  type Offer,
  QUEEN_OFFER_ROUND,
  REROLL_COST,
  rerollOffers,
  restock,
  rollOffers,
  type Shop,
  type ShopResult,
  startingShop,
} from '../rules/economy';
import { makePiece, type Piece, type PieceType } from '../rules/pieces';
import { armyErrors, BENCH_SIZE, benchCount, canPlace, fitToBoard, pieceAt } from '../rules/placement';
import { startPosition } from '../rules/position';
import type { Rng } from '../rules/rng';
import {
  alive,
  applyRound,
  BLACK_GOLD,
  botArmy,
  type MatchPlayer,
  type MatchSettings,
  matchBoard,
  matchIncome,
  matchMode,
  matchOver,
  matchPicksOf,
  newPlayers,
  nextStreaks,
  type Pairing,
  type PairingResult,
  pairingOf,
  pairRound,
  roundDamage,
  START_HP,
} from './match';
import { CHEST_GOLD, countPerk, isPerkRound, type MatchPerkId, type PerkPicks, perkChoices, perksUpTo } from './perks';
import { botHoldings, type Holdings, holdingsOf, offerLeft, poolLeft, poolScale, sameHoldings } from './pool';

export type MatchPhase = 'shop' | 'battle' | 'over';

/** A battle ready to play: its pairing, start position and who moves first. */
export interface MatchBattle {
  pairing: Pairing;
  /** Null when both kings would start in check (the battle counts as a draw). */
  start: { fen: string; firstMover: Color } | null;
}

/**
 * One player's view of a 4-player match: their own shop and army, everyone's health, and the round
 * flow (shop → battle → next round). Bot armies and pairings come from the match seed, so this is
 * the same on every client. No DOM; the offline (vs bots) and online modes both drive it.
 */
export class MatchSession implements PlacementSession {
  readonly lastReplay = null;
  players: MatchPlayer[];
  round = 1;
  phase: MatchPhase = 'shop';
  shop: Shop;
  pairings: Pairing[] = [];
  /** Health each player lost last round, for the round summary. */
  lastDamage = new Map<string, number>();
  /** Each player's win (+n) or loss (−n) streak. */
  streaks = new Map<string, number>();
  private locked = new Map<string, Piece[]>();
  /** Other people's piece lists (types only, from the room) shown as previews during the shop. */
  previews = new Map<string, PieceType[]>();
  /** Called when the player's placed pieces change (online: shared as a preview, types only). */
  onArmyChange: ((types: PieceType[]) => void) | null = null;
  /** People's perk picks (the player's own included); bots' come from the seed. */
  picks = new Map<string, PerkPicks>();
  /** Other people's affinity pawns (online, from the room), for the shared pool. */
  held = new Map<string, Holdings>();
  /** Called when the player picks a perk (online: shared with the room). */
  onPerkPick: ((round: number, perk: MatchPerkId) => void) | null = null;
  /** Called when the player's affinity pawns change (online: shared with the room, for the pool). */
  onHeldChange: ((held: Holdings) => void) | null = null;
  private lastHeld: Holdings = {};
  /** The round the player last used Haggler's free reroll in. */
  private freeRerollRound = 0;
  /** The board the locked armies were placed on (for showing a player's last army). */
  lockedBoard: BoardSpec | null = null;
  /** The round the locked armies are for. */
  lockedRound: number | null = null;
  /** The locked round's pairings (kept after the round is applied, for watching its battles). */
  lockedPairings: Pairing[] = [];
  /** Everyone's health after each round (round 0 = the start), for scouting. */
  readonly health = new Map<number, Map<string, number>>();

  constructor(
    readonly seed: number,
    readonly myId: string,
    entries: { id: string; name: string; bot: boolean }[],
    readonly settings: MatchSettings,
    private readonly rng: Rng,
  ) {
    this.players = newPlayers(entries);
    const mode = matchMode(settings);
    const shop = startingShop(mode.startArmy);
    this.shop = { ...shop, gold: shop.gold + mode.extraGold };
    this.shop = { ...this.shop, offers: this.roll(1) };
    this.noteHealth(0);
  }

  /** Records everyone's health after `round`. */
  noteHealth(round: number): void {
    this.health.set(round, new Map(this.players.map((p) => [p.id, Math.max(0, p.hp)])));
  }

  /** A player's health after each round so far, from the start. */
  healthOf(id: string): number[] {
    return [...this.health.keys()]
      .sort((a, b) => a - b)
      .flatMap((r) => {
        const hp = this.health.get(r)!.get(id);
        return hp === undefined ? [] : [hp];
      });
  }

  /** A player's affinity pawns (the player's own, a person's as shared, a bot's from the seed). */
  holdingsOf(id: string): Holdings {
    if (id === this.myId) return holdingsOf(this.shop.pieces);
    return this.player(id).bot ? botHoldings(this.seed, this.round, id) : (this.held.get(id) ?? {});
  }

  /**
   * What a player is fielding this round, types only: a bot's army, a person's shared preview, or
   * the player's own placed pieces. Null when a person hasn't shared one.
   */
  currentTypes(id: string): PieceType[] | null {
    if (id === this.myId) return this.placedTypes();
    return this.player(id).bot
      ? botArmy(this.seed, this.round, id, this.settings).map((p) => p.type)
      : (this.previews.get(id) ?? null);
  }

  /** After being knocked out: on to the next round, to watch the others play it. */
  startSpectatorRound(): void {
    this.round++;
    this.pairings = [];
    this.phase = 'shop';
  }

  // ---- perks ----

  /** A player's perk picks (bots' from the seed). */
  picksOf(id: string): PerkPicks {
    return matchPicksOf(this.players, this.seed, this.round, Object.fromEntries(this.picks))(id);
  }

  /** The perks a player has so far (this round's pick included). */
  perksOf(id: string): MatchPerkId[] {
    return perksUpTo(this.picksOf(id), this.round);
  }

  /** The player's perk choices this round, or null when there's nothing to pick (or it's picked). */
  perkChoices(): MatchPerkId[] | null {
    if (this.phase !== 'shop' || this.me.place !== null || !isPerkRound(this.round)) return null;
    const mine = this.picks.get(this.myId) ?? {};
    if (mine[this.round]) return null;
    // Second wind would do nothing at full health: offer something else instead.
    const full = this.me.hp >= START_HP;
    return perkChoices(this.seed, this.round, this.myId, perksUpTo(mine, this.round - 1), full ? ['mend'] : []);
  }

  /** Picks one of this round's perk choices and applies what it does now (gold, a Knight). */
  choosePerk(perk: MatchPerkId): boolean {
    if (!this.perkChoices()?.includes(perk)) return false;
    this.picks.set(this.myId, { ...this.picks.get(this.myId), [this.round]: perk });
    if (perk === 'chest') this.shop = { ...this.shop, gold: this.shop.gold + CHEST_GOLD };
    if (perk === 'squire') {
      // A full bench gets the Knight's worth in gold instead.
      this.shop =
        benchCount(this.shop.pieces) < BENCH_SIZE
          ? { ...this.shop, pieces: [...this.shop.pieces, makePiece('N')] }
          : { ...this.shop, gold: this.shop.gold + 3 };
    }
    this.onPerkPick?.(this.round, perk);
    this.armyChanged();
    return true;
  }

  private myPerkCount(perk: MatchPerkId): number {
    return countPerk(this.perksOf(this.myId), perk);
  }

  /** Royal favour: queens and queen-pawns right away. */
  private queenRound(): number {
    return this.myPerkCount('favour') > 0 ? 1 : QUEEN_OFFER_ROUND;
  }

  rerollCost(): number {
    return this.myPerkCount('haggler') > 0 && this.freeRerollRound !== this.round ? 0 : REROLL_COST;
  }

  // ---- the shared pawn pool ----

  /** What's left in the pool: everyone still in holds some (the player, other people as shared, bots). */
  poolLeft(): ReturnType<typeof poolLeft> {
    return poolLeft(alive(this.players).map((p) => this.holdingsOf(p.id)));
  }

  /** How many of an offer are left in the pool (null: not a pooled offer). */
  offerLeft(offer: Offer): number | null {
    return offerLeft(this.poolLeft(), offer);
  }

  /** Fresh offers for `round`, weighted by what's left in the pool. */
  private roll(round: number): Offer[] {
    return rollOffers(round, this.rng, this.fairy, this.queenRound(), poolScale(this.poolLeft()));
  }

  /** This round's board (the room's mode: Classic 8×8, or Growing). */
  get board(): BoardSpec {
    return matchBoard(this.settings, this.round);
  }

  get fairy(): boolean {
    return this.settings.fairy === true;
  }

  get run() {
    return {
      shop: this.shop,
      round: this.round,
      color: 'w' as Color,
      settings: { fairy: this.fairy, reveal: false },
    };
  }

  get me(): MatchPlayer {
    return this.players.find((p) => p.id === this.myId)!;
  }

  player(id: string): MatchPlayer {
    return this.players.find((p) => p.id === id)!;
  }

  /**
   * The player's next opponent and the pieces they have placed (types only: squares stay secret
   * until the battle). Pairings come from the match seed, so they're known as soon as the shop opens.
   * Null when the player is out, or a person hasn't shared a preview yet.
   */
  opponent(): { name: string; pieces: Piece[] } | null {
    const pairing = pairingOf(pairRound(this.players, this.seed, this.round), this.myId);
    if (!pairing) return null;
    const otherSide = pairing.white === this.myId ? 'b' : 'w';
    const id = otherSide === 'w' ? pairing.white : pairing.black;
    const other = this.player(id);
    const name = pairing.copy === otherSide ? `a copy of ${other.name}` : other.name;
    const types = other.bot
      ? botArmy(this.seed, this.round, id, this.settings).map((p) => p.type)
      : (this.previews.get(id) ?? null);
    if (!types) return { name, pieces: [] };
    return { name, pieces: types.map((t) => makePiece(t)) };
  }

  armyErrors(): string[] {
    return armyErrors(this.shop.pieces, this.board);
  }

  setPieces(pieces: Piece[]): void {
    this.shop = { ...this.shop, pieces };
    this.armyChanged();
  }

  setShop(shop: Shop): void {
    this.shop = shop;
    this.armyChanged();
  }

  /** The types of the player's placed pieces (what a preview shows). */
  placedTypes(): PieceType[] {
    return this.shop.pieces.filter((p) => p.square).map((p) => p.type);
  }

  private armyChanged(): void {
    const held = holdingsOf(this.shop.pieces);
    if (!sameHoldings(held, this.lastHeld)) {
      this.lastHeld = held;
      this.onHeldChange?.(held);
    }
    if (this.phase === 'shop') this.onArmyChange?.(this.placedTypes());
  }

  rerollOffers(): ShopResult {
    const cost = this.rerollCost();
    const result = rerollOffers(
      this.shop,
      this.round,
      this.rng,
      this.fairy,
      cost,
      this.queenRound(),
      poolScale(this.poolLeft()),
    );
    if (result.ok && cost === 0) this.freeRerollRound = this.round;
    return result;
  }

  fitPiecesToBoard(): void {
    this.shop = { ...this.shop, pieces: fitToBoard(this.shop.pieces, this.board) };
  }

  /**
   * Ends the shop phase: places the king if the player forgot (so the timer can't leave them without
   * an army), freezes every army and pairs the players.
   */
  lockArmies(armies: Map<string, Piece[]> = new Map()): void {
    this.shop = { ...this.shop, pieces: withKingPlaced(this.shop.pieces, this.board) };
    this.locked = new Map();
    for (const p of alive(this.players)) {
      // Armies given (online: everyone's uploaded army, the player's own included) come first.
      const army =
        armies.get(p.id) ??
        (p.id === this.myId
          ? this.shop.pieces.filter((x) => x.square)
          : botArmy(this.seed, this.round, p.id, this.settings));
      this.locked.set(p.id, army);
    }
    this.pairings = pairRound(this.players, this.seed, this.round);
    this.lockedBoard = this.board;
    this.lockedRound = this.round;
    this.lockedPairings = this.pairings;
    this.phase = 'battle';
  }

  /** A player's locked army for this round. */
  army(id: string): Piece[] {
    return this.locked.get(id) ?? [];
  }

  /** The battle the player is in this round (null if they're out). */
  myPairing(): Pairing | null {
    return pairingOf(this.pairings, this.myId);
  }

  battle(pairing: Pairing): MatchBattle {
    // On the board the armies were locked on (the round may have moved on since, e.g. when watching).
    return this.battleBetween(
      pairing,
      this.army(pairing.white),
      this.army(pairing.black),
      this.lockedBoard ?? this.board,
    );
  }

  /** True when nobody but bots is in this battle (a copy of a person's army doesn't count as them). */
  isBotsOnly(pairing: Pairing): boolean {
    const person = (id: string, side: 'w' | 'b') => !this.player(id).bot && pairing.copy !== side;
    return !person(pairing.white, 'w') && !person(pairing.black, 'b');
  }

  /** True when both armies are bots' (and so known before the shop closes). */
  armiesKnownEarly(pairing: Pairing): boolean {
    return this.player(pairing.white).bot && this.player(pairing.black).bot;
  }

  /** A battle between two bots' armies, before the round's armies are locked (see armiesKnownEarly). */
  earlyBattle(pairing: Pairing): MatchBattle {
    const army = (id: string) => botArmy(this.seed, this.round, id, this.settings);
    return this.battleBetween(pairing, army(pairing.white), army(pairing.black), this.board);
  }

  /** This round's pairings, known from the seed as soon as the shop opens. */
  upcomingPairings(): Pairing[] {
    return pairRound(this.players, this.seed, this.round);
  }

  private battleBetween(pairing: Pairing, white: Piece[], black: Piece[], spec: BoardSpec): MatchBattle {
    // White moves first, as in chess (a king that starts in check still moves first).
    const start = startPosition(white, black, true, spec);
    return { pairing, start: start.ok ? { fen: start.fen, firstMover: start.firstMover } : null };
  }

  /**
   * Rejoining after a reload, in the room's `round`: the saved shop and streak, plus base income for
   * any rounds missed meanwhile (the player's last army fought them; their streak starts over).
   */
  resume(saved: { round: number; shop: Shop; streak: number }, round: number): void {
    const missed = Math.max(0, round - saved.round);
    this.round = round;
    this.shop =
      missed === 0
        ? saved.shop
        : {
            ...saved.shop,
            gold: saved.shop.gold + missed * BASE_INCOME,
            offers: this.roll(round),
          };
    this.streaks = new Map([[this.myId, missed === 0 ? saved.streak : 0]]);
    this.pairings = [];
    this.phase = 'shop';
  }

  /** Applies the round's results: health, knockouts, the player's income, then the next round's shop. */
  finishRound(results: PairingResult[]): void {
    const picksOf = (id: string) => this.picksOf(id);
    this.lastDamage = roundDamage(this.round, results, picksOf);
    this.streaks = nextStreaks(this.streaks, results);
    this.players = applyRound(this.players, this.round, results, picksOf);
    this.noteHealth(this.round);
    const mine = results.find((r) => r.pairing === this.myPairing());
    const myResult = mine ? fromSide(mine.winner, mine.pairing.white === this.myId ? 'w' : 'b') : 'draw';
    const playedBlack = mine !== undefined && mine.pairing.black === this.myId && mine.pairing.copy !== 'b';
    if (matchOver(this.players) || this.me.place !== null) {
      this.phase = 'over';
      return;
    }
    this.round++;
    const earned =
      matchIncome(myResult, this.streaks.get(this.myId) ?? 0) +
      (playedBlack ? BLACK_GOLD : 0) +
      interest(this.shop.gold) +
      this.myPerkCount('tithe');
    this.shop = {
      ...restock(this.shop, this.round, this.rng, this.fairy, this.queenRound(), poolScale(this.poolLeft())),
      gold: this.shop.gold + earned,
    };
    this.pairings = [];
    this.phase = 'shop';
  }
}

/** A result as seen by the player on `side` ('w' = they won). */
function fromSide(winner: Winner, side: Color): Winner {
  if (winner === 'draw') return 'draw';
  return winner === side ? 'w' : 'b';
}

/** Puts the king on the first free legal back-row square if it's still on the bench. */
export function withKingPlaced(pieces: Piece[], spec: BoardSpec): Piece[] {
  const king = pieces.find((p) => p.type === 'K');
  if (!king || king.square) return pieces;
  for (let rank = 0; rank < spec.homeRows; rank++) {
    for (const file of centreOut(spec.files)) {
      const sq = { file, rank };
      if (canPlace('K', sq, spec) && !pieceAt(pieces, sq)) {
        return pieces.map((p) => (p === king ? { ...p, square: sq } : p));
      }
    }
  }
  return pieces;
}

function centreOut(files: number): number[] {
  return Array.from({ length: files }, (_, i) => i).sort(
    (a, b) => Math.abs(a - (files - 1) / 2) - Math.abs(b - (files - 1) / 2),
  );
}
