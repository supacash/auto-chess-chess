# Plan: replace Fairy-Stockfish and ffish with our own engine

## Context
Battles are played by Fairy-Stockfish (multithreaded WASM, configured through `variants.ini`), and ffish enforces the rules. We want to fully replace both with an engine of our own. The goals:
- Drop the GPL WASM.
- Drop cross-origin isolation (COOP/COEP headers, coi-serviceworker, the isolation reload, the `MainActivity` headers).
- Get a smaller and faster download on mobile.
- Own the bot's behaviour.

Your two constraints:
1. **No side may feel it got a dumber bot.** Both sides must search with exactly the same engine and budget, whatever the device.
2. **Manual "Play it" games must not get wrecked by real chess players.** The engine has to be about as strong as today's Fairy-Stockfish at depth 8, not just plausible.

**Runtime decision: Rust compiled to single-threaded WASM.**
- It is the fastest option on mobile, roughly 1.5–3× a TypeScript engine for this kind of code.
- Single-threaded WASM needs no SharedArrayBuffer, so isolation goes away. Today's engine already runs with `Threads 1`.
- The same crate builds a native binary for self-play and tuning, which is about 10× faster and runs in parallel. That is what makes reaching parity practical.
- Rust isn't installed yet. Phase 0 installs it.

**Clean room:** don't port any Stockfish or Fairy-Stockfish code, so the project stays MIT. Algorithms can come from public references such as the chessprogramming wiki. Fairy-Stockfish and ffish stay **devDependencies only**, as the test oracle and the sparring partner. They are never shipped.

**Realistic size:** about 7–10 weeks of focused work. Each phase ends at a gate, and phases 2 and 5 can ship on their own.

## Where it plugs in
- **Engine interface:** `MoveSource { newGame(variant), candidates(fen, depth, history) → Candidate[] }` at `src/game/runBattle.ts:20-29`.
  - Callers: `runBattle`, `manualBattle.opponentMove`, the replay eval hook (`main.ts:457-462`), `battleScreen.ts:423,496`, `matchController.ts:442,482`, and the scripts `sim.ts`, `duel.ts` and `check/determinism.ts`.
- **Picking and display (`src/engine/pick.ts`):** `pickMove`, `MULTI_PV = 3`, `PICK_MARGIN = 50`, and the mate encoding `±(100000 − n·100)`.
  - These stay as they are.
  - Only `parseInfo` and `positionCommand` go, since they exist for UCI.
- **Rules interface:** the `Game` class in `src/chess/rules.ts`: `fen`, `turn`, `isCheck`, `legalMoves`, `play`, `terminal`, `undo`, `delete`, plus `kingInCheck`. It also tracks Heir (J) squares.
  - Callers: `runBattle`, `manualBattle`, `battleScreen` replay, `achievements.ts:291-330`, `rules/position.ts:40`.
  - `rules/battle.ts` (`battleResult`) only reads `BattleState`, so it stays as it is.
- **Rules to reproduce** (from `boardSpec.ts:41-101`):
  - Boards 5×5 to 9×9.
  - About 15 Betza pieces, listed in `rules/pieces.ts`.
  - Pawn-like P and E.
  - No castling.
  - The two-step move only from each side's own rank 2.
  - Promotion on the last rank, with the default piece set.
  - The two-kings variant `accNk2`: commoner kings, `extinctionPseudoRoyal`, `dupleCheck = false`.
  - Repetition draws, the 50-move rule, insufficient material.
  - Exact edge cases (en passant, Berolina double step, two-king check rules) are **found by perft against ffish**, not guessed.

## Phases

### 0. Setup and baseline (1–2 days)
- Install rustup with the `wasm32-unknown-unknown` target, and `wasm-bindgen-cli`.
- Create the crate at `engine/` with:
  - `core`: board, move generation, search, evaluation.
  - `wasm`: bindings.
  - `cli`: a native binary for perft, self-play, tuning, and a UCI-like stdin protocol.
- CI: `cargo fmt --check`, `clippy`, `cargo test`. The WASM is built before `npm test`, `typecheck` and `build`.
  - `scripts/copy-engine.mjs` becomes `build-engine.mjs`, which runs `cargo build` + `wasm-bindgen` into `src/engine/wasm/` (gitignored).
- **Baseline:**
  - Record Fairy-Stockfish's depth-8 time per move on a mid-range Android phone and on desktop.
  - Record its score against itself, broken down by side and by who moves first.
  - These become the targets.

### 1. Rules core with perft parity (1.5–2 weeks)
- **Board:** a mailbox board per `BoardSpec`. Per-square move tables are built at setup for each board size: leaper targets, and slider rays as square lists. This works for any size up to 9×9; bitboards can't hold 81 squares.
- **Piece lists and hashing:** piece lists, incremental Zobrist hashing, and make/unmake moves.
- **Betza compiler:** compiles each piece's Betza string at startup. It covers exactly the subset in use:
  - Atoms: W F N C A D K Q R B, plus ranges such as `F2`.
  - Modifiers: m, c, f, i, n, p, g.
  - Adding a piece stays a one-line Betza change.
  - A unit test checks that every entry in `PIECES` compiles.
- **Rules:** royal king, plus the two-kings extinction mode, promotion, en passant, the two-step region, and terminal detection (checkmate, stalemate, repetition, 50-move rule, insufficient material, ply limit is left to `battle.ts`).
  - Matching ffish's fairy-piece insufficient-material logic exactly is optional. We can define our own rule in DESIGN.md.
- **Oracle harness (`scripts/check/perft.ts`):**
  - Generates positions with `draftAiArmy`, `placeAiArmy` and `placeForBattle` across every board size, every piece and Heir armies.
  - Runs mid-game positions from random playouts.
  - Compares legal-move sets and perft counts at depths 1–4 between the native CLI and ffish.
  - Also checks FEN round-trips.
- **Gate:** 0 mismatches on at least 10,000 positions.

### 2. Swap the rules and drop ffish (3–4 days) — can ship
- `src/chess/rules.ts`: `Game` keeps its API, backed by a synchronous WASM `Board`. The rules run on the main thread, which is fine because calls are microseconds.
- `loadRules.ts` and `testRules.ts` load our WASM instead of ffish.
- `variantsIni()` remains only for Fairy-Stockfish, which still searches during this phase.
- **Gate:**
  - `rules.test.ts`, the battle tests, `achievements` and `e2e` pass without edits.
  - `check:determinism` passes.
  - Bump `RULES_VERSION` only if the insufficient-material behaviour changed.

### 3. Search (1.5–2 weeks)
- **Core algorithm:**
  - Negamax with principal-variation search (PVS), iterative deepening, aspiration windows.
  - A fixed-size transposition table, cleared on `newGame`.
  - Quiescence search on captures and promotions.
- **Pruning and extensions:**
  - Null-move pruning, turned off when a side has only kings and pawns.
  - Late-move reductions (LMR) and check extensions.
- **Move ordering:** most-valuable-victim first (MVV-LVA), killer moves, history heuristic.
  - Static exchange evaluation (SEE) has to treat cannons and grasshoppers specially, so start without it.
- **MultiPV 3**, returned as `Candidate[]` in pick.ts's exact score and mate encoding.
  - Repetition detection uses the game history from `History`.
- **Determinism and fairness:**
  - Single-threaded, integer-only evaluation (no floats, so native and WASM agree bit for bit).
  - The search is limited by **depth plus a node cap, never wall-clock time**. Both sides get identical work on any phone, and replays reproduce exactly.

### 4. Evaluation and reaching strength parity (1.5–3 weeks; the open-ended part)
- **Evaluation terms:**
  - Material, starting from `PIECES` values. Tapered middlegame/endgame weights per piece.
  - Piece-square tables generated per board size: centralisation, pawn advancement, promotion threat.
  - Mobility counted from the move tables. Works for any piece.
  - King safety (attackers near the king), pawn structure.
  - Two-kings awareness.
- **Game-specific edge:** the engine knows the battle ends on points at the ply limit. As the limit nears, it weights material more. Fairy-Stockfish can't do this.
- **Tuning:**
  - Native self-play generates positions, then Texel tuning fits the evaluation weights.
  - Validate with sequential probability ratio tests (SPRT) in an arena.
- **Arena (`scripts/sim/arena.ts`):**
  - Built on `runBattle`, plus a small `MoveSource` that sends each move to engine A or engine B by side to move.
  - Uses game-like armies (the `duel.ts` setup) on every board size, with alternating colours.
- **Gates:**
  - **Strength:** at least 48% against Fairy-Stockfish depth 8 over at least 2,000 games.
  - **Speed:** p95 move time on the baseline phone at or below today's Fairy-Stockfish.
  - **Fairness:** the new engine against itself scores 50% ± noise by side and by first mover. This is your "my bot was dumber" check.
  - **Manual mode:** the same strength gate, run from manual-game-style positions.
- **Fallback if parity stalls:** a small NNUE (efficiently updated neural network) evaluation trained on positions scored by Fairy-Stockfish or by self-play. Adds 2–4 weeks.

### 5. Integration (≈1 week) — the engine swap ships
- **Browser:** `src/engine/engine.ts` implements `MoveSource` over a dedicated Web Worker (`engineWorker.ts`) that loads the WASM. The watchdog terminates and respawns the worker on a hang, replacing today's stop-and-restart logic.
  - The pre-search during move animation in `runBattle` stays.
  - `main.ts:313,324` create engines through the same `create()` call.
- **Node:** `scripts/sim/nodeEngine.ts` loads the WASM in-process, with `worker_threads` for parallel runs. `fairyProcess.cjs` stays only for arena and oracle runs.
- **Versioning:**
  - Add `ENGINE_VERSION` to `rulesFingerprint()` in `src/game/version.ts`, then bump `RULES_VERSION`.
  - Check how old `BattleRecord`s and online rooms handle a version mismatch. Online clients compute battles locally, so mixed versions must be refused.

### 6. Rebalance (3–5 days)
- Re-run the SIMULATION.md suite: piece prices with `sim:duel` and the AI budgets with `sim`.
- Adjust `pieces.ts` values if needed.
- Update SIMULATION.md and DESIGN.md (AI opponent section at :145 and :162, tech stack at :184 and :189).

### 7. Removal and cleanup (1–2 days)
- **Dependencies:** remove `fairy-stockfish-nnue.wasm`, `ffish-es6` and `coi-serviceworker` from `dependencies`. The first two move to devDependencies for the oracle and arena.
- **Isolation code:** delete:
  - `src/engine/stockfish.ts`
  - the coi script at `index.html:16-21`
  - the COOP/COEP headers in `vite.config.ts:5-14` and `MainActivity.java:31-42`
  - `reloadForIsolation` and the 4 s boot delay in `main.ts:337,494-527`
  - the GPL credits in `layout.ts:283`
  - the related `playwright.config.ts` assumptions
- **Docs:** update CLAUDE.md (Layout, Dependencies, Commands).

## Verification
- **Rust:** `cargo test`, with unit tests for the Betza compiler, make/unmake round-trips, Zobrist consistency and mate-in-N puzzles.
- **Oracle:**
  - Perft and legal-move parity against ffish (Phase 1 gate).
  - The native CLI and the WASM build produce identical move lists for the same corpus.
- **Repo checks:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run check:determinism` (on the new engine), `npm run e2e` and `npm run e2e:online`.
- **Arena gates:** the strength, fairness and speed numbers from Phase 4, written into SIMULATION.md.
- **Device check:**
  - Run the Android build: the app no longer reloads for isolation, a round plays with no service worker, and replay evals appear.
  - Also check Safari on iOS.

## Phase 0 results (2026-10-13)

**Done:**
- The Rust workspace `engine/` (`acc-core`, `acc-wasm`, `acc-cli`), with the toolchain pinned to 1.99.0.
- `scripts/build-engine.mjs`, which builds the WASM into `src/engine/wasm/`. It runs before dev, build, test and typecheck.
- `npm run engine:check`, also run in CI.
- A WASM smoke test (`src/engine/wasm.test.ts`).
- The bench corpus (`src/engine/benchCorpus.ts`), `npm run check:baseline`, and the dev-only `/bench.html`.

**Desktop baseline:** Fairy-Stockfish at depth 8, Windows, Node 26 (`docs/baseline/fairy-desktop.json`, seed 1).

| Board | p50 ms | p95 ms | max ms |
|---|---|---|---|
| 5×5 | 25 | 60 | 67 |
| 6×6 | 62 | 104 | 118 |
| 7×7 | 59 | 185 | 201 |
| 8×8 | 145 | 334 | 622 |
| 9×9 | 489 | 2603 | 2680 |

- Desktop Chrome gives the same numbers on `/bench.html`.
- **Fairness**, from 400 mirrored-army games over rounds 1–25:
  - White scores 46.7% ±5.0, which is not significant.
  - **The first mover scores 57.4% ±4.9.** That is the tempo advantage, already offset in part by `BLACK_DISCOUNT`.
  - 42 draws. End reasons: 186 checkmate, 186 move limit, 12 insufficient material, 6 repetition.
  - **10 games (all on 9×9) Fairy-Stockfish refused to play** ("Unsupported position"). Our engine has to handle these.
- **Targets for our engine:**
  - p95 time per move at or below these numbers on every board.
  - White score 50% within noise.
  - First-mover score no further from 50% than Fairy-Stockfish's. A bigger tempo edge would mean rebalancing.
  - 0 refused positions.
- **Phone:** the user has an iPhone, and Fairy-Stockfish needs HTTPS there. Desktop Chrome slowed 4–6× in DevTools stands in for a phone until the Phase 4 speed gate.

## Phase 1 results (2026-10-13)

**Gate passed:**
- `npm run check:perft` covered 10,000 positions on each of seeds 1 and 2: 1.38 million positions compared, **0 mismatches** against ffish.
- At each position it compares: the legal-move set, FEN, check, insufficient material and threefold repetition. About 9,000 positions per seed also had every child compared (depth 2).
- **Covered (per seed):**
  - about 37,000 checks, 8,300 repetitions, 1,000 insufficient-material positions
  - 1,600 checkmates, 120–220 stalemates
  - 3,000 two-kings walks, 3,000 positions with an en passant square

**The rules core (`engine/core`):**
- **`betza.rs`:** parses exactly the Betza subset the pieces use. It panics on anything else, so a new piece with unsupported movement fails a test instead of moving wrongly.
- **`tables.rs`:** per-board-size tables of leap targets, rays and capture masks.
- **`position.rs`:** FEN, legal moves, make/unmake, Zobrist hashing, check, threefold repetition, insufficient material and perft.
- The standard chess start position gives perft 20 / 400 / 8,902 / 197,281 / 4,865,609, which are the known values.
- The native `acc perft` runs at about 4M positions/s with plain make/unmake legality. Speed work comes in Phase 3.

**Fairy-Stockfish behaviours found by probing ffish:**
- Promotion is to Q/R/B/N only.
- A pawn's or Berolina pawn's double step only works from its own second rank. The Berolina's is non-jumping.
- The 50-move count resets on pawn moves, captures and promotions, but not on other Berolina pawn moves.
- **En passant:**
  - Only pawns capture en passant.
  - A pawn's double step sets the en passant square only if an enemy pawn could take it, even a pinned one.
  - A Berolina pawn's diagonal double step always sets it. A pawn may take the Berolina on the square it passed, and the FEN lists both squares in board order (e.g. `c3b4`).
- With two kings neither is royal, and both may be left attacked. The last king is royal.
- In the two-kings rules insufficient material never applies, even king against king.
- Otherwise insufficient material means: king against king, bishops all on one colour, or a single knight against a bare king. Any fairy piece counts as enough to mate.
- Threefold repetition is claimed when a position occurs for the third time since the last pawn move or capture.
- The grasshopper lands just past the first piece in line. The cannon captures the first piece beyond its screen.

**Also added:** the WASM `Board` (ffish's method names) and a test that the engine's Betza strings match `src/rules/pieces.ts`.
