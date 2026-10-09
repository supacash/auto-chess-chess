import { variantsIni } from '../chess/boardSpec';
import { type Candidate, ENGINE_SETUP, type History, parseInfo, positionCommand } from './pick';

/**
 * Fairy-Stockfish (WASM, multithreaded build) running in the page. It needs SharedArrayBuffer, so the
 * page must be cross-origin isolated: coi-serviceworker (index.html) arranges that on hosts like GitHub
 * Pages that can't send COOP/COEP headers. Files are copied to public/fairy/ at build time.
 */
const ENGINE_DIR = `${import.meta.env.BASE_URL}fairy/`;
/** A search or handshake that takes longer than this is treated as a hung engine. */
const TIMEOUT_MS = 10_000;

interface FairyInstance {
  postMessage(cmd: string): void;
  addMessageListener(fn: (line: string) => void): void;
  FS: { writeFile(path: string, data: string): void };
}

declare global {
  interface Window {
    Stockfish?: (opts?: { locateFile?: (file: string) => string }) => Promise<FairyInstance>;
  }
}

let scriptLoaded: Promise<void> | null = null;

function loadScript(): Promise<void> {
  scriptLoaded ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = `${ENGINE_DIR}stockfish.js`;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error('Could not load the chess engine'));
    document.head.appendChild(el);
  });
  return scriptLoaded;
}

/**
 * Minimal UCI wrapper around Fairy-Stockfish. One search at a time.
 * A search that hangs returns no candidates, so the battle falls back to a random legal move,
 * and a fresh engine instance replaces the stuck one.
 */
export class Engine {
  private readonly listeners = new Set<(line: string) => void>();
  private instance!: FairyInstance;
  private variant = '';

  private constructor() {}

  static async create(): Promise<Engine> {
    if (!crossOriginIsolated) {
      throw new Error('This browser blocked the engine (the page is not cross-origin isolated). Try reloading.');
    }
    await loadScript();
    const engine = new Engine();
    await engine.start();
    return engine;
  }

  async newGame(variant: string): Promise<void> {
    if (variant !== this.variant) {
      this.send(`setoption name UCI_Variant value ${variant}`);
      this.variant = variant;
    }
    this.send('ucinewgame');
    if (!(await this.sync())) await this.restart();
  }

  /** Searches `fen` to `depth` and returns the top lines, best first. Empty if the engine can't search it. */
  async candidates(fen: string, depth: number, history?: History): Promise<Candidate[]> {
    const lines = new Map<number, Candidate>();
    const onLine = (line: string) => {
      const info = parseInfo(line);
      if (info) lines.set(info.multipv, info.candidate);
    };
    this.listeners.add(onLine);
    const done = this.waitFor((l) => l.startsWith('bestmove'));
    this.send(positionCommand(fen, history));
    this.send(`go depth ${depth}`);
    const reply = await done;
    this.listeners.delete(onLine);

    if (reply === null) {
      console.warn(`Chess engine hung on ${fen}; restarting it`);
      await this.restart();
      return [];
    }
    return [...lines.entries()].sort(([a], [b]) => a - b).map(([, c]) => c);
  }

  private async start(): Promise<void> {
    const instance = await window.Stockfish!({ locateFile: (file) => `${ENGINE_DIR}${file}` });
    this.instance = instance;
    instance.addMessageListener((line) => {
      if (instance !== this.instance) return;
      for (const fn of [...this.listeners]) fn(line);
    });
    const ready = this.waitFor((l) => l === 'uciok');
    this.send('uci');
    if ((await ready) === null) throw new Error('The chess engine did not start');
    instance.FS.writeFile('/variants.ini', variantsIni());
    this.send('setoption name VariantPath value /variants.ini');
    for (const cmd of ENGINE_SETUP) this.send(cmd);
    if (this.variant) this.send(`setoption name UCI_Variant value ${this.variant}`);
    if (!(await this.sync())) throw new Error('The chess engine did not start');
  }

  private async restart(): Promise<void> {
    this.send('quit');
    this.listeners.clear();
    await this.start();
  }

  private send(cmd: string): void {
    this.instance.postMessage(cmd);
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
