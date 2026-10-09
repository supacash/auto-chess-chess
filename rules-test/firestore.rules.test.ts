import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
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

const seat = (uid: string | null, name = '') => ({ uid, name });
const lobby = (host = 'host') => ({
  code: 'ABCD',
  host,
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
