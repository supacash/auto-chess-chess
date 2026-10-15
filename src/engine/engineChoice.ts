/**
 * Which engine plays the battles. The game's own engine by default; `vite --mode fairy` (`npm run
 * dev:fairy`, `npm run build:fairy`) builds the old setup instead: Fairy-Stockfish, the cross-origin
 * isolation it needs (coi-serviceworker, COOP/COEP headers) and RULES_VERSION 8. It's kept working so
 * the game can go back to Fairy-Stockfish quickly if it has to (docs/ENGINE-PLAN.md, "Going back").
 * Node scripts and tests (no Vite env) always use our engine.
 */
export const USE_FAIRY: boolean = import.meta.env?.VITE_ENGINE === 'fairy';
