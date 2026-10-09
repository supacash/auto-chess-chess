import { MATCH_SIZE } from '../multi/match';
import type { RoomClient } from '../online/client';
import type { Room } from '../online/room';
import { $, escapeHtml } from './dom';

/**
 * The room lobby: the code to share, who's seated, and Start (host) or Leave. Calls `onStarted` once
 * the host starts the match, for everyone in the room.
 */
export class LobbyScreen {
  private readonly section = $('#lobby');
  private stopWatching: (() => void) | null = null;
  private client: RoomClient | null = null;
  private room: Room | null = null;

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
  }

  hide(): void {
    this.section.hidden = true;
    this.stopWatching?.();
    this.stopWatching = null;
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
    const isHost = room.host === me;
    $('#lobby-seats').innerHTML = room.seats
      .map((s, i) => {
        const label = s.uid
          ? `${escapeHtml(s.name)}${s.uid === me ? ' <small>you</small>' : ''}${s.uid === room.host ? ' <small>host</small>' : ''}`
          : '<span class="empty-seat">Empty: a bot will play</span>';
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
