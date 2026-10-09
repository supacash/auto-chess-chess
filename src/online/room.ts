import { BOARD_8 } from '../chess/boardSpec';
import {
  applyRound,
  type MatchPlayer,
  type MatchSettings,
  MATCH_SIZE,
  newPlayers,
  type Pairing,
  type PairingResult,
  pairRound,
  shopSeconds,
} from '../multi/match';
import type { Winner } from '../rules/battle';
import { isPieceType, makePiece, type Piece, type PieceType } from '../rules/pieces';
import { armyErrors } from '../rules/placement';
import { type Rng, randomInt } from '../rules/rng';

// An online room: up to 4 people join with a code, empty seats become bots when the host starts,
// and then everyone plays the same match (src/multi). This file is the pure part: the shape of the
// shared room document and the rules for moving it along. src/online/client.ts stores it in Firestore.

export const ROOM_CODE_LENGTH = 4;
/** No I or O, so codes can't be misread as 1 or 0. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
/** Extra time after the shop deadline before anyone may start the battles (slow uploads, clock skew). */
export const SHOP_GRACE_MS = 3_000;
/** How long the battle phase waits for everyone to finish watching before moving on anyway. */
export const BATTLE_TIMEOUT_MS = 120_000;
/** Quick play: a room starts this long after the last person joined (with bots in empty seats), or once full. */
export const QUICK_WAIT_MS = 30_000;
/**
 * Quick play only joins rooms someone joined this recently. Older ones have started, or everyone in
 * them closed the page before it could (their seats would be ghosts).
 */
export const QUICK_FRESH_MS = QUICK_WAIT_MS + 10_000;

export type RoomStatus = 'lobby' | 'playing' | 'over';
export type RoomPhase = 'shop' | 'battle' | 'over';

export interface Seat {
  /** The signed-in player in this seat, or null for an empty seat (a bot once the match starts). */
  uid: string | null;
  name: string;
}

/** The shared room document. Player ids are uids for people and `bot1`…`bot3` for bots. */
export interface Room {
  code: string;
  host: string;
  /** A quick play room: found by anyone looking for a match in its mode, and started automatically. */
  quick: boolean;
  /** When the room was created (server ms; null until the server has set it). */
  createdAt: number | null;
  /** When someone last took a seat (server ms; null until set). Quick rooms start QUICK_WAIT_MS after it. */
  waitingSince: number | null;
  status: RoomStatus;
  settings: MatchSettings;
  seats: Seat[];
  seed: number;
  round: number;
  phase: RoomPhase;
  /** When the current phase started (server time, ms); null until the server has set it. */
  phaseStartedAt: number | null;
  players: MatchPlayer[];
  /** The round each person last pressed Ready (uploaded their army) in. */
  ready: Record<string, number>;
  /** The round each person last finished (computed and watched the battles) in. */
  done: Record<string, number>;
  /** Each person's placed piece types during the shop (no squares), so opponents can see what's coming. */
  preview: Record<string, PieceType[]>;
  /**
   * Battle results reported by the players who computed them, keyed by resultKey(round, index of the
   * pairing). Each phone computes only its own battle; bot-vs-bot battles are computed by one person.
   */
  results: Record<string, ReportedResult>;
}

/** A battle's outcome as reported to the room. */
export interface ReportedResult {
  winner: Winner;
  material: { w: number; b: number };
}

export function resultKey(round: number, index: number): string {
  return `${round}_${index}`;
}

export function isRoomCode(code: string): boolean {
  return new RegExp(`^[${CODE_LETTERS}]{${ROOM_CODE_LENGTH}}$`).test(code);
}

/** Tidies what someone typed as a code ("abcd " → "ABCD"). */
export function normalizeCode(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
}

export function roomCode(rng: Rng): string {
  return Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_LETTERS[randomInt(rng, CODE_LETTERS.length)]).join('');
}

export function newRoom(code: string, host: string, hostName: string, settings: MatchSettings, quick = false): Room {
  return {
    code,
    host,
    quick,
    createdAt: null,
    waitingSince: null,
    status: 'lobby',
    settings,
    seats: Array.from({ length: MATCH_SIZE }, (_, i) =>
      i === 0 ? { uid: host, name: hostName } : { uid: null, name: '' },
    ),
    seed: 0,
    round: 0,
    phase: 'shop',
    phaseStartedAt: null,
    players: [],
    ready: {},
    done: {},
    preview: {},
    results: {},
  };
}

export type RoomChange = { ok: true; room: Room } | { ok: false; error: string };

/** Takes the first free seat (or keeps the one the player already has). */
export function joinRoom(room: Room, uid: string, name: string): RoomChange {
  if (room.seats.some((s) => s.uid === uid)) return { ok: true, room };
  if (room.status !== 'lobby') return { ok: false, error: 'That match has already started' };
  const free = room.seats.findIndex((s) => s.uid === null);
  if (free < 0) return { ok: false, error: 'That room is full' };
  const seats = room.seats.map((s, i) => (i === free ? { uid, name } : s));
  return { ok: true, room: { ...room, seats } };
}

// ---- quick play ----

export function peopleSeated(room: Room): number {
  return room.seats.filter((s) => s.uid !== null).length;
}

/** True when a quick room is still open to join: in the lobby, a free seat, someone waiting, and fresh. */
export function isOpenQuickRoom(room: Room, now: number, blitz: boolean): boolean {
  return (
    room.quick &&
    room.status === 'lobby' &&
    room.settings.blitz === blitz &&
    peopleSeated(room) > 0 &&
    peopleSeated(room) < MATCH_SIZE &&
    room.waitingSince !== null &&
    now - room.waitingSince < QUICK_FRESH_MS
  );
}

/** The order to try joining quick rooms in: fullest first (it starts soonest), then the oldest. */
export function quickRoomsToTry(rooms: Room[], uid: string, now: number, blitz: boolean): Room[] {
  return rooms
    .filter((r) => isOpenQuickRoom(r, now, blitz) && !r.seats.some((s) => s.uid === uid))
    .sort((a, b) => peopleSeated(b) - peopleSeated(a) || olderFirst(a, b));
}

/**
 * Two people who look at the same moment can each make a room. Someone still alone in theirs moves
 * to an older open one, so they end up together.
 */
export function shouldMoveTo(mine: Room, other: Room, uid: string, now: number): boolean {
  return (
    mine.code !== other.code &&
    mine.status === 'lobby' &&
    peopleSeated(mine) === 1 &&
    mine.seats.some((s) => s.uid === uid) &&
    isOpenQuickRoom(other, now, mine.settings.blitz) &&
    olderFirst(other, mine) < 0
  );
}

function olderFirst(a: Room, b: Room): number {
  return (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.code.localeCompare(b.code);
}

/** When a quick room starts by itself (server ms), or null if it doesn't (not quick, or not known yet). */
export function quickStartAt(room: Room): number | null {
  if (!room.quick || room.status !== 'lobby' || room.waitingSince === null) return null;
  return peopleSeated(room) >= MATCH_SIZE ? room.waitingSince : room.waitingSince + QUICK_WAIT_MS;
}

/** A quick room may be started by anyone in it once it's full or has waited long enough. */
export function canQuickStart(room: Room, now: number): boolean {
  const at = quickStartAt(room);
  return at !== null && now >= at && peopleSeated(room) > 0;
}

/** Frees the player's seat while the room is still in the lobby. */
export function leaveLobby(room: Room, uid: string): Room {
  if (room.status !== 'lobby') return room;
  return { ...room, seats: room.seats.map((s) => (s.uid === uid ? { uid: null, name: '' } : s)) };
}

/** Starts the match: empty seats become bots (named from `botNames`), round 1's shop begins. */
export function startRoom(room: Room, seed: number, botNames: string[]): Room {
  let bot = 0;
  const players = newPlayers(
    room.seats.map((s, i) =>
      s.uid
        ? { id: s.uid, name: s.name, bot: false }
        : { id: `bot${i}`, name: botNames[bot++] ?? `Bot ${i}`, bot: true },
    ),
  );
  return {
    ...room,
    status: 'playing',
    seed,
    round: 1,
    phase: 'shop',
    phaseStartedAt: null,
    players,
    ready: {},
    done: {},
    preview: {},
    results: {},
  };
}

/** People (not bots) still in the match. */
export function humansIn(room: Room): string[] {
  return room.players.filter((p) => !p.bot && p.place === null).map((p) => p.id);
}

/** When the shop closes (server ms), or null before the phase's start time is known. */
export function shopDeadline(room: Room): number | null {
  return room.phaseStartedAt === null ? null : room.phaseStartedAt + shopSeconds(room.settings) * 1000;
}

/** The shop may close once every person still in is ready, or the deadline (plus grace) has passed. */
export function canStartBattle(room: Room, now: number): boolean {
  if (room.status !== 'playing' || room.phase !== 'shop') return false;
  if (humansIn(room).every((id) => room.ready[id] === room.round)) return true;
  const deadline = shopDeadline(room);
  return deadline !== null && now >= deadline + SHOP_GRACE_MS;
}

/** This round's pairings: the same on every client (from the match seed and who's still in). */
export function roomPairings(room: Room): Pairing[] {
  return pairRound(room.players, room.seed, room.round);
}

/** The round's results so far, by pairing (null where nothing has been reported yet). */
export function roundResults(room: Room, round = room.round, pairings = roomPairings(room)): (PairingResult | null)[] {
  return pairings.map((pairing, i) => {
    const r = room.results[resultKey(round, i)];
    return r ? { pairing, winner: r.winner, material: r.material } : null;
  });
}

/** The person who computes the round's bot-vs-bot battles: the first seated person still in. */
export function botBattleComputer(room: Room): string | null {
  return humansIn(room)[0] ?? null;
}

/**
 * The round may end once every person still in has finished it and every battle's result is in, or
 * after BATTLE_TIMEOUT_MS (a battle nobody reported then counts as a draw).
 */
export function canFinishRound(room: Room, now: number): boolean {
  if (room.status !== 'playing' || room.phase !== 'battle') return false;
  const allDone = humansIn(room).every((id) => room.done[id] === room.round);
  if (allDone && roundResults(room).every((r) => r !== null)) return true;
  return room.phaseStartedAt !== null && now >= room.phaseStartedAt + BATTLE_TIMEOUT_MS;
}

/** The round's results with any missing one (nobody reported it) counted as a draw. */
export function completeResults(room: Room): PairingResult[] {
  return roundResults(room).map(
    (r, i) => r ?? { pairing: roomPairings(room)[i], winner: 'draw' as const, material: { w: 0, b: 0 } },
  );
}

/** Closes the shop: the round's armies are now locked and visible to everyone. */
export function startBattle(room: Room): Room {
  return { ...room, phase: 'battle', phaseStartedAt: null };
}

/**
 * Applies the round from the reported results (health, knockouts) and opens the next shop, or ends
 * the match. Worked out from the room alone, so it's the same whoever writes it.
 */
export function finishRound(room: Room): Room {
  const players = applyRound(room.players, room.round, completeResults(room));
  const over = players.filter((p) => p.place === null).length <= 1;
  return {
    ...room,
    players,
    status: over ? 'over' : 'playing',
    phase: over ? 'over' : 'shop',
    round: over ? room.round : room.round + 1,
    phaseStartedAt: null,
  };
}

// ---- armies ----

/** A player's locked army for one round, as stored: placed pieces only. */
export interface ArmyDoc {
  uid: string;
  round: number;
  pieces: { type: PieceType; file: number; rank: number }[];
}

export function armyId(round: number, uid: string): string {
  return `${round}_${uid}`;
}

export function armyDoc(uid: string, round: number, pieces: Piece[]): ArmyDoc {
  return {
    uid,
    round,
    pieces: pieces.flatMap((p) => (p.square ? [{ type: p.type, file: p.square.file, rank: p.square.rank }] : [])),
  };
}

/** Checks an army downloaded from another player: known pieces and a legal Classic army. Null if not. */
export function parseArmy(data: unknown): Piece[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const pieces = (data as { pieces?: unknown }).pieces;
  if (!Array.isArray(pieces) || pieces.length > 16) return null;
  const out: Piece[] = [];
  for (const p of pieces) {
    if (typeof p !== 'object' || p === null) return null;
    const { type, file, rank } = p as Record<string, unknown>;
    if (!isPieceType(type) || !Number.isInteger(file) || !Number.isInteger(rank)) return null;
    out.push(makePiece(type, { file: file as number, rank: rank as number }));
  }
  return armyErrors(out, BOARD_8).length === 0 ? out : null;
}

/** The army a person fights with when they uploaded none (left, or timed out): just a king. */
export function loneKing(): Piece[] {
  return [makePiece('K', { file: 3, rank: 0 })];
}
