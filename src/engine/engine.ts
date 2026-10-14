import type { MoveSource } from '../game/runBattle';
import type { WorkerReply, WorkerRequest } from './engineWorker';
import type { Candidate, History } from './pick';

/**
 * A search that takes longer than this is treated as a hung engine. Searches are limited in nodes
 * (ACC_LIMITS), so this is only a safety net for a broken worker, far above any real search.
 */
const TIMEOUT_MS = 30_000;

/**
 * The game's own engine (engine/, Rust compiled to WASM) in a Web Worker. Single-threaded WASM:
 * no SharedArrayBuffer, so the page needs no cross-origin isolation. Searches are limited in depth
 * and nodes, never time, so every device plays the same battle.
 *
 * If the worker fails or a search hangs, the worker is replaced (and told the current battle again)
 * and the search returns no lines; runBattle then plays a random legal move.
 */
export class Engine implements MoveSource {
  private worker!: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: WorkerReply) => void>();
  private game: { variant: string; plyLimit?: number } | null = null;

  private constructor() {}

  static async create(): Promise<Engine> {
    const engine = new Engine();
    engine.start();
    return engine;
  }

  async newGame(variant: string, plyLimit?: number): Promise<void> {
    this.game = { variant, plyLimit };
    const reply = await this.request({ type: 'newGame', variant, plyLimit });
    if (reply?.error) throw new Error(`The chess engine failed: ${reply.error}`);
  }

  /** The best moves from `fen` (reached from history.fen by history.moves), best first. */
  async candidates(fen: string, _depth: number, history?: History): Promise<Candidate[]> {
    const reply = await this.request({ type: 'candidates', fen, history });
    if (!reply) {
      console.warn(`Chess engine hung on ${fen}; restarting it`);
      await this.restart();
      return [];
    }
    if (reply.error) {
      console.warn(`Chess engine failed on ${fen}: ${reply.error}`);
      return [];
    }
    return reply.lines ?? [];
  }

  terminate(): void {
    this.worker.terminate();
    for (const resolve of this.pending.values()) resolve({ id: 0, error: 'terminated' });
    this.pending.clear();
  }

  private start(): void {
    this.worker = new Worker(new URL('./engineWorker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const resolve = this.pending.get(event.data.id);
      this.pending.delete(event.data.id);
      resolve?.(event.data);
    };
    this.worker.onerror = (event) => {
      console.warn('Chess engine worker error', event.message);
      for (const resolve of this.pending.values()) resolve({ id: 0, error: event.message || 'worker error' });
      this.pending.clear();
    };
  }

  private async restart(): Promise<void> {
    this.terminate();
    this.start();
    if (this.game) await this.request({ type: 'newGame', ...this.game });
  }

  /** Sends a request; resolves with the reply, or null if none comes within TIMEOUT_MS. */
  private request(req: Omit<WorkerRequest, 'id'> & Partial<WorkerRequest>): Promise<WorkerReply | null> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(null);
      }, TIMEOUT_MS);
      this.pending.set(id, (reply) => {
        clearTimeout(timer);
        resolve(reply);
      });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }
}
