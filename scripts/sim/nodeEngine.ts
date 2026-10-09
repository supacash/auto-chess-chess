import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { type Candidate, parseInfo } from '../../src/engine/pick';
import type { MoveSource } from '../../src/game/runBattle';

const require = createRequire(import.meta.url);
const ENGINE_PATH = require.resolve('stockfish/bin/stockfish-19-lite-single.js');
/** Same as src/engine/stockfish.ts. */
const MULTI_PV = 3;
/** A search or handshake that takes longer than this is treated as a hung engine. */
const TIMEOUT_MS = 10_000;
/**
 * Stockfish 17+ rejects positions it considers impossible, e.g. more than 8 pawns plus
 * "promoted" pieces (a third bishop counts as a promoted pawn), and then never sends bestmove.
 */
const UNSUPPORTED = /CRITICAL ERROR.*Unsupported position/;

/**
 * Stockfish could not search a position: it refused it as unsupported (`rejected`), or the
 * search never finished even after a restart (`hung`; seen with two same-coloured bishops).
 */
export class EngineFailure extends Error {
  constructor(
    readonly kind: 'rejected' | 'hung',
    readonly fen: string,
    readonly detail: string,
  ) {
    super(`Stockfish ${kind} on ${fen}: ${detail}`);
  }
}

/**
 * Node counterpart of src/engine/stockfish.ts: the same UCI flow, but the Stockfish lite build
 * runs as a child process talking over stdin/stdout instead of a web worker.
 * `depthOverride` replaces the depth runBattle asks for (for tuning experiments).
 * The WASM engine occasionally stalls mid-search; a search that times out restarts the process and retries once.
 */
export class NodeEngine implements MoveSource {
  private readonly listeners = new Set<(line: string) => void>();
  private readonly failures = new Set<(err: Error) => void>();
  /** Last lines from the engine, for error messages. */
  private readonly recent: string[] = [];
  private proc!: ChildProcessWithoutNullStreams;
  private exited: Error | null = null;
  /** How many times a stalled search restarted the engine. */
  restarts = 0;

  private constructor(private readonly depthOverride?: number) {}

  static async create(depthOverride?: number): Promise<NodeEngine> {
    const engine = new NodeEngine(depthOverride);
    await engine.start();
    return engine;
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.sync();
  }

  async candidates(fen: string, depth: number): Promise<Candidate[]> {
    try {
      return await this.search(fen, depth);
    } catch (e) {
      if (e instanceof EngineFailure) throw e;
      this.restarts++;
      await this.restart();
      try {
        return await this.search(fen, depth);
      } catch (e2) {
        if (e2 instanceof EngineFailure) throw e2;
        // Same position stalls again: a real engine hang. Leave a fresh engine for the next game.
        await this.restart();
        throw new EngineFailure('hung', fen, (e2 as Error).message.split(';')[0]);
      }
    }
  }

  terminate(): void {
    this.send('quit');
    this.proc.stdin.end();
    this.proc.kill();
  }

  private async restart(): Promise<void> {
    this.proc.kill();
    await this.start();
  }

  private async start(): Promise<void> {
    const proc = spawn(process.execPath, [ENGINE_PATH], { stdio: 'pipe' });
    this.proc = proc;
    this.exited = null;
    createInterface({ input: proc.stdout }).on('line', (raw) => {
      if (proc !== this.proc) return;
      const line = raw.trim();
      this.recent.push(line);
      if (this.recent.length > 8) this.recent.shift();
      for (const fn of [...this.listeners]) fn(line);
    });
    proc.stderr.on('data', (d) => this.recent.push(`stderr: ${String(d).trim()}`));
    proc.on('exit', (code, signal) => {
      if (proc !== this.proc) return;
      this.exited = new Error(`engine exited (code ${code}, signal ${signal})`);
      for (const fn of [...this.failures]) fn(this.exited);
    });

    const ready = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    await ready;
    this.send(`setoption name MultiPV value ${MULTI_PV}`);
    await this.sync();
  }

  private async search(fen: string, depth: number): Promise<Candidate[]> {
    const lines = new Map<number, Candidate>();
    const onLine = (line: string) => {
      const info = parseInfo(line);
      if (info) lines.set(info.multipv, info.candidate);
    };
    this.listeners.add(onLine);
    const done = this.waitFor((l) => l.startsWith('bestmove') || UNSUPPORTED.test(l), `search of ${fen}`);
    this.send(`position fen ${fen}`);
    this.send(`go depth ${this.depthOverride ?? depth}`);
    let reply: string;
    try {
      reply = await done;
    } finally {
      this.listeners.delete(onLine);
    }
    if (UNSUPPORTED.test(reply)) {
      // Stockfish refuses the position and may never answer `go`; drain and report it.
      this.send('stop');
      await this.sync();
      throw new EngineFailure('rejected', fen, reply);
    }
    return [...lines.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  private send(cmd: string): void {
    if (!this.exited) this.proc.stdin.write(cmd + '\n');
  }

  private sync(): Promise<string> {
    const ready = this.waitFor((l) => l === 'readyok');
    this.send('isready');
    return ready;
  }

  /** Resolves on the first matching line; rejects if the engine exits or stays silent past TIMEOUT_MS. */
  private waitFor(match: (line: string) => boolean, what = 'engine reply'): Promise<string> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.delete(fn);
        this.failures.delete(fail);
      };
      const fail = (err: Error) => {
        cleanup();
        reject(new Error(`${err.message} waiting for ${what}; last output:\n  ${this.recent.join('\n  ')}`));
      };
      const fn = (line: string) => {
        if (!match(line)) return;
        cleanup();
        resolve(line);
      };
      const timer = setTimeout(() => fail(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
      if (this.exited) return fail(this.exited);
      this.listeners.add(fn);
      this.failures.add(fail);
    });
  }
}
