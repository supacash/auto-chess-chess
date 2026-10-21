import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// Runs against the Firestore emulator: npm run test:rules (needs Java).

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'auto-chess-chess',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(() => env.cleanup());
beforeEach(() => env.clearFirestore());

const VERSION = 10;
const seat = (uid: string | null, name = '', version = VERSION) => (uid ? { uid, name, version } : { uid, name });
const lobby = (host = 'host') => ({
  code: 'ABCD',
  host,
  version: VERSION,
  status: 'lobby',
  settings: { blitz: false },
  seats: [seat(host, 'Host'), seat(null), seat(null), seat(null)],
  seed: 0,
  round: 0,
  phase: 'shop',
  phaseStartedAt: null,
  players: [],
  ready: {},
  done: {},
});
const as = (uid: string) => env.authenticatedContext(uid).firestore();
const seed = (data: object) => env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'rooms/ABCD'), data));
const army = (uid: string, round: number) => ({ uid, round, pieces: [{ type: 'K', file: 4, rank: 0 }] });

describe('rooms', () => {
  it('lets a signed-in player create a room they host, with a valid code', async () => {
    await assertSucceeds(setDoc(doc(as('host'), 'rooms/ABCD'), lobby()));
    await assertFails(setDoc(doc(as('host'), 'rooms/ABCO'), { ...lobby(), code: 'ABCO' }));
    await assertFails(setDoc(doc(as('other'), 'rooms/WXYZ'), { ...lobby('host'), code: 'WXYZ' }));
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), 'rooms/ABCD'), lobby()));
  });

  it('lets anyone take a free seat in a lobby, but nothing else', async () => {
    await seed(lobby());
    const seats = [seat('host', 'Host'), seat('p2', 'P2'), seat(null), seat(null)];
    await assertSucceeds(updateDoc(doc(as('p2'), 'rooms/ABCD'), { seats }));
    // Can't take someone else's seat, change other fields, or seat another uid.
    await assertFails(
      updateDoc(doc(as('p3'), 'rooms/ABCD'), { seats: [seat('p3'), seat('p2'), seat(null), seat(null)] }),
    );
    await assertFails(updateDoc(doc(as('p3'), 'rooms/ABCD'), { status: 'playing' }));
    await assertFails(
      updateDoc(doc(as('p3'), 'rooms/ABCD'), {
        seats: [seat('host', 'Host'), seat('p2', 'P2'), seat('zz'), seat(null)],
      }),
    );
  });

  it('only seats players on the room’s version of the game', async () => {
    await seed(lobby());
    const other = [seat('host', 'Host'), seat('p2', 'P2', VERSION - 1), seat(null), seat(null)];
    await assertFails(updateDoc(doc(as('p2'), 'rooms/ABCD'), { seats: other }));
    const none = [seat('host', 'Host'), { uid: 'p2', name: 'P2' }, seat(null), seat(null)];
    await assertFails(updateDoc(doc(as('p2'), 'rooms/ABCD'), { seats: none }));
    // A room from before versions (none on it) still seats players from before versions.
    const { version: _, ...old } = lobby();
    const oldHost = { uid: 'host', name: 'Host' };
    await seed({ ...old, seats: [oldHost, seat(null), seat(null), seat(null)] });
    const oldJoin = [oldHost, { uid: 'p2', name: 'P2' }, seat(null), seat(null)];
    await assertSucceeds(updateDoc(doc(as('p2'), 'rooms/ABCD'), { seats: oldJoin }));
  });

  it('lets a joiner stamp the join time with the server time only', async () => {
    await seed(lobby());
    const seats = [seat('host', 'Host'), seat('p2', 'P2'), seat(null), seat(null)];
    await assertSucceeds(updateDoc(doc(as('p2'), 'rooms/ABCD'), { seats, waitingSince: serverTimestamp() }));
    const later = [seat('host', 'Host'), seat('p2', 'P2'), seat('p3', 'P3'), seat(null)];
    await assertFails(updateDoc(doc(as('p3'), 'rooms/ABCD'), { seats: later, waitingSince: Timestamp.fromMillis(0) }));
  });

  it('lets anyone signed in look for quick play rooms', async () => {
    await seed({ ...lobby(), quick: true });
    const rooms = query(
      collection(as('stranger'), 'rooms'),
      where('quick', '==', true),
      where('status', '==', 'lobby'),
    );
    await assertSucceeds(getDocs(rooms));
  });

  it('lets seated players move the match along, but not strangers', async () => {
    await seed({
      ...lobby(),
      status: 'playing',
      seats: [seat('host', 'Host'), seat('p2', 'P2'), seat(null), seat(null)],
    });
    await assertSucceeds(updateDoc(doc(as('p2'), 'rooms/ABCD'), { ready: { p2: 1 } }));
    await assertFails(updateDoc(doc(as('stranger'), 'rooms/ABCD'), { ready: { stranger: 1 } }));
    await assertFails(updateDoc(doc(as('p2'), 'rooms/ABCD'), { host: 'p2' }));
  });
});

describe('armies', () => {
  const playing = (round: number, phase: string) => ({
    ...lobby(),
    status: 'playing',
    round,
    phase,
    seats: [seat('host', 'Host'), seat('p2', 'P2'), seat(null), seat(null)],
  });

  it('can be uploaded by their owner during that round’s shop only', async () => {
    await seed(playing(2, 'shop'));
    await assertSucceeds(setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2'), army('p2', 2)));
    await assertFails(setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_host'), army('host', 2)));
    await assertFails(setDoc(doc(as('p2'), 'rooms/ABCD/armies/3_p2'), army('p2', 3)));
    await assertFails(setDoc(doc(as('stranger'), 'rooms/ABCD/armies/2_stranger'), army('stranger', 2)));
    // No changing it afterwards.
    await assertFails(setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2'), army('p2', 2)));
  });

  it('may be as big as a full Growing 9×9 army (18 pieces), but not huge', async () => {
    await seed(playing(2, 'shop'));
    const pieces = (n: number) => Array.from({ length: n }, (_, i) => ({ type: 'P', file: i % 9, rank: 1 }));
    await assertSucceeds(setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2'), { uid: 'p2', round: 2, pieces: pieces(18) }));
    await assertFails(
      setDoc(doc(as('host'), 'rooms/ABCD/armies/2_host'), { uid: 'host', round: 2, pieces: pieces(33) }),
    );
  });

  it('are refused once the shop has closed', async () => {
    await seed(playing(2, 'battle'));
    await assertFails(setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2'), army('p2', 2)));
  });

  it('can be looked up when missing (to fall back to an earlier round)', async () => {
    await seed(playing(2, 'battle'));
    await assertSucceeds(getDoc(doc(as('host'), 'rooms/ABCD/armies/2_p2')));
  });

  it('stay hidden from opponents until the battle starts', async () => {
    await seed(playing(2, 'shop'));
    await setDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2'), army('p2', 2));
    await assertSucceeds(getDoc(doc(as('p2'), 'rooms/ABCD/armies/2_p2')));
    await assertFails(getDoc(doc(as('host'), 'rooms/ABCD/armies/2_p2')));
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), 'rooms/ABCD'), { phase: 'battle' }));
    await assertSucceeds(getDoc(doc(as('host'), 'rooms/ABCD/armies/2_p2')));
  });
});

describe('clocks', () => {
  it('belong to their owner only', async () => {
    await assertSucceeds(setDoc(doc(as('p2'), 'clocks/p2'), { t: 1 }));
    await assertSucceeds(getDoc(doc(as('p2'), 'clocks/p2')));
    await assertFails(setDoc(doc(as('p2'), 'clocks/host'), { t: 1 }));
    await assertFails(getDoc(doc(as('host'), 'clocks/p2')));
  });
});

describe('users (saved progress)', () => {
  const google = (uid: string) =>
    env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
  const anonymous = (uid: string) =>
    env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const save = (data = '{}') => ({ v: 1, updatedAt: 5, data });

  it('belong to their Google account only', async () => {
    await assertSucceeds(setDoc(doc(google('u1'), 'users/u1'), save()));
    await assertSucceeds(getDoc(doc(google('u1'), 'users/u1')));
    await assertFails(getDoc(doc(google('u2'), 'users/u1')));
    await assertFails(setDoc(doc(google('u2'), 'users/u1'), save()));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/u1')));
  });

  it('are not for anonymous players', async () => {
    await assertFails(setDoc(doc(anonymous('u1'), 'users/u1'), save()));
  });

  it('hold only the save string, under the size cap', async () => {
    await assertFails(setDoc(doc(google('u1'), 'users/u1'), { ...save(), extra: true }));
    await assertFails(setDoc(doc(google('u1'), 'users/u1'), { v: 1, updatedAt: 5, data: { records: {} } }));
    await assertFails(setDoc(doc(google('u1'), 'users/u1'), save('x'.repeat(400001))));
  });

  it('can be deleted by their owner', async () => {
    await setDoc(doc(google('u1'), 'users/u1'), save());
    await assertFails(deleteDoc(doc(google('u2'), 'users/u1')));
    await assertSucceeds(deleteDoc(doc(google('u1'), 'users/u1')));
  });
});
