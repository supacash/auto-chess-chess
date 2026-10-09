# Auto Chess Chess — Design Document

The source of truth for how the game works. Update it whenever a rule or tuning decision changes.
Balance numbers come from the simulator; see [SIMULATION.md](SIMULATION.md) for the data behind them.

## Pitch
Draft and place a chess army, then watch an engine play the round for both sides. Survive as long as you can against stronger and stronger AI armies, on a board that grows as the run goes on.

## Scope today
- Single player against AI-drafted armies.
- Mobile-first web app with touch drag-and-drop, live on GitHub Pages. It can be wrapped as an app later (e.g. Capacitor).
- No accounts or server. The run in progress and best scores live in the browser (localStorage).

## Core loop
1. **Shop.** Spend gold on the round's shop offers and upgrades, and fuse pieces. You see the opponent's style and piece list (and, with Reveal on, where its pieces are).
2. **Place.** Arrange your army in your home rows. Extras wait on the bench.
3. **Battle.** Each round, pick **Auto fight** (the engine plays both sides; you watch, with an eval bar and 1×/2×/4×/Skip playback) or **Play it** (you move your own pieces; the engine plays the opponent exactly as in auto battles).
4. **Result.** Win, lose or draw. Gold is paid out; a loss costs a life.
5. Repeat until you're out of lives.

## Runs
- **3 lives.** A loss costs one; a draw costs none. The score is rounds won.
- **New run window** (opens from *New run*, from the game-over screen, and on a first visit) sets the run's settings, which are fixed for the whole run:
  - **Board (game mode):** *Growing board* (default; 5×5 growing to 8×8, see Board sizes) or *Classic* (8×8 throughout).
  - **Difficulty:** how fast the AI's budget grows: Easy 5×round, Normal 6×round (default), Hard 7×round.
  - **Play as:** White (default; you move first), Black (the opponent moves first) or Random each round. Your pieces are always white to the engine; playing Black only swaps the colours on screen and who moves first.
  - **Fairy pieces** (default on): fairy pieces in the shop and in AI armies, and fusion. Off = standard chess pieces only.
  - **Reveal opponent's placement:** an easier option that shows where the AI's pieces are during placement.
  - Starting a new run while one is in progress warns that it will be abandoned.
- **Best score** is kept per mode and difficulty.
- **Saving:** the run (army, gold, lives, record, settings and the current opponent) is saved after every change, so a reload resumes it. Saves carry a format version and are migrated when the format changes; runs saved before game modes existed load as Classic.
- **No replays:** when a battle ends, the game moves straight to the next round and drafts its opponent, so reloading on the result screen can't replay a round. Leaving or reloading *during* a battle counts as a loss on the next load (with a notice). A battle that fails with an error doesn't count.

## Pieces and economy
| Piece | Value | Cost |
|---|---|---|
| Pawn | 1 | From shop offers (1 gold) |
| Knight / Bishop | 3 | Pawn + 2 gold |
| Rook | 5 | Knight/Bishop + 2 gold |
| Queen | 9 | Rook + 4 gold |
| King | — | Free, always owned, can't be sold |

- An upgrade costs the difference in value, so gold spent always equals army points.
- **Start:** 3 gold plus King + 4 pawns (Growing) or King + 3 pawns (Classic).
- **Income:** 5 gold per round, +2 for a win, +1 for a draw.
- **Selling** refunds value minus 1 (minimum 0).
- **Army cap:** 16 pieces including the king. There's no limit on the mix of pieces.
- **Board space:** you can own more than fits; extras wait on the bench until the board grows.
- Pieces lost in battle come back for the next round.
- **Shop offers:** 4 random pieces each round, each priced at its value, bought onto the bench. Offers cost at most 2 + 2×round (Rooks from round 2, Queens from round 4). Reroll: 1 gold. Fusion pieces are never offered. With fairy pieces off, offers are standard pieces only.
- **Piece info:** tapping any piece (yours, a shop offer, or the opponent's in its list or on the revealed board) shows its value and how it moves.
- **No single-pawn purchases:** pawns come from shop offers (Pawn and Berolina pawn are the most common offers).
- **Pawn fusion:** three pawns (Berolina pawns count) fuse into a Knight or Bishop, or a Man with fairy pieces on. Free and points-neutral: it frees two board squares. The result takes the chosen pawn's square; benched pawns are used up first.
- **Fusion** (fairy pieces on): free. Knight + Bishop → Archbishop, Knight + Rook → Chancellor, Knight + Queen → Amazon, Knight + Man → Centaur. The selected piece becomes the compound where it stands; the partner is used up. Fused pieces sell for value − 2 (the same as selling both parts).

### Fairy pieces
Values are tuned with the simulator (SIMULATION.md section 11): at equal points, AI armies with fairy pieces do as well as standard ones.

| Piece | Value | Moves |
|---|---|---|
| Berolina pawn | 1 | Moves diagonally forward (two squares from rank 2), captures straight ahead; promotes like a pawn |
| Ferz | 1 | One square diagonally |
| Wazir | 1 | One square straight |
| Man | 3 | Like a king, but can be captured |
| Camel | 2 | Jumps (3,1) |
| Grasshopper | 1 | Along queen lines, hopping over a piece to land just beyond it |
| Cannon | 3 | Moves like a rook; captures by jumping over exactly one piece (Xiangqi) |
| Centaur | 5 | King + Knight (fusion) |
| Archbishop | 7 | Bishop + Knight (fusion) |
| Chancellor | 8 | Rook + Knight (fusion) |
| Amazon | 12 | Queen + Knight (fusion) |

## Board sizes
In Growing mode the board opens up during the run:

| Rounds | Board | Home rows each | Home squares | Gap between armies | Move limit |
|---|---|---|---|---|---|
| 1–2 | 5×5 | 2 | 10 | 1 row | 60 plies (30 moves each) |
| 3–4 | 6×6 | 2 | 12 | 2 rows | 70 plies |
| 5–6 | 7×7 | 2 | 14 | 3 rows | 80 plies |
| 7+ | 8×8 | 3 | 24 | 2 rows | 90 plies |

- Classic uses the 8×8 row throughout.
- Placed pieces keep their squares when the board grows; a notice announces the new size.
- The engine supports boards up to 12×10. Measurements for 10×10 are in [docs/SPIKE-FAIRY.md](docs/SPIKE-FAIRY.md); bigger boards would need a longer move limit (two-thirds of 10×10 battles hit 90 plies).

## Placement rules
- You own the bottom home rows; the AI owns the same number at the top (mirrored).
- The king can't go on the front home row; pawns can't go on the back row.
- A pawn on your second rank may move two squares on its first move. No castling.
- Promotion works as normal (the engine picks the piece) and lasts only for that battle.

## Battle rules
- **Playing it yourself:** tap a piece then a highlighted square, or drag it. No move limit: the game ends on the board (checkmate, stalemate, repetition, insufficient material on points, the 50-move rule) or by resigning (a loss; it takes two taps). **Undo** takes back your last move and the opponent's reply. The eval bar is hidden until the game ends. The game is saved after every move, so closing or reloading the page resumes it instead of counting a loss.
- **Insufficient material** (nobody can mate) is decided on points like the move limit; level material is a draw.
- **Repetition:** the engine is given the moves played so far, so it sees repeated positions as draws and the side that is ahead avoids them.
- **First move:** White, i.e. the player unless they play Black (see Play as), unless a king starts in check (that side moves first). If both kings start in check, the AI re-places its army.
- **Move limit:** 10 × board size + 10 plies.
- **Win:** checkmate, or more material at the move limit, shown as a win/defeat **on points**.
- **Draw:** equal material at the limit, stalemate, threefold repetition, the 50-move rule, or insufficient material.

## AI opponent
- **Engine:** Fairy-Stockfish (WASM) plays both sides with identical settings: depth 8, MultiPV 3, picking randomly among moves within ~50 centipawns of the best for variety. Skill is in drafting and placement, not a better engine.
- **Budget per round:** difficulty × round, ±1 random, −1 in round 1, and +1 every round in Growing mode (matching its extra starting pawn so both modes have the same balance).
- **Styles** (a new style and army each round, shown during placement):

  | Style | Draft | Layout |
  |---|---|---|
  | Balanced | ~35% pawns, an even mix | King on d/e behind a pawn shield |
  | Fortress | ~60% pawns, minor pieces and rooks | King tucked in a corner behind a full pawn wall |
  | Heavy Artillery | ~15% pawns, queens and rooks | Rooks on the back row, queen central |
  | Cavalry Charge | ~25% pawns, knights and bishops | Pieces pushed forward; the hardest style to beat |
  | Menagerie (fairy only) | ~30% pawns, mostly fairy pieces, many Berolina pawns | Pieces a little forward |

- **With fairy pieces on**, every style also drafts its own fairy pieces (Fortress: Ferz, Wazir, Man, Cannon; Heavy Artillery: Cannon, Chancellor, Archbishop, Amazon; Cavalry: Camel, Centaur, Archbishop; Balanced: a little of each), some of its pawns are Berolina pawns, and its leftover points can go into fusions (as if it had bought the partner). Fairy pieces are placed like the standard piece they resemble (short-range ones like knights, cannons like rooks).

- **Drafting:** non-pawn pieces by the style's weights, the rest on pawns (at most 8, and only as many as fit), then leftover points into upgrades. Armies never exceed the board's home squares.
- **Placement:** each square is scored per piece for the style (tables written for 8×8 and scaled to smaller boards), with random noise and a random left/right flip. Pieces leave room for the pawns placed after them.
- **Engine safety net:** a search over 10 seconds plays a random legal move instead and restarts the engine.

## Look and feel
- Chessnut SVG pieces (Apache 2.0). The board always shows the player at the bottom, and squares scale so every board size fills the same width.
- Moves animate at ~0.4 s at 1×, with an eval bar from the player's side.
- Results name the reason ("Victory on points", "Drawn by threefold repetition").

## Tech
- Vite + TypeScript 7, no UI framework. Biome for formatting and linting.
- Rules: ffish.js; engine: Fairy-Stockfish WASM (multithreaded, so the page is cross-origin isolated; coi-serviceworker provides this on GitHub Pages).
- Code layout and conventions: see [CLAUDE.md](CLAUDE.md).

## Known issues
- **5×5 draws:** round 1 in Growing mode drew ~38% of the time; deciding insufficient material on points and showing the engine the move history brought that to 17% (SIMULATION.md section 12).
- **Safari / iOS:** the engine needs cross-origin isolation; COEP is forced to require-corp with a one-time reload fallback (untested on a real iPhone).
- **Fairy balance:** fusion pieces and the shop player buying fairy offers aren't measured yet.

## Roadmap
Done: game modes, versioned saves, module structure, formatting/linting in CI, SVG pieces, fairy pieces with shop offers and fusion, Play as.

Next candidates (not yet decided):
2. **Browser smoke test** (Playwright in CI): a full run including reload mid-battle.
3. **Seeded runs:** one seed per run for reproducible bugs, and daily challenges.
4. **Auto-chess depth:** synergies between pieces; more fairy pieces and fusion recipes; tuning fairy values with the simulator.
5. **Bigger boards** past 8×8, with a longer move limit.
6. **Multiplayer:** asynchronous ghost armies first, then live 1v1.

## Open questions
- Is Normal the right difficulty for real players? Settle by playtesting.
- Should the move limit, draws and the "on points" rule change once small-board draws are addressed?
- Would a per-round army cap (e.g. 3 + round) play better than a flat 16?
