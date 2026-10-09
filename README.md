# Auto Chess Chess

An auto-battler built on chess. Draft an army, place it in your three home rows, and press **Fight**: Stockfish plays the round for both sides. Survive as many rounds as you can against stronger and stronger AI armies.

Runs in the browser and is built for phones first. **[Play it here](https://supacash.github.io/auto-chess-chess/).**

## How to play

1. **Shop.** You start with a king, 3 pawns and 3 gold. Buy pawns (1g) and upgrade pieces for the difference in their value:
   pawn → knight/bishop (2g) → rook (2g) → queen (4g). Selling refunds the piece's value minus 1.
2. **Place.** Drag or tap pieces into your three home rows. The king can't go on the front row, and pawns can't go on the back row.
   You can see which pieces the opponent has and its style, but not where they are.
3. **Fight.** The engine plays both sides. A round ends on checkmate, or after 30 moves each, when the side with more material wins.
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
| `npm run typecheck` | TypeScript check |
| `npm run build` | Typecheck + production build in `dist/` |
| `npm run sim` | Headless balance simulator (work in progress) |

`dev` and `build` first copy the Stockfish WASM engine from `node_modules` into `public/engine/`.

## Project layout

```
src/
  rules/    pure game logic: placement, economy, AI drafting, battle results, run state (unit tested)
  engine/   Stockfish web-worker wrapper and move picking
  game/     battle loop and save/load
  ui/       placement board and battle view (vanilla TS, Pointer Events)
  main.ts   app wiring and screen flow
scripts/    engine copy step and the balance simulator
```

Built with [Vite](https://vite.dev), TypeScript, [chess.js](https://github.com/jhlywa/chess.js) and [Stockfish.js](https://github.com/nmrugg/stockfish.js) (Stockfish 19, lite single-threaded WASM).

## License

This project's code is released under the [MIT License](LICENSE).

Stockfish is licensed under the GPLv3 and is not covered by the MIT License. It isn't stored in this repo and is installed from npm. Any build you distribute that includes it must comply with the GPLv3, including crediting Stockfish and offering its source.
