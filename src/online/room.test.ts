import { describe, expect, it } from 'vitest';
import { makePiece } from '../rules/pieces';
import { seededRng } from '../rules/rng';
import {
  armyDoc,
  armyId,
  BATTLE_TIMEOUT_MS,
  canFinishRound,
  canStartBattle,
  finishRound,
  humansIn,
  isRoomCode,
  joinRoom,
  leaveLobby,
  newRoom,
  normalizeCode,
  parseArmy,
  type Room,
  roomCode,
  SHOP_GRACE_MS,
  shopDeadline,
  startBattle,
  startRoom,
} from './room';

const lobby = () => newRoom('ABCD', 'host', 'Brave Knight 10', { blitz: false });
const joined = (room: Room, uid: string) => {
  const r = joinRoom(room, uid, uid.toUpperCase());
  if (!r.ok) throw new Error(r.error);
  return r.room;
};
const playing = () => ({ ...startRoom(joined(lobby(), 'p2'), 99, ['Bot A', 'Bot B']), phaseStartedAt: 1_000_000 });

describe('room codes', () => {
  it('are 4 unambiguous letters, and typed codes are tidied', () => {
    const code = roomCode(seededRng(1));
    expect(isRoomCode(code)).toBe(true);
    expect(isRoomCode('AB1D')).toBe(false);
    expect(isRoomCode('ABCO')).toBe(false);
    expect(normalizeCode(' ab-cd ')).toBe('ABCD');
  });
});

describe('lobby', () => {
  it('seats the host first and others in the free seats', () => {
    let room = lobby();
    expect(room.seats.map((s) => s.uid)).toEqual(['host', null, null, null]);
    room = joined(room, 'p2');
    room = joined(room, 'p3');
    expect(room.seats.map((s) => s.uid)).toEqual(['host', 'p2', 'p3', null]);
    expect(joined(room, 'p2')).toBe(room); // already seated
  });

  it('refuses a full or started room, and frees a seat on leaving', () => {
    let room = lobby();
    for (const uid of ['p2', 'p3', 'p4']) room = joined(room, uid);
    expect(joinRoom(room, 'p5', 'P5')).toEqual({ ok: false, error: 'That room is full' });
    expect(leaveLobby(room, 'p3').seats[2].uid).toBeNull();
    const started = startRoom(lobby(), 1, []);
    expect(joinRoom(started, 'p9', 'P9')).toEqual({ ok: false, error: 'That match has already started' });
  });

  it('starts with bots in the empty seats', () => {
    const room = startRoom(joined(lobby(), 'p2'), 7, ['Bot A', 'Bot B']);
    expect(room.status).toBe('playing');
    expect(room.round).toBe(1);
    expect(room.players.map((p) => [p.id, p.name, p.bot])).toEqual([
      ['host', 'Brave Knight 10', false],
      ['p2', 'P2', false],
      ['bot2', 'Bot A', true],
      ['bot3', 'Bot B', true],
    ]);
    expect(humansIn(room)).toEqual(['host', 'p2']);
  });
});

describe('phases', () => {
  it('closes the shop when every person is ready, or after the deadline and grace', () => {
    const room = playing();
    const deadline = shopDeadline(room)!;
    expect(deadline).toBe(1_000_000 + 45_000);
    expect(canStartBattle(room, deadline)).toBe(false);
    expect(canStartBattle(room, deadline + SHOP_GRACE_MS)).toBe(true);
    expect(canStartBattle({ ...room, ready: { host: 1 } }, 0)).toBe(false);
    expect(canStartBattle({ ...room, ready: { host: 1, p2: 1 } }, 0)).toBe(true);
    // Ready from an earlier round doesn't count.
    expect(canStartBattle({ ...room, round: 2, ready: { host: 1, p2: 1 } }, 0)).toBe(false);
  });

  it('waits for an unknown start time rather than closing early', () => {
    expect(canStartBattle({ ...playing(), phaseStartedAt: null }, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it('ends the round when everyone is done, or after the timeout', () => {
    const room = { ...startBattle(playing()), phaseStartedAt: 5_000 };
    expect(canStartBattle(room, 0)).toBe(false);
    expect(canFinishRound(room, 5_000)).toBe(false);
    expect(canFinishRound({ ...room, done: { host: 1, p2: 1 } }, 5_000)).toBe(true);
    expect(canFinishRound(room, 5_000 + BATTLE_TIMEOUT_MS)).toBe(true);
  });

  it('moves to the next round, or ends when one player is left', () => {
    const room = startBattle(playing());
    const next = finishRound(room, room.players);
    expect([next.round, next.phase, next.status]).toEqual([2, 'shop', 'playing']);
    const players = room.players.map((p, i) => ({ ...p, place: i === 0 ? 1 : 5 - i }));
    const over = finishRound(room, players);
    expect([over.round, over.phase, over.status]).toEqual([1, 'over', 'over']);
  });

  it('ignores people who are out when waiting for ready', () => {
    const room = playing();
    const p2Out = { ...room, players: room.players.map((p) => (p.id === 'p2' ? { ...p, hp: 0, place: 4 } : p)) };
    expect(canStartBattle({ ...p2Out, ready: { host: 1 } }, 0)).toBe(true);
  });
});

describe('armies', () => {
  it('store placed pieces and come back as a legal army', () => {
    const doc = armyDoc('p2', 3, [
      makePiece('K', { file: 4, rank: 0 }),
      makePiece('R', { file: 0, rank: 0 }),
      makePiece('Q'),
    ]);
    expect(doc.pieces).toHaveLength(2);
    expect(armyId(3, 'p2')).toBe('3_p2');
    expect(parseArmy(JSON.parse(JSON.stringify(doc)))?.map((p) => p.type)).toEqual(['K', 'R']);
  });

  it('reject illegal or malformed armies', () => {
    expect(parseArmy(null)).toBeNull();
    expect(parseArmy({ pieces: [{ type: 'R', file: 0, rank: 0 }] })).toBeNull(); // no king
    expect(
      parseArmy({
        pieces: [
          { type: 'K', file: 4, rank: 0 },
          { type: 'P', file: 1, rank: 0 },
        ],
      }),
    ).toBeNull();
    expect(parseArmy({ pieces: [{ type: 'K', file: 4, rank: 7 }] })).toBeNull();
  });
});
