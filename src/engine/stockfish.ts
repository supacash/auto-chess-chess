import { type Candidate, parseInfo } from './pick';

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
/** Lines of analysis per search; pickMove chooses among the close ones. */
const MULTI_PV = 3;
/** A search or handshake that takes longer than this is treated as a hung engine. */
const TIMEOUT_MS = 10_000;
/**
 * Stockfish 17+ rejects positions it considers impossible (e.g. more than 8 pawns plus
 * "promoted" pieces) with this line, and then never sends bestmove.
 */
const UNSUPPORTED = /CRITICAL ERROR.*Unsupported position/;

/**
 * Minimal UCI wrapper around the Stockfish WASM web worker. One search at a time.
 * A search that is refused or hangs (seen with two same-coloured bishops) returns no candidates,
 * so the battle falls back to a random legal move; a hung worker is replaced with a fresh one.
 */
export class Engine {
  private readonly listeners = new Set<(line: string) => void>();
  private worker!: Worker;

  private constructor(private readonly url: string) {}

  static async create(url = ENGINE_URL): Promise<Engine> {
    const engine = new Engine(url);
    await engine.start();
    return engine;
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    if (!(await this.sync())) await this.restart();
  }

  /** Searches `fen` to `depth` and returns the top lines, best first. Empty if the engine can't search it. */
  async candidates(fen: string, depth: number): Promise<Candidate[]> {
    const lines = new Map<number, Candidate>();
    const onLine = (line: string) => {
      const info = parseInfo(line);
      if (info) lines.set(info.multipv, info.candidate);
    };
    this.listeners.add(onLine);
    const done = this.waitFor((l) => l.startsWith('bestmove') || UNSUPPORTED.test(l));
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    const reply = await done;
    this.listeners.delete(onLine);

    if (reply === null) {
      console.warn(`Stockfish hung on ${fen}; restarting it`);
      await this.restart();
      return [];
    }
    if (UNSUPPORTED.test(reply)) {
      console.warn(`Stockfish refused ${fen}: ${reply}`);
      this.send('stop');
      if (!(await this.sync())) await this.restart();
      return [];
    }
    return [...lines.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  terminate(): void {
    this.worker.terminate();
  }

  private async start(): Promise<void> {
    const worker = new Worker(this.url);
    this.worker = worker;
    worker.onmessage = (e: MessageEvent) => {
      if (worker !== this.worker) return;
      const line = String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    const ready = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    if ((await ready) === null) throw new Error('Stockfish did not start');
    this.send(`setoption name MultiPV value ${MULTI_PV}`);
    if (!(await this.sync())) throw new Error('Stockfish did not start');
  }

  private async restart(): Promise<void> {
    this.worker.terminate();
    this.listeners.clear();
    await this.start();
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  /** True once the engine answers `isready`, false if it stays silent. */
  private async sync(): Promise<boolean> {
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    return (await ready) !== null;
  }

  /** Resolves with the first matching line, or null after TIMEOUT_MS. */
  private waitFor(match: (line: string) => boolean): Promise<string | null> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        if (!match(line)) return;
        clearTimeout(timer);
        this.listeners.delete(fn);
        resolve(line);
      };
      const timer = setTimeout(() => {
        this.listeners.delete(fn);
        resolve(null);
      }, TIMEOUT_MS);
      this.listeners.add(fn);
    });
  }
}
