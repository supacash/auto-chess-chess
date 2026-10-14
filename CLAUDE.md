# Auto Chess²

Single-player auto-battler chess for the browser: draft and place an army, then an engine plays the round for both sides. **[DESIGN.md](DESIGN.md) is the source of truth for rules, economy and milestones** — read it before changing game logic, and update it when a design decision changes.

## Commands
- `npm run dev` — Vite dev server
- `npm test` — Vitest (rules unit tests)
- `npm run typecheck` — `tsc --noEmit` for the game, plus `-p scripts` for the simulator (TypeScript 7)
- `npm run lint` — Biome lint + format check (CI runs it); `npm run format` fixes formatting and safe lint issues
- `npm run build` — typecheck + production build
- `npm run e2e` — Playwright browser tests (whole runs in Chromium against the production build, plus landscape and 360px layout checks in `e2e/landscape.spec.ts`; CI runs them before deploying)
- `npm run test:rules` — Firestore security rules tests on the emulator (needs Java)
- `npm run e2e:online` — two-browser online room tests against the Firebase emulators
- `npm run android` — production build synced into the Capacitor Android project (`android/`); `npm run android:open` opens it in Android Studio. `node scripts/make-android-icons.mjs` regenerates its icons and splash from `public/icon.svg`
- `npm run check:determinism` — plays battles twice with the same seed and checks the moves match
- `npm run engine:check` — `cargo fmt --check`, clippy and tests for the Rust engine in `engine/` (CI runs it)
- `npm run check:perft` — rules parity: random games in our engine (WASM) and ffish side by side, comparing legal moves, FEN, check and draws at every position (`--positions 10000` is the Phase 1 gate). `cd engine && cargo run --release -p acc-cli -- perft acc8 5 "<fen>"` counts a perft natively
- `npm run check:baseline` — Fairy-Stockfish speed per move on the bench corpus, and colour/first-mover fairness on mirrored armies; `/bench.html` on the dev server times the same corpus in a browser or on a phone

## Layout
- `src/rules/` — pure game logic, no DOM. Every rule gets a unit test next to it (`*.test.ts`).
- `src/chess/` — board specs (`boardSpec.ts`, also generates the Fairy-Stockfish `variants.ini`), size-agnostic FEN helpers (`fen.ts`), and the rules `Game` wrapper around the game's own engine's WASM `Board` (`rules.ts`). The WASM loads async: `loadRules.ts` in the browser, `testRules.ts` in tests/the simulator.
- `src/engine/` — Fairy-Stockfish UCI wrapper (`stockfish.ts`) and move picking/UCI parsing (`pick.ts`, pure + tested). `benchCorpus.ts` is the fixed position set engines are timed on; `wasm/` holds the generated bindings of our own engine (gitignored), loaded in Node by `wasmNode.ts`.
- `engine/` — the game's own engine in Rust, replacing Fairy-Stockfish and ffish ([docs/ENGINE-PLAN.md](docs/ENGINE-PLAN.md)): `core` (rules, search, eval; pure, deterministic, integer-only), `wasm` (single-threaded bindings) and `cli` (native `acc` binary for perft, self-play and tuning). Toolchain pinned in `engine/rust-toolchain.toml`.
- `src/game/` — orchestration that combines rules and engine (`runBattle.ts`, `manualBattle.ts`, tested with a fake engine), plus the shareable formats: `version.ts` (RULES_VERSION and its fingerprint test), `snapshot.ts` (ArmySnapshot) and `record.ts` (BattleRecord for replays).
- `src/app/` — the app around the rules: `session.ts` (the run, opponent, best score, saving and run flow; no DOM, unit tested), the screens (`placementScreen.ts`, `battleScreen.ts`, `newRunDialog.ts`, `header.ts`) and the page shell (`layout.ts`).
- `src/multi/` — multiplayer match logic (pairings, health, streaks, bots) and `MatchSession`; pure and tested.
- `src/online/` — online rooms: `room.ts` (pure room rules, tested) and `client.ts` (Firestore; loaded lazily). `firestore.rules` guards the data (tests in `rules-test/`).
- `src/ui/` — reusable board widgets (Pointer Events, touch-first): the placement board, the battle view, and shared piece/square helpers in `boardDom.ts`.
- `src/main.ts` — wires the session to the screens and runs the fight sequence (placement → battle → result).
- `android/` — the Capacitor Android app. `MainActivity.java` adds the COOP/COEP headers the engine needs; `src/app/ads.ts` shows rewarded ads there (AdMob, test IDs until release).
- `scripts/copy-engine.mjs` copies Fairy-Stockfish and coi-serviceworker into `public/` (gitignored). It runs automatically before `dev` and `build`. `scripts/build-engine.mjs` builds `engine/` to WASM and runs `wasm-bindgen` (its CLI must match the crate, 0.2.129) into `src/engine/wasm/`, before `dev`, `build`, `test` and `typecheck`.

## Conventions
- Formatting is Biome's (2 spaces, single quotes, 120 columns, LF line endings via `.gitattributes`). Run `npm run format` before committing. ESLint/typescript-eslint can't run on TypeScript 7 (no JS API), which is why the project uses Biome.
- Coordinates: `Square { file: 0-7, rank: 0-7 }`. The player is always ranks 0–2 (shown at the bottom). The AI is ranks 5–7, mirrored when building engine positions.
- These rules differ from standard chess and are easy to get wrong: king not on the front home row, no pawns on the back home row, no castling, two-square pawn moves only from rank 2, temporary promotion, 90-ply limit with a material ("on points") tiebreak. See DESIGN.md.
- Keep rule functions pure and immutable (return new arrays). The UI re-renders from state.
- No UI framework. Vanilla TS + CSS variables. Mobile layout must work at a 360px width.
- Dependencies: Fairy-Stockfish WASM (`fairy-stockfish-nnue.wasm`, multithreaded, needs cross-origin isolation: COOP/COEP headers on the dev server, `coi-serviceworker` in production) (GPLv3), until our engine replaces it. The rules are our own engine (`engine/`); ffish (`ffish-es6`, GPLv3) is only a devDependency, the oracle for `npm run check:perft`. Test files and `testRules.ts` are typechecked by `scripts/tsconfig.json` (they use Node APIs).
- Randomness is always injected as an `Rng` (`src/rules/rng.ts`). Use `seededRng` in tests. Battles are deterministic from their start position and seed (engine options are pinned in `ENGINE_SETUP`); keep them that way.
- Bump `RULES_VERSION` (`src/game/version.ts`) whenever anything that decides a battle changes; `version.test.ts` catches the data-driven cases.
