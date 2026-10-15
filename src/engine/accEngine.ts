import type { MoveSource } from '../game/runBattle';
import type { Candidate, History } from './pick';
import { MULTI_PV, PICK_MARGIN } from './pick';
import { Searcher } from './wasm/acc';

import { ACC_LIMITS, type AccLimits } from './accSettings';

export { ACC_LIMITS, type AccLimits } from './accSettings';

/**
 * The game's own engine as a MoveSource, running the WASM build in this thread (the browser runs it in
 * a worker; phase 5). Ignores the depth the caller asks for and searches to its own limits. Needs the
 * WASM loaded (loadRules / loadRulesForNode).
 */
export class AccEngine implements MoveSource {
  private readonly searcher = new Searcher();
  private variant = 'acc8';

  constructor(limits: AccLimits = ACC_LIMITS) {
    this.searcher.configure(limits.depth, limits.nodes, MULTI_PV, PICK_MARGIN);
  }

  async newGame(variant: string, plyLimit?: number): Promise<void> {
    this.variant = variant;
    this.searcher.newGame();
    this.searcher.setPlyLimit(plyLimit ?? 0);
  }

  async candidates(fen: string, _depth: number, history?: History): Promise<Candidate[]> {
    const start = history?.fen ?? fen;
    const moves = history ? history.moves.join(' ') : '';
    const out = this.searcher.candidates(this.variant, start, moves);
    const words = out.split(' ').filter(Boolean);
    const lines: Candidate[] = [];
    for (let i = 0; i + 1 < words.length; i += 2) lines.push({ move: words[i], score: Number(words[i + 1]) });
    return lines;
  }

  /** Nodes the last search used. */
  nodes(): number {
    return this.searcher.nodes();
  }

  terminate(): void {
    this.searcher.free();
  }
}
