/** How far our engine searches: plies and a node budget. Never time, so every device plays the same battle. */
export interface AccLimits {
  depth: number;
  nodes: number;
}

/** The limits battles use (docs/ENGINE-PLAN.md, phase 4: on par with Fairy-Stockfish at depth 8). */
export const ACC_LIMITS: AccLimits = { depth: 8, nodes: 150_000 };

/**
 * The engine's version (acc_core::ENGINE_VERSION, checked by accEngine.test.ts): part of the rules
 * fingerprint, since the engine decides battles. Bump both whenever its search or evaluation changes.
 */
export const ENGINE_VERSION = 2;
