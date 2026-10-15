# Auto Chess²

An auto-battler built on chess. Draft an army, place it in your home rows, and press **Fight**: a chess engine plays the round for both sides. Survive as many rounds as you can against stronger and stronger AI armies.

Runs in the browser and is built for phones first. **[Play it here](https://supacash.github.io/auto-chess-chess/)**, and use *Add to Home Screen* to install it as an app.

## How to play

1. **Shop.** You start with a king, 4 pawns (3 in Classic) and 3 gold. Each round the shop offers 4 random pieces (reroll for 1g), including fairy pieces like the Cannon and Berolina pawn. Upgrade pieces for the difference in their value:
   pawn → knight/bishop (2g) → rook (2g) → queen (4g). Fuse a Knight with a Bishop, Rook, Queen or Man for a compound piece, or three pawns into a Knight, Bishop or Man, for free. Selling refunds the piece's value minus 1.
2. **Place.** Drag or tap pieces into your home rows. In the default *Growing board* mode the board starts at 5×5 and grows every two rounds to 8×8; *Classic* mode is 8×8 throughout. The king can't go on the front row, and pawns can't go on the back row.
   You can see which pieces the opponent has and its style, but not where they are. Tap any piece to see what it does.
3. **Fight.** Pick *Auto fight* and the engine plays both sides, or *Play it* to move your own pieces against the engine (with Undo and Resign, and no move limit). A round ends on checkmate, or after a move limit (or when nobody can checkmate any more), when the side with more material wins on points.
4. **Repeat.** Every round you earn 5 gold, +2 for a win or +1 for a draw. A loss costs one of your 3 lives. Your score is the number of rounds won.

Your run is saved in the browser and resumes after a reload. Leaving in the middle of a battle counts as a loss.

The full rules, economy and AI styles are in [DESIGN.md](DESIGN.md).

## Running it

Requires a recent Node.js (22 or newer recommended).

```bash
npm install
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check (game and simulator) |
| `npm run build` | Typecheck + production build in `dist/` |
| `npm run sim` | Headless balance simulator (see [SIMULATION.md](SIMULATION.md)) |

`dev` and `build` first build the game's own chess engine (`engine/`, Rust) to WebAssembly. That needs [Rust](https://rustup.rs) and `cargo install wasm-bindgen-cli --version 0.2.129`.

`npm run dev:fairy` / `npm run build:fairy` build the game with Fairy-Stockfish instead, the engine it used before, kept so it can go back to it (see [docs/ENGINE-PLAN.md](docs/ENGINE-PLAN.md), "Going back to Fairy-Stockfish").

## Project layout

```
src/
  rules/    pure game logic: placement, economy, AI drafting, battle results, run state (unit tested)
  chess/    board sizes, FEN helpers and the rules wrapper (our engine)
  engine/   the engine in a Web Worker, move picking (and the old Fairy-Stockfish wrapper)
  game/     battle loop and save/load
  ui/       placement board and battle view (vanilla TS, Pointer Events)
  main.ts   app wiring and screen flow
engine/     the game's own chess engine (Rust → WebAssembly)
scripts/    engine build, the balance simulator and engine checks
```

Built with [Vite](https://vite.dev), TypeScript and the game's own chess engine in Rust (`engine/`), compiled to single-threaded WebAssembly. Its rules were checked move for move against [Fairy-Stockfish](https://github.com/fairy-stockfish/Fairy-Stockfish)'s, which played the battles until RULES_VERSION 9.

## License

This project's code is released under the [MIT License](LICENSE).

The chess piece images are the Chessnut set by Alexis Luengas, licensed under the Apache License 2.0 (see [src/assets/pieces/](src/assets/pieces/README.md)).

The game as built and deployed contains no GPL code. Fairy-Stockfish and ffish (both GPLv3, not covered by the MIT License) are development dependencies, used to test and measure our engine; they aren't stored in this repo. A `fairy` build (`npm run build:fairy`) does include Fairy-Stockfish: if you distribute one, it must comply with the GPLv3, including crediting it and offering its source (its footer does this).
