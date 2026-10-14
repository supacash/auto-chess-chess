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

## Phase 3 progress (2026-10-14)

**Search** (`engine/core/src/search.rs`):
- Iterative deepening with aspiration windows, PVS and a transposition table (2^18 entries, cleared each battle).
- Quiescence search with delta pruning.
- Pruning and reductions: null move, reverse futility, futility, late-move pruning and reductions, check extensions.
- Move ordering: MVV-LVA, killers and history.
- MultiPV by excluding moves already chosen at the root.
- Limits are depth plus a node cap, never time.
- Scores are converted to pick.ts's mate encoding (`game_score`).

**Evaluation** (`eval.rs`), still a placeholder until Phase 4:
- Material from the game's point values, plus centralisation and pawn advancement.
- All of it lives in piece-square tables, so `Position` keeps it summed as moves are made and unmade (`put`/`take`).
- Piece counts are also kept up to date, which makes insufficient-material and null-move checks cheap.

**Tools:**
- `acc uci`: the UCI subset the scripts use.
- `NodeEngine.createAcc`.
- `npm run sim:arena`: against Fairy-Stockfish, or against another build with `--opponent`.

**Speed:** perft 3.7 → 7.0M positions/s. From the 8×8 start after 1.e4 e5, depth 8 with 3 lines went from 506k nodes in 1.04 s to 112k nodes in 0.19 s.

**Strength:** depth 8 with a 300k-node cap, from game-drafted battles over rounds 1–25.

| Version | vs Fairy-Stockfish depth 8 | Notes |
|---|---|---|
| First search | 27.4% ±6.2 (Elo −169), 200 games | |
| + aspiration, pruning, buffers | **41.0% ±5.6 (Elo −64)**, 300 games | Elo +111 over the first search head to head (65.5%, 300 games) |

**By board, latest:**
- 5×5 57%, 6×6 41%, 7×7 45%, 8×8 56%, 9×9 36%.
- 9×9 is most of the games and the weakest board.
- Fairy-Stockfish failed (rejected or hung) in 7 of the 9×9 games. Our engine played all of them.

**Still to do in Phase 3:**
- WASM `Searcher` bindings, and a browser and WASM speed check on the bench corpus.
- More speed. Average time per move under 14-way load is 453 ms for ours against 295 ms for Fairy-Stockfish.

The evaluation (Phase 4) is the main remaining strength lever.

**Correction to Phase 0:** the baseline's fairness numbers stand, but the individual games aren't reproducible. Under 14-way load Fairy-Stockfish sometimes passes its 10 s timeout and is restarted mid-battle, which changes the later moves. Replayed one at a time, the old (ffish) and new rules give identical battles (supacash/auto-chess-chess#4).

**WASM speed** (desktop, one engine, ms per search on the same bench corpus):

| Board | Ours (WASM, depth 8 / 300k nodes) p50 / p95 | Fairy-Stockfish depth 8 p50 / p95 |
|---|---|---|
| 5×5 | 13 / 65 | 24 / 63 |
| 6×6 | 78 / 289 | 68 / 166 |
| 7×7 | 139 / 353 | 69 / 133 |
| 8×8 | 274 / 398 | 124 / 300 |
| 9×9 | 552 / 668 | 634 / 2792 (one position refused) |

- The node cap bounds our worst case. On 9×9 our p95 is a quarter of Fairy-Stockfish's.
- On 6×6–8×8 we're slower: the speed gate (p95 at or below Fairy-Stockfish's on every board) isn't met yet.
- **The corpus has changed since Phase 0:** its random plies now use our rules' move order. Both engines above were timed on the current corpus.

## Phase 4 progress (2026-10-14)

**The battle rules in the search:**
- At the move limit, and when neither side can mate (insufficient material), the side ahead on points wins, as `src/rules/battle.ts` decides it.
- Our search now scores both as wins or losses (`POINTS_WIN` = 20,000, below the mates it can see). The game passes the move limit to the engine through `MoveSource.newGame(variant, plyLimit)`. In the UCI protocol it's the `PlyLimit` option; in WASM it's `Searcher.setPlyLimit`.
- Near the limit the same position is worth different things at different distances from it, so the plies left (capped at 48) are part of the transposition table's key.
- Fairy-Stockfish scores insufficient material as a draw and doesn't know the limit.
- **Measured:** 39.2% ±5.6 against Fairy-Stockfish, from 41.0% on the same starts. That's no measurable change in 300 games; the head-to-head test is still to do.

**A tunable evaluation (`eval.rs`):** terms with separate middlegame and endgame weights, blended by the non-pawn material left (capped at 8 points per file).
- **Per piece type:** value, centralisation and advancement. These are piece-square terms, summed as moves are made and unmade.
- **Passed pawns:** a weight for each number of ranks left to go (1–8).
- **King shelter:** own pieces next to the royal king.
- **Tempo.**
- `params.rs` holds the tuned weights, or `None` for the hand-set defaults.
- A test checks that `features()` reproduces `evaluate()` exactly.

**The tuning pipeline:**
- `npm run sim:starts` writes game-drafted battle starts.
- `acc selfplay` plays them engine against itself, natively and in parallel, picking moves as the game does. It writes every position with the battle's result.
- `acc tune` keeps the quiet positions and fits all the weights at once with Texel tuning (Adam, exact gradient, a slight pull towards the starting weights). It writes `params.rs`.

**First tuning run:**
- 20,000 self-play battles at 20k nodes per move gave 795k positions; 504k were quiet.
- Prediction error fell from 0.1417 to 0.1291.
- Piece values stayed close to the game's points. Most of the change is in the positional terms.
- **Head to head:** 52.5% ±5.7 (Elo +17) against the untuned build at the same budget. That's within noise.
- **Fix found along the way:** the quiet-position filter's capture search needed a node cap (5,000). Crowded 9×9 positions with cannons made it run without end.

**Scope decision (2026-10-14, the user):** the gate is measured on 5×5–8×8 for now. The game may temporarily cap the board at 8×8. If it does, rounds 9–25 are played on 8×8 with their own armies (`sim:arena --max-board 8`).

**Todo, 9×9:**
- It's most of the games under the current rules, and our weakest board (about 35% against Fairy-Stockfish at 300k nodes).
- Fairy-Stockfish spends 0.6–2.8 s per move there, so a bigger node budget for 9×9 is the first thing to try. Per-board budgets would need `ACC_LIMITS` to depend on the board.
- Revisit before the board grows back to 9×9.

**Quiescence explosion (the big one):**
- On crowded late-round 8×8 boards the engine didn't finish even depth 1 within its node budget. The capture search ran on through cannon and fairy-piece capture chains.
- The search then returned no move, and runBattle played a **random** legal move.
- **Fixes:**
  - The quiescence search stops after 8 plies.
  - It skips losing captures: a more valuable piece taking a defended one.
  - The node limit can't stop the search before depth 1 is done.
- **Results:**
  - Mean depth reached on late 8×8 positions: 2.0 → 4.6. Every search now returns a move.
  - Against Fairy-Stockfish, capped at 8×8 over rounds 1–25: **38.3% → 53.5% ±5.6** at 300k nodes.

**Cheaper move picks (`Searcher::search_picks`, the `PickMargin` UCI option):**
- The game only picks at random among moves within 50 cp of the best, so exact MultiPV isn't needed.
- It searches one principal line, then runs zero-window tests of up to 12 other moves against best − 50, with a quarter of the budget on top. The moves that pass are reported at best − 50.
- 49.8% ±5.7 against Fairy-Stockfish, the same within noise.

**Speed:**
- The check test made after a move is reused by the next node.
- Passed-pawn terms are cached by a pawn-only hash.
- Searches are identical, about 20% faster.
- Search stops deepening once it finds a mate.

**Budget:** at 150k nodes the score is 51.3% ±5.7 against Fairy-Stockfish, with time per move about halved. `ACC_LIMITS` is now depth 8 / 150k nodes.

**WASM speed at 150k nodes** (ms per move, median / p95; Fairy-Stockfish on the same corpus in brackets):

| Board | Ours | Fairy-Stockfish | p95 gate |
|---|---|---|---|
| 5×5 | 7 / 27 | 24 / 63 | ✅ |
| 6×6 | 36 / 68 | 68 / 166 | ✅ |
| 7×7 | 62 / 161 | 69 / 133 | ❌ |
| 8×8 | 94 / 200 | 124 / 300 | ✅ |
| 9×9 | 329 / 814 | 634 / 2792 | ✅ (out of scope) |

### Phase 4 gates (2026-10-14), depth 8 / 150k nodes, boards up to 8×8

- **Strength: passed.** 49.7% ±2.2 (Elo −2) over 2,000 games against Fairy-Stockfish depth 8 (arena seed 7, `--max-board 8`). The bar was 48%.

  | Board | Score |
  |---|---|
  | 5×5 | 60.1% |
  | 6×6 | 45.8% |
  | 7×7 | 47.3% |
  | 8×8 | 49.4% |

  Rounds 1–8 score 49.2% and rounds 9–25 (on 8×8) 50.0%.
- **Fairness: passed.** 400 mirrored-army games of our engine against itself:

  | | Ours | Fairy-Stockfish |
  |---|---|---|
  | White | 51.5% ±4.9 | 46.7% |
  | First mover | 57.0% ±4.9 | 57.4% |

  No colour bias, and the tempo edge is no bigger than Fairy-Stockfish's.
- **Speed: passed except 7×7 p95** (161 ms against 133). See the WASM table above. Median times beat Fairy-Stockfish on every board.
- **Manual-mode strength:** not run separately yet. The arena already plays from the same game-drafted starts the player gets.

## Phase 5 results (2026-10-14)

**Our engine plays the game's battles now.**
- **Worker:** `src/engine/engine.ts` is the `Engine` the game uses. It runs our WASM engine in a module Web Worker (`engineWorker.ts`, Vite `worker.format: 'es'`) with the same `MoveSource` interface.
- **Safety net:** a failed or silent worker (30 s) is replaced and told the battle again, and the search returns no lines, so runBattle plays a random move.
- **Callers:** main.ts and matchController import it in place of the Fairy-Stockfish wrapper.
- **The move limit reaches the engine:** runBattle passes it to `newGame`.

**Versioning:**
- `RULES_VERSION` 9. The fingerprint now covers `acc`, `ENGINE_VERSION`, `ACC_LIMITS`, MultiPV and the pick margin.
- `src/engine/accSettings.ts` holds the limits and version. `accEngine.test.ts` checks the TS version matches the WASM build.
- **Online rooms don't check rule versions.** Each battle is computed on one phone and its result shared, so mixed versions can't desync a room. A player on an old cached build would compute their battles with Fairy-Stockfish, though, so gating rooms by version is a follow-up.

**Scripts:**
- sim, duel and determinism now use our engine (native). `sim --depth N` still runs Fairy-Stockfish at that depth.
- The arena and baseline compare against Fairy-Stockfish explicitly.
- `/bench.html` times our engine, or Fairy-Stockfish with `?engine=fairy`.
- The native UCI path now sends Heirs as `J`, as the game's FENs do. It used to convert them to kings for Fairy-Stockfish, which made the native and WASM engines evaluate Heir battles differently.

**Checks:**
- `check:determinism`: 12 battles, each played twice on WASM and once natively (5×5, 8×8, 8×8 with an Heir, 9×9). All identical.
- `test`: 320 tests pass.
- `e2e`: 11 tests pass on the production build. They run in 33 s, from 45–55 s with Fairy-Stockfish.
- **Download:** the engine WASM is 52 KB gzipped, against about 800 KB for both Fairy-Stockfish WASMs before.

**9×9 since the quiescence fix:** 49.6% ±6.4 against Fairy-Stockfish (240 games, rounds 9–25, 150k nodes), with time per move about the same (291 against 299 ms under load). The 9×9 weakness was the same quiescence bug, so the board may not need capping at 8×8.
