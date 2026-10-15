import { type FirebaseApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  collection,
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  type Firestore,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { type MatchPlayer, type MatchSettings, MATCH_SIZE, matchBoard } from '../multi/match';
import { isMatchPerkId, type MatchPerkId, type PerkPicks } from '../multi/perks';
import { type Holdings, isPoolKind } from '../multi/pool';
import { isModeId } from '../rules/mode';
import { isPieceType, type Piece, type PieceType } from '../rules/pieces';
import { type Rng, randomSeed } from '../rules/rng';
import {
  armyDoc,
  armyId,
  canFinishRound,
  canStartBattle,
  finishRound,
  joinRoom,
  leaveLobby,
  loneKing,
  newRoom,
  parseArmy,
  peopleSeated,
  QUICK_FRESH_MS,
  quickRoomsToTry,
  type ReportedResult,
  resultKey,
  type Room,
  roomCode,
  startBattle,
  startRoom,
} from './room';

// Firestore storage for online rooms. Loaded only when a player opens online play (main.ts imports
// it dynamically), so single-player never downloads the Firebase SDK.

/** The web app's Firebase config. It's public by design: the security rules (firestore.rules) protect the data. */
const CONFIG = {
  apiKey: 'AIzaSyB-cI9n3wnbeoPmL-74jXWKQgZpiGzBnb4',
  authDomain: 'auto-chess-chess.firebaseapp.com',
  projectId: 'auto-chess-chess',
  storageBucket: 'auto-chess-chess.firebasestorage.app',
  messagingSenderId: '570904955189',
  appId: '1:570904955189:web:f410a59a661f8baecaa47c',
};

/** Set VITE_FIREBASE_EMULATOR=1 to use local emulators (npm run e2e:online, development). */
const USE_EMULATOR = import.meta.env.VITE_FIREBASE_EMULATOR === '1';

/**
 * Firebase App Check (reCAPTCHA Enterprise site key, also public): requests carry proof that they
 * come from this game on its real site, so copies elsewhere can't use the project. Empty = off.
 * Not used with the emulators or in the Android app (its WebView origin is https://localhost; it
 * will need Play Integrity through a native plugin once it's on Google Play). On localhost the SDK
 * prints a debug token to the console, to register in the Firebase console for local testing.
 */
const APP_CHECK_SITE_KEY = '';

let app: FirebaseApp | null = null;

async function startAppCheck(firebase: FirebaseApp): Promise<void> {
  const native = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  if (!APP_CHECK_SITE_KEY || USE_EMULATOR || native) return;
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    (self as { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import('firebase/app-check');
  initializeAppCheck(firebase, {
    provider: new ReCaptchaEnterpriseProvider(APP_CHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}

/** A signed-in connection to the rooms database. */
export class RoomClient {
  /** Server time minus local time, so every client agrees on phase deadlines. */
  private offset = 0;

  private constructor(
    private readonly db: Firestore,
    readonly uid: string,
  ) {}

  static async connect(): Promise<RoomClient> {
    if (!app) {
      app = initializeApp(CONFIG);
      await startAppCheck(app);
    }
    const auth = getAuth(app);
    const db = getFirestore(app);
    if (USE_EMULATOR && !(auth as { emulatorConfig?: unknown }).emulatorConfig) {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    const { user } = auth.currentUser ? { user: auth.currentUser } : await signInAnonymously(auth);
    const client = new RoomClient(db, user.uid);
    await client.syncClock();
    return client;
  }

  /** Server time now (ms), from the local clock and the measured offset. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  /** Measures the server clock by writing a server timestamp and reading it back. */
  private async syncClock(): Promise<void> {
    const ref = doc(this.db, 'clocks', this.uid);
    const before = Date.now();
    await setDoc(ref, { t: serverTimestamp() });
    const after = Date.now();
    const snap = await getDoc(ref);
    const t = snap.get('t') as Timestamp | undefined;
    if (t) this.offset = t.toMillis() - (before + after) / 2;
  }

  /** Creates a room with a fresh code (retrying if a code is taken) and seats the player as host. */
  async createRoom(name: string, settings: MatchSettings, rng: Rng, quick = false): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = roomCode(rng);
      const ref = doc(this.db, 'rooms', code);
      const created = await runTransaction(this.db, async (tx) => {
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, {
          ...toStored(newRoom(code, this.uid, name, settings, quick)),
          createdAt: serverTimestamp(),
          waitingSince: serverTimestamp(),
        });
        return true;
      });
      if (created) return code;
    }
    throw new Error("Couldn't find a free room code; try again");
  }

  async joinRoom(code: string, name: string): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error(`No room with code ${code}`);
      const room = fromStored(snap.data());
      const change = joinRoom(room, this.uid, name);
      if (!change.ok) throw new Error(change.error);
      if (change.room === room) return; // already seated
      tx.update(ref, { seats: change.room.seats, waitingSince: serverTimestamp() });
    });
  }

  /**
   * Open quick play rooms with these rules, best first (see quickRoomsToTry). The query narrows by
   * shop time only (its index); the board and pieces are matched here.
   */
  async findQuickRooms(settings: MatchSettings): Promise<Room[]> {
    const fresh = Timestamp.fromMillis(this.serverNow() - QUICK_FRESH_MS);
    const snap = await getDocs(
      query(
        collection(this.db, 'rooms'),
        where('quick', '==', true),
        where('status', '==', 'lobby'),
        where('settings.blitz', '==', settings.blitz),
        where('waitingSince', '>=', fresh),
        limit(40),
      ),
    );
    return quickRoomsToTry(
      snap.docs.map((d) => fromStored(d.data())),
      this.uid,
      this.serverNow(),
      settings,
    );
  }

  /** Quick play: takes a seat in an open quick room with these rules, or makes one. Returns its code. */
  async quickPlay(name: string, settings: MatchSettings, rng: Rng): Promise<string> {
    // If the search fails (e.g. its index is still building), make a room others can still find later.
    const rooms = await this.findQuickRooms(settings).catch((err) => {
      console.warn('Quick play search failed', err);
      return [];
    });
    for (const room of rooms) {
      try {
        await this.joinRoom(room.code, name);
        return room.code;
      } catch {
        // Filled up or started meanwhile: try the next one.
      }
    }
    return this.createRoom(name, settings, rng, true);
  }

  /** Leaves a room still in the lobby. A host leaving an otherwise empty room deletes it. */
  async leaveLobby(code: string): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    const empty = await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const room = fromStored(snap.data());
      if (room.status !== 'lobby') return false;
      const left = leaveLobby(room, this.uid);
      tx.update(ref, { seats: left.seats });
      return room.host === this.uid && peopleSeated(left) === 0;
    });
    if (empty) await deleteDoc(ref).catch(console.warn);
  }

  /** The room as it is now (null if it doesn't exist). */
  async getRoom(code: string): Promise<Room | null> {
    const snap = await getDoc(doc(this.db, 'rooms', code));
    return snap.exists() ? fromStored(snap.data()) : null;
  }

  /** Calls `onChange` with the room now and after every change (null if it doesn't exist). */
  watch(code: string, onChange: (room: Room | null) => void): () => void {
    return onSnapshot(doc(this.db, 'rooms', code), (snap) => onChange(snap.exists() ? fromStored(snap.data()) : null));
  }

  /** Host: starts the match with bots in the empty seats. */
  async start(code: string, botNames: string[], rng: Rng): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('The room is gone');
      const room = fromStored(snap.data());
      if (room.status !== 'lobby') return;
      tx.update(ref, { ...toStored(startRoom(room, randomSeed(rng), botNames)), phaseStartedAt: serverTimestamp() });
    });
  }

  /** Locks in the player's army for the room's current round and marks them ready. */
  async submitArmy(room: Room, pieces: Piece[]): Promise<void> {
    const ref = doc(this.db, 'rooms', room.code, 'armies', armyId(room.round, this.uid));
    await setDoc(ref, armyDoc(this.uid, room.round, pieces));
    await updateDoc(doc(this.db, 'rooms', room.code), { [`ready.${this.uid}`]: room.round });
  }

  /** Closes the shop if it's time (any player may; the transaction makes it happen once). */
  async tryStartBattle(code: string): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const room = fromStored(snap.data());
      if (!canStartBattle(room, this.serverNow())) return;
      tx.update(ref, { ...toStored(startBattle(room)), phaseStartedAt: serverTimestamp() });
    });
  }

  /**
   * Every person's army for the round, once the shop has closed. Someone who uploaded nothing this
   * round fights with their latest earlier army, or a lone king.
   */
  async fetchArmies(room: Room): Promise<Map<string, Piece[]>> {
    const armies = new Map<string, Piece[]>();
    const people = room.players.filter((p) => !p.bot && p.place === null);
    await Promise.all(
      people.map(async (p) => {
        for (let round = room.round; round >= 1; round--) {
          const snap = await getDoc(doc(this.db, 'rooms', room.code, 'armies', armyId(round, p.id)));
          const army = snap.exists() ? parseArmy(snap.data(), matchBoard(room.settings, round)) : null;
          if (army) {
            armies.set(p.id, army);
            return;
          }
        }
        armies.set(p.id, loneKing());
      }),
    );
    return armies;
  }

  /** Shares the player's placed piece types (no squares) with the room. */
  async sharePreview(code: string, types: PieceType[]): Promise<void> {
    await updateDoc(doc(this.db, 'rooms', code), { [`preview.${this.uid}`]: types });
  }

  /** Shares the player's perk pick for `round`. */
  async sharePerk(code: string, round: number, perk: MatchPerkId): Promise<void> {
    await updateDoc(doc(this.db, 'rooms', code), { [`perks.${this.uid}.${round}`]: perk });
  }

  /** Shares the player's affinity pawns (for the shared pool). */
  async shareHeld(code: string, held: Holdings): Promise<void> {
    await updateDoc(doc(this.db, 'rooms', code), { [`held.${this.uid}`]: held });
  }

  /** Marks the player as finished with the round's battles. */
  async markDone(code: string, round: number): Promise<void> {
    await updateDoc(doc(this.db, 'rooms', code), { [`done.${this.uid}`]: round });
  }

  /** Reports a battle's result (the player's own, or a bot-vs-bot battle they computed). */
  async reportResult(code: string, round: number, index: number, result: ReportedResult): Promise<void> {
    await updateDoc(doc(this.db, 'rooms', code), { [`results.${resultKey(round, index)}`]: result });
  }

  /**
   * Ends the round from the reported results if it's time; the first client to get here writes it.
   * The new health list is worked out from the room alone, so it's the same whoever writes it.
   */
  async tryFinishRound(code: string, round: number): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const room = fromStored(snap.data());
      if (room.round !== round || !canFinishRound(room, this.serverNow())) return;
      tx.update(ref, { ...toStored(finishRound(room)), phaseStartedAt: serverTimestamp() });
    });
  }
}

/** Room fields as stored: the same, except phaseStartedAt is a Firestore timestamp. */
function toStored(room: Room): Record<string, unknown> {
  const stamp = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));
  return {
    ...room,
    createdAt: stamp(room.createdAt),
    waitingSince: stamp(room.waitingSince),
    phaseStartedAt: stamp(room.phaseStartedAt),
  };
}

function fromStored(data: Record<string, unknown>): Room {
  const millis = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
  return {
    ...(data as unknown as Room),
    version: Number.isInteger(data.version) ? (data.version as number) : 0,
    quick: data.quick === true,
    settings: parseSettings(data.settings),
    createdAt: millis(data.createdAt),
    waitingSince: millis(data.waitingSince),
    phaseStartedAt: millis(data.phaseStartedAt),
    players: parsePlayers(data.players),
    ready: (data.ready as Record<string, number>) ?? {},
    done: (data.done as Record<string, number>) ?? {},
    preview: parsePreviews(data.preview),
    results: parseResults(data.results),
    perks: parsePerks(data.perks),
    held: parseHeld(data.held),
  };
}

/** The match's players, kept only if well-formed (a place is null or a whole number from 1 to MATCH_SIZE). */
function parsePlayers(data: unknown): MatchPlayer[] {
  const out: MatchPlayer[] = [];
  if (!Array.isArray(data)) return out;
  for (const p of data) {
    if (typeof p !== 'object' || p === null) continue;
    const { id, name, bot, hp, place, lastOpponent } = p as Record<string, unknown>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof bot !== 'boolean') continue;
    if (!Number.isInteger(hp) || (place !== null && !isPlace(place))) continue;
    const player: MatchPlayer = { id, name, bot, hp: hp as number, place: place as number | null };
    if (typeof lastOpponent === 'string' || lastOpponent === null) player.lastOpponent = lastOpponent;
    out.push(player);
  }
  return out;
}

function isPlace(n: unknown): boolean {
  return Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MATCH_SIZE;
}

/** People's perk picks (round → perk), kept only if well-formed. */
function parsePerks(data: unknown): Record<string, PerkPicks> {
  const out: Record<string, PerkPicks> = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [uid, picks] of Object.entries(data)) {
    if (typeof picks !== 'object' || picks === null) continue;
    const clean: PerkPicks = {};
    for (const [round, perk] of Object.entries(picks)) if (isMatchPerkId(perk)) clean[Number(round)] = perk;
    out[uid] = clean;
  }
  return out;
}

/** People's affinity pawns by kind, kept only if well-formed. */
function parseHeld(data: unknown): Record<string, Holdings> {
  const out: Record<string, Holdings> = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [uid, held] of Object.entries(data)) {
    if (typeof held !== 'object' || held === null) continue;
    const clean: Holdings = {};
    for (const [kind, n] of Object.entries(held)) {
      if (isPoolKind(kind) && Number.isInteger(n) && (n as number) >= 0) clean[kind] = n as number;
    }
    out[uid] = clean;
  }
  return out;
}

/** The room's rules; anything missing or unknown is Classic with standard pieces. */
function parseSettings(data: unknown): MatchSettings {
  const s = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return { blitz: s.blitz === true, mode: isModeId(s.mode) ? s.mode : 'classic', fairy: s.fairy === true };
}

/** Reported battle results, kept only if well-formed. */
function parseResults(data: unknown): Record<string, ReportedResult> {
  const out: Record<string, ReportedResult> = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [key, r] of Object.entries(data)) {
    if (typeof r !== 'object' || r === null) continue;
    const { winner, material } = r as Record<string, unknown>;
    if (winner !== 'w' && winner !== 'b' && winner !== 'draw') continue;
    if (typeof material !== 'object' || material === null) continue;
    const { w, b } = material as Record<string, unknown>;
    if (Number.isInteger(w) && Number.isInteger(b)) out[key] = { winner, material: { w: w as number, b: b as number } };
  }
  return out;
}

/** Other players' previews: kept only if they're lists of known piece types (at most a full army). */
function parsePreviews(data: unknown): Record<string, PieceType[]> {
  const out: Record<string, PieceType[]> = {};
  if (typeof data !== 'object' || data === null) return out;
  for (const [uid, types] of Object.entries(data)) {
    if (Array.isArray(types) && types.length <= 32 && types.every(isPieceType)) out[uid] = types;
  }
  return out;
}
