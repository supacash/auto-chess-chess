# Auto Chess Chess — Design Document

## Pitch
Draft and place a chess army, then watch an engine play the round for both sides. Survive as long as you can against increasingly strong AI armies.

## v1 Scope
- Single-player only, against AI-drafted armies
- Mobile-friendly web app (touch drag-and-drop); can be wrapped as an app later with Capacitor
- No accounts or server. The best run is saved in localStorage.

## Core Loop
1. **Shop phase.** Spend gold on pawns and upgrades. You can see the opponent's piece list but not where its pieces are.
2. **Placement phase.** Arrange your pieces in your three home rows.
3. **Battle phase.** The engine plays both sides with fast animation.
4. **Result.** Win, lose or draw. Gold is paid out and a life is lost on a loss.
5. Repeat until you run out of lives.

## Run Structure
- 3 lives. Lose one per lost round. A draw costs no life.
- The score is the number of rounds won. Best score is saved.
- Each round, the AI army's point budget grows (see AI Opponent).
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
- **Start:** King + 3 pawns, 3 gold.
- **Income per round:** 5 gold, +2 for a win, +1 for a draw.
- **Selling:** refunds the piece's value minus 1 (minimum 0).
- **Army cap:** 16 pieces including the king.
- Pieces lost in battle come back for the next round. Battles never destroy your army.

## Placement Rules
- You own ranks 1–3 (shown at the bottom). The AI owns ranks 6–8.
- The king can't be placed on the front row (rank 3).
- Pawns can't be placed on the back row (rank 1). This also keeps positions legal for the engine.
- A pawn on rank 2 may move two squares on its first move. A pawn on rank 3 may not.
- No castling.
- Promotion works as normal (the engine picks the piece, usually a queen) but lasts only for that battle.

## Battle Rules
- **First move:** random each round. If one king starts in check, that side moves first. If both kings start in check, the AI re-places its army.
- **Move limit:** 60 plies (30 moves each).
- **Win:** checkmate, or more material left when the move limit is reached.
- **Draw:** equal material at the limit, stalemate, threefold repetition or insufficient material.

## AI Opponent
- **Engine:** Stockfish (WASM, in a web worker) plays both sides at the same settings. The player's skill is in drafting and placement, not in having a better engine.
- **Speed:** a depth-8 search per move. To add variety, it picks randomly among the top 3 moves when they score within ~50 centipawns of each other.
- **Army budget:** 4 + 2×round points, plus or minus 1 random. A new opponent is drafted each round, and its style is shown during placement.
- **Styles:** each sets the share of the budget spent on pawns, draft weights for the other pieces, preferred king files, and how far forward pieces sit.
  | Style | Draft | Layout |
  |---|---|---|
  | Balanced | ~35% pawns, an even mix | King on d/e behind a pawn shield |
  | Fortress | ~60% pawns, minor pieces and rooks | King tucked on g/h (or b/a) behind a full pawn wall |
  | Heavy Artillery | ~15% pawns, queens and rooks | Rooks on the back row and open files, queen in the centre |
  | Cavalry Charge | ~25% pawns, knights and bishops | Pieces pushed to the front row |
- **Drafting:** non-pawn pieces are picked by the style's weights and the rest of the budget goes on pawns (at most 8). Anything left once the pawn cap is hit goes into upgrades.
- **Placement:** every square is scored per piece for the style (rooks prefer the back row, bishops c/f, pawns shield the king and avoid doubling up), with small random noise and a random left/right flip. The king goes first, then pieces from most to least valuable. It follows the same rules as the player.

## Playback & UX
- Moves animate at about 0.4s each, with 1×/2×/4× speed buttons and Skip to result.
- The result screen shows the final board, the material count and the gold earned.
- Boards are always oriented with the player at the bottom.

## Tech Stack
- Vite + TypeScript, no framework (or Preact if the UI grows)
- **chess.js** for rules, legal moves and FEN
- **stockfish.js** (WASM) running in a web worker
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
