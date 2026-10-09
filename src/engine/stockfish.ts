import { type Candidate, parseInfo } from './pick';

const ENGINE_URL = `${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`;
/** Lines of analysis per search; pickMove chooses among the close ones. */
const MULTI_PV = 3;

/** Minimal UCI wrapper around the Stockfish WASM web worker. One search at a time. */
export class Engine {
  private readonly listeners = new Set<(line: string) => void>();

  private constructor(private readonly worker: Worker) {
    worker.onmessage = (e: MessageEvent) => {
      const line = String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
  }

  static async create(url = ENGINE_URL): Promise<Engine> {
    const engine = new Engine(new Worker(url));
    const ready = engine.waitFor((l) => l === 'uciok');
    engine.send('uci');
    await ready;
    engine.send(`setoption name MultiPV value ${MULTI_PV}`);
    await engine.sync();
    return engine;
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.sync();
  }

  /** Searches `fen` to `depth` and returns the top lines, best first. */
  async candidates(fen: string, depth: number): Promise<Candidate[]> {
    const lines = new Map<number, Candidate>();
    const onLine = (line: string) => {
      const info = parseInfo(line);
      if (info) lines.set(info.multipv, info.candidate);
    };
    this.listeners.add(onLine);
    const done = this.waitFor((l) => l.startsWith('bestmove'));
    this.send(`position fen ${fen}`);
    this.send(`go depth ${depth}`);
    await done;
    this.listeners.delete(onLine);
    return [...lines.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd);
  }

  private sync(): Promise<string> {
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    return ready;
  }

  private waitFor(match: (line: string) => boolean): Promise<string> {
    return new Promise((resolve) => {
      const fn = (line: string) => {
        if (!match(line)) return;
        this.listeners.delete(fn);
        resolve(line);
      };
      this.listeners.add(fn);
    });
  }
}
