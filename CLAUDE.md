# Auto Chess Chess

Single-player auto-battler chess for the browser: draft and place an army, then an engine plays the round for both sides. **[DESIGN.md](DESIGN.md) is the source of truth for rules, economy and milestones** — read it before changing game logic, and update it when a design decision changes.

## Commands
- `npm run dev` — Vite dev server
- `npm test` — Vitest (rules unit tests)
- `npm run typecheck` — `tsc --noEmit` for the game, plus `-p scripts` for the simulator (TypeScript 7)
- `npm run lint` — Biome lint + format check (CI runs it); `npm run format` fixes formatting and safe lint issues
- `npm run build` — typecheck + production build

## Layout
- `src/rules/` — pure game logic, no DOM. Every rule gets a unit test next to it (`*.test.ts`).
- `src/chess/` — board specs (`boardSpec.ts`, also generates the Fairy-Stockfish `variants.ini`), size-agnostic FEN helpers (`fen.ts`), and the rules `Game` wrapper around ffish (`rules.ts`). ffish loads async: `loadRules.ts` in the browser, `testRules.ts` in tests/the simulator.
- `src/engine/` — Fairy-Stockfish UCI wrapper (`stockfish.ts`) and move picking/UCI parsing (`pick.ts`, pure + tested).
- `src/game/` — orchestration that combines rules and engine (`runBattle.ts`, tested with a fake engine).
- `src/ui/` — DOM rendering and input (Pointer Events, touch-first). `boardDom.ts` holds shared glyph and square helpers.
- `src/main.ts` — app wiring and phase flow (placement → battle → result).
- `scripts/copy-engine.mjs` copies Fairy-Stockfish, ffish and coi-serviceworker into `public/` (gitignored). It runs automatically before `dev` and `build`.

## Conventions
- Formatting is Biome's (2 spaces, single quotes, 120 columns, LF line endings via `.gitattributes`). Run `npm run format` before committing. ESLint/typescript-eslint can't run on TypeScript 7 (no JS API), which is why the project uses Biome.
- Coordinates: `Square { file: 0-7, rank: 0-7 }`. The player is always ranks 0–2 (shown at the bottom). The AI is ranks 5–7, mirrored when building engine positions.
- These rules differ from standard chess and are easy to get wrong: king not on the front home row, no pawns on the back home row, no castling, two-square pawn moves only from rank 2, temporary promotion, 90-ply limit with a material ("on points") tiebreak. See DESIGN.md.
- Keep rule functions pure and immutable (return new arrays). The UI re-renders from state.
- No UI framework. Vanilla TS + CSS variables. Mobile layout must work at a 360px width.
- Dependencies: Fairy-Stockfish WASM (`fairy-stockfish-nnue.wasm`, multithreaded, needs cross-origin isolation: COOP/COEP headers on the dev server, `coi-serviceworker` in production) and ffish (`ffish-es6`) for rules on any board size. Both GPLv3. Test files and `testRules.ts` are typechecked by `scripts/tsconfig.json` (they use Node APIs).
- Randomness is always injected as an `Rng` (`src/rules/rng.ts`). Use `seededRng` in tests.
