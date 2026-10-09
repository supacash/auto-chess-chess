import { MATCH_SIZE } from '../multi/match';
import type { RoomClient } from '../online/client';
import { canQuickStart, peopleSeated, quickStartAt, type Room, shouldMoveTo } from '../online/room';
import { $, escapeHtml } from './dom';

/** How often someone alone in a quick play room looks for an older one to move to. */
const MERGE_CHECK_MS = 4_000;

/**
 * The room lobby: the code to share, who's seated, and Start (host) or Leave. Calls `onStarted` once
 * the host starts the match, for everyone in the room.
 *
 * A quick play room has no code to share: it counts down and starts by itself (anyone in it may
 * start it once it's due), and someone alone in theirs moves to an older open one.
 */
export class LobbyScreen {
  private readonly section = $('#lobby');
  private stopWatching: (() => void) | null = null;
  private client: RoomClient | null = null;
  private room: Room | null = null;
  private ticker = 0;
  private starting = false;
  private moving = false;
  private lastMergeCheck = 0;

  constructor(
    private readonly onStarted: (client: RoomClient, room: Room) => void,
    private readonly onLeft: () => void,
    private readonly botNames: () => string[],
  ) {
    $('#lobby-start').addEventListener('click', () => void this.start());
    $('#lobby-leave').addEventListener('click', () => void this.leave());
  }

  /** Shows the lobby for room `code` and follows it until the match starts. */
  open(client: RoomClient, code: string): void {
    this.client = client;
    this.section.hidden = false;
    $('#lobby-code').textContent = code;
    $('#lobby-message').textContent = '';
    $('#lobby-start').hidden = true; // until the room has loaded
    $('#lobby-seats').innerHTML = '';
    this.room = null;
    this.stopWatching?.();
    this.stopWatching = client.watch(code, (room) => this.onRoom(room));
    clearInterval(this.ticker);
    this.ticker = window.setInterval(() => this.tick(), 500);
  }

  hide(): void {
    this.section.hidden = true;
    this.stopWatching?.();
    this.stopWatching = null;
    clearInterval(this.ticker);
    this.ticker = 0;
  }

  /** Quick play: the countdown, starting when due, and moving to an older room while alone. */
  private tick(): void {
    const { client, room } = this;
    if (!client || !room?.quick || room.status !== 'lobby') return;
    const now = client.serverNow();
    this.renderQuickStatus(room, now);
    if (canQuickStart(room, now) && !this.starting) {
      this.starting = true;
      void client
        .start(room.code, this.botNames(), Math.random)
        .catch(console.warn)
        .finally(() => {
          this.starting = false;
        });
    }
    if (peopleSeated(room) === 1 && !this.moving && Date.now() - this.lastMergeCheck >= MERGE_CHECK_MS) {
      this.lastMergeCheck = Date.now();
      void this.moveToOlderRoom(client, room);
    }
  }

  private async moveToOlderRoom(client: RoomClient, mine: Room): Promise<void> {
    this.moving = true;
    try {
      const rooms = await client.findQuickRooms(mine.settings.blitz);
      const target = rooms.find((r) => shouldMoveTo(mine, r, client.uid, client.serverNow()));
      if (!target || this.room?.code !== mine.code || peopleSeated(this.room) !== 1) return;
      await client.joinRoom(target.code, mine.seats.find((s) => s.uid === client.uid)?.name ?? '');
      this.open(client, target.code);
      await client.leaveLobby(mine.code);
    } catch (err) {
      console.warn('Moving to another quick play room failed', err);
    } finally {
      this.moving = false;
    }
  }

  private renderQuickStatus(room: Room, now: number): void {
    const at = quickStartAt(room);
    const people = peopleSeated(room);
    const seconds = at === null ? null : Math.max(0, Math.ceil((at - now) / 1000));
    $('#lobby-status').textContent =
      seconds === null || seconds > 0
        ? `Looking for players (${people} of ${MATCH_SIZE})…${seconds === null ? '' : ` Starting in ${seconds}s`}${people < MATCH_SIZE ? ', with bots in the empty seats.' : '.'}`
        : 'Starting…';
  }

  private onRoom(room: Room | null): void {
    if (!room) {
      $('#lobby-message').textContent = 'This room no longer exists.';
      return;
    }
    this.room = room;
    if (room.status !== 'lobby') {
      const client = this.client!;
      this.hide();
      this.onStarted(client, room);
      return;
    }
    const me = this.client!.uid;
    const isHost = room.host === me && !room.quick;
    $('#lobby-label').textContent = room.quick ? 'Quick play' : 'Room code';
    $('#lobby-code').textContent = room.quick ? (room.settings.blitz ? 'Classic Blitz' : 'Classic') : room.code;
    $('#lobby-code').classList.toggle('mode', room.quick);
    $('#lobby-seats').innerHTML = room.seats
      .map((s, i) => {
        const label = s.uid
          ? `${escapeHtml(s.name)}${s.uid === me ? ' <small>you</small>' : ''}${s.uid === room.host && !room.quick ? ' <small>host</small>' : ''}`
          : `<span class="empty-seat">${room.quick ? 'Open: a player or a bot' : 'Empty: a bot will play'}</span>`;
        return `<li class="seat"><span class="seat-number">${i + 1}</span><span>${label}</span></li>`;
      })
      .join('');
    const people = room.seats.filter((s) => s.uid).length;
    const start = $<HTMLButtonElement>('#lobby-start');
    start.hidden = !isHost;
    start.textContent =
      people === MATCH_SIZE
        ? 'Start match'
        : `Start with ${MATCH_SIZE - people} bot${MATCH_SIZE - people === 1 ? '' : 's'}`;
    if (room.quick) this.renderQuickStatus(room, this.client!.serverNow());
    else
      $('#lobby-status').textContent = isHost
        ? 'Share the code. Start whenever you like; empty seats are filled with bots.'
        : 'Waiting for the host to start the match…';
  }

  private async start(): Promise<void> {
    const { client, room } = this;
    if (!client || !room) return;
    $<HTMLButtonElement>('#lobby-start').disabled = true;
    try {
      await client.start(room.code, this.botNames(), Math.random);
    } catch (err) {
      $('#lobby-message').textContent = err instanceof Error ? err.message : String(err);
    } finally {
      $<HTMLButtonElement>('#lobby-start').disabled = false;
    }
  }

  private async leave(): Promise<void> {
    const { client, room } = this;
    this.hide();
    if (client && room) await client.leaveLobby(room.code).catch(console.warn);
    this.onLeft();
  }
}
