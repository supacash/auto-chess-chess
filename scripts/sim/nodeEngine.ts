import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { type Candidate, parseInfo } from '../../src/engine/pick';
import type { MoveSource } from '../../src/game/runBattle';

const require = createRequire(import.meta.url);
const ENGINE_PATH = require.resolve('stockfish/bin/stockfish-19-lite-single.js');
/** Same as src/engine/stockfish.ts. */
const MULTI_PV = 3;

/**
 * Node counterpart of src/engine/stockfish.ts: the same UCI flow, but the Stockfish lite build
 * runs as a child process talking over stdin/stdout instead of a web worker.
 * `depthOverride` replaces the depth runBattle asks for (for tuning experiments).
 */
export class NodeEngine implements MoveSource {
  private readonly listeners = new Set<(line: string) => void>();

  private constructor(
    private readonly proc: ChildProcessWithoutNullStreams,
    private readonly depthOverride?: number,
  ) {
    createInterface({ input: proc.stdout }).on('line', (line) => {
      for (const fn of [...this.listeners]) fn(line.trim());
    });
  }

  static async create(depthOverride?: number): Promise<NodeEngine> {
    const proc = spawn(process.execPath, [ENGINE_PATH], { stdio: 'pipe' });
    const engine = new NodeEngine(proc, depthOverride);
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

  async candidates(fen: string, depth: number): Promise<Candidate[]> {
    const lines = new Map<number, Candidate>();
    const onLine = (line: string) => {
      const info = parseInfo(line);
      if (info) lines.set(info.multipv, info.candidate);
    };
    this.listeners.add(onLine);
    const done = this.waitFor((l) => l.startsWith('bestmove'));
    this.send(`position fen ${fen}`);
    this.send(`go depth ${this.depthOverride ?? depth}`);
    await done;
    this.listeners.delete(onLine);
    return [...lines.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  terminate(): void {
    this.send('quit');
    this.proc.stdin.end();
    this.proc.kill();
  }

  private send(cmd: string): void {
    this.proc.stdin.write(cmd + '\n');
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
