# Auto Chess Chess — Design Document

## Pitch
Draft and place a chess army, then watch an engine play the round for both sides. Survive as long as you can against increasingly strong AI armies.

## v1 Scope
- Single-player only, against AI-drafted armies
- Mobile-friendly web app (touch drag-and-drop); can be wrapped as an app later with Capacitor
- No accounts or server. The best run is saved in localStorage.

## Core Loop
1. **Shop phase.** Spend gold on pawns and upgrades. You can see the opponent's piece list but not where its pieces are.
2. **Placement phase.** Arrange your pieces in your home rows. The board grows during the run (see Board Sizes).
3. **Battle phase.** The engine plays both sides with fast animation.
4. **Result.** Win, lose or draw. Gold is paid out and a life is lost on a loss.
5. Repeat until you run out of lives.

## Run Structure
- 3 lives. Lose one per lost round. A draw costs no life.
- The score is the number of rounds won. Each difficulty saves its own best score.
- Each round, the AI army's point budget grows (see AI Opponent).
- **Run settings** are picked on the placement screen and fixed for the whole run:
  - **Board (game mode):** *Growing board* (the default) starts on 5×5 and grows to 8×8 (see Board Sizes). *Classic* plays every round on 8×8. Each mode has its own starting army and best scores; runs saved before modes existed load as Classic.
  - **Difficulty:** how fast the AI budget grows. Easy is 5×round, Normal (the default) 6×round, Hard 7×round.
  - **Reveal opponent's placement:** shows where the AI's pieces are during placement, not just its piece list. It's an easier mode and off by default.
  - Before the first battle a change applies straight away (the opponent is redrafted if the difficulty changed). After that, changing a setting asks to start a new run.
- The run in progress (army, gold, lives, record and the current opponent) is saved to localStorage after every change, so a reload resumes it. When a round ends, the game moves to the next round and drafts its opponent straight away, so reloading on the result screen can't replay a round.
- Leaving or reloading *during* a battle counts as a loss (−1 life, normal loss income) on the next load, with a notice explaining why. The save is flagged when a battle starts and the flag is cleared when it finishes. If the battle fails with an error, it doesn't count.

## Pieces & Economy
| Piece | Value | Cost |
|---|---|---|
| Pawn | 1 | 1 gold to buy |
| Knight / Bishop | 3 | Pawn + 2 gold |
| Rook | 5 | Knight/Bishop + 2 gold |
| Queen | 9 | Rook + 4 gold |
| King | — | Free, always owned, can't be sold |

- An upgrade costs the difference in value, so the gold you've spent always equals your army's point total.
- **Start:** 3 gold, plus King + 4 pawns in Growing mode or King + 3 pawns in Classic. The extra pawn keeps mating material on 5×5, where 5-point armies drew 40% of round 1s; the AI gets the matching point every round in Growing mode (6×round + 1), so both modes have the same balance.
- **Income per round:** 5 gold, +2 for a win, +1 for a draw.
- **Selling:** refunds the piece's value minus 1 (minimum 0).
- **Army cap:** 16 pieces including the king.
- **No piece-count limit.** The old Stockfish build refused armies with more than 8 pawns plus "extra" pieces; Fairy-Stockfish accepts any mix, so that rule is gone.
- **Board space:** you can own more pieces than fit on the current board; extras wait on the bench until it grows.
- Pieces lost in battle come back for the next round. Battles never destroy your army.

## Board Sizes
In Growing mode the board grows during a run, like an auto-battler's board opening up:

| Rounds | Board | Home rows each | Home squares | Gap between armies | Move limit |
|---|---|---|---|---|---|
| 1–2 | 5×5 | 2 | 10 | 1 row | 60 plies (30 each) |
| 3–4 | 6×6 | 2 | 12 | 2 rows | 70 plies |
| 5–6 | 7×7 | 2 | 14 | 3 rows | 80 plies |
| 7+ | 8×8 | 3 | 24 | 2 rows | 90 plies |

- The move limit is 10 × board size + 10 plies.
- Placed pieces keep their squares when the board grows (it only gets bigger); a notice announces the new size.
- Points per round don't change with the board. Armies are limited by home squares: extra player pieces wait on the bench, and the AI spends points it can't place on upgrades. When your home squares (or pawn squares) are full, the Buy pawn button says "Board full: upgrade instead".
- Simulation: 64% of battles end in checkmate on the schedule (48% on fixed 8×8) with the same overall balance (SIMULATION.md §9).

## Placement Rules
- You own the bottom home rows; the AI owns the same number at the top.
- The king can't be placed on the front home row.
- Pawns can't be placed on the back row.
- A pawn on your second rank may move two squares on its first move.
- No castling.
- Promotion works as normal (the engine picks the piece, usually a queen) but lasts only for that battle.

## Battle Rules
- **First move:** random each round. If one king starts in check, that side moves first. If both kings start in check, the AI re-places its army.
- **Move limit:** 10 × board size + 10 plies: 60 on 5×5 up to 90 on 8×8 (see Board Sizes). On a fixed 8×8 board, 60 plies left 68% of battles undecided; 90 brought checkmates to half (SIMULATION.md §7).
- **Win:** checkmate, or more material left when the move limit is reached. The second is shown as a win (or defeat) **on points**, so it reads as a normal result.
- **Draw:** equal material at the limit, stalemate, threefold repetition or insufficient material.

## AI Opponent
- **Engine:** Fairy-Stockfish (WASM; a Stockfish variant engine that supports any board size up to 12×10) plays both sides at the same settings. The player's skill is in drafting and placement, not in having a better engine.
- **Speed:** a depth-8 search per move. To add variety, it picks randomly among the top 3 moves when they score within ~50 centipawns of each other.
- **Engine failures:** if a search takes over 10 seconds, that move is a random legal move instead and the engine is restarted. (The old Stockfish build hung about once per 1000 battles; Fairy-Stockfish had no hangs in testing, so this is a safety net.)
- **Army budget:** 6×round points on Normal (5× Easy, 7× Hard), plus or minus 1 random, and 1 point less in round 1 so the first battle isn't a coin flip. This roughly matches the player's army value (6 at the start, then +5 to +7 income per round). The earlier 4 + 2×round fell far behind from round 2 (see SIMULATION.md). A new opponent is drafted each round, and its style is shown during placement.
- **Styles:** each sets the share of the budget spent on pawns, draft weights for the other pieces, preferred king files, and how far forward pieces sit.
  | Style | Draft | Layout |
  |---|---|---|
  | Balanced | ~35% pawns, an even mix | King on d/e behind a pawn shield |
  | Fortress | ~60% pawns, minor pieces and rooks | King tucked on g/h (or b/a) behind a full pawn wall |
  | Heavy Artillery | ~15% pawns, queens and rooks | Rooks on the back row and open files, queen in the centre |
  | Cavalry Charge | ~25% pawns, knights and bishops | Pieces pushed to the front row. It beats the player more often than the other styles (SIMULATION.md §8). |
- **Drafting:** non-pawn pieces are picked by the style's weights and the rest of the budget goes on pawns (at most 8). Anything left once the pawn cap is hit goes into upgrades. Every step stays within the piece limit, so very large budgets may go partly unspent.
- **Placement:** every square is scored per piece for the style (rooks prefer the back row, bishops c/f, pawns shield the king and avoid doubling up), with small random noise and a random left/right flip. The king goes first, then pieces from most to least valuable. It follows the same rules as the player.

## Playback & UX
- Moves animate at about 0.4s each, with 1×/2×/4× speed buttons and Skip to result.
- The result screen shows the final board, the material count and the gold earned.
- Boards are always oriented with the player at the bottom.

## Tech Stack
- Vite + TypeScript, no framework (or Preact if the UI grows)
- **ffish.js** (Fairy-Stockfish's move generator) for rules, legal moves and FEN on any board size
- **Fairy-Stockfish** (WASM, multithreaded; coi-serviceworker makes the page cross-origin isolated on GitHub Pages)
- Custom touch-friendly board component using Pointer Events

## Milestones
1. ✅ Board rendering plus drag-to-place with rule checks
2. ✅ Battle: build the starting position from both armies → engine loop → animation → result
3. ✅ Shop and economy
4. ✅ AI drafting and placement styles
5. ✅ Run structure (lives, score, saving the best run) and polish

## Open Questions
- Tuning: income, AI budget curve, move limit. Settle these by playtesting.
- Should players be able to buy a "smarter engine" upgrade later?
- Is the piece cap per round (e.g. 3 + round) better than a flat 16?
- Post-v1: 1v1 online, the 8-player lobby, and special/fairy pieces.
