// The game's engine in a Web Worker (engine.ts talks to it): searches run here, off the page's
// thread, so animations stay smooth. One battle at a time per worker.
import { AccEngine } from './accEngine';
import type { History } from './pick';
import init from './wasm/acc';

export type WorkerRequest =
  | { id: number; type: 'newGame'; variant: string; plyLimit?: number }
  | { id: number; type: 'candidates'; fen: string; history?: History };

export type WorkerReply = { id: number; lines?: { move: string; score: number }[]; error?: string };

// The page's DOM typings don't describe a worker's global scope; its messaging matches a Worker's.
const scope = self as unknown as Worker;
const ready = init();
let engine: AccEngine | null = null;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  const reply = (r: Omit<WorkerReply, 'id'>) => scope.postMessage({ id: req.id, ...r } satisfies WorkerReply);
  try {
    await ready;
    engine ??= new AccEngine();
    if (req.type === 'newGame') {
      await engine.newGame(req.variant, req.plyLimit);
      reply({});
    } else {
      reply({ lines: await engine.candidates(req.fen, 0, req.history) });
    }
  } catch (e) {
    reply({ error: (e as Error).message });
  }
};
