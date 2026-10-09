import { type FirebaseApp, initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  type Firestore,
  getDoc,
  getFirestore,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import type { MatchSettings } from '../multi/match';
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

let app: FirebaseApp | null = null;

/** A signed-in connection to the rooms database. */
export class RoomClient {
  /** Server time minus local time, so every client agrees on phase deadlines. */
  private offset = 0;

  private constructor(
    private readonly db: Firestore,
    readonly uid: string,
  ) {}

  static async connect(): Promise<RoomClient> {
    app ??= initializeApp(CONFIG);
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
  async createRoom(name: string, settings: MatchSettings, rng: Rng): Promise<string> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const code = roomCode(rng);
      const ref = doc(this.db, 'rooms', code);
      const created = await runTransaction(this.db, async (tx) => {
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, toStored(newRoom(code, this.uid, name, settings)));
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
      const change = joinRoom(fromStored(snap.data()), this.uid, name);
      if (!change.ok) throw new Error(change.error);
      tx.update(ref, { seats: change.room.seats });
    });
  }

  async leaveLobby(code: string): Promise<void> {
    const ref = doc(this.db, 'rooms', code);
    await runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return;
      const room = fromStored(snap.data());
      if (room.status === 'lobby') tx.update(ref, { seats: leaveLobby(room, this.uid).seats });
    });
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
          const army = snap.exists() ? parseArmy(snap.data()) : null;
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
  return { ...room, phaseStartedAt: room.phaseStartedAt === null ? null : Timestamp.fromMillis(room.phaseStartedAt) };
}

function fromStored(data: Record<string, unknown>): Room {
  const started = data.phaseStartedAt;
  return {
    ...(data as unknown as Room),
    phaseStartedAt: started instanceof Timestamp ? started.toMillis() : null,
    ready: (data.ready as Record<string, number>) ?? {},
    done: (data.done as Record<string, number>) ?? {},
    preview: parsePreviews(data.preview),
    results: parseResults(data.results),
  };
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
    if (Array.isArray(types) && types.length <= 16 && types.every(isPieceType)) out[uid] = types;
  }
  return out;
}
