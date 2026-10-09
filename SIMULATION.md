# Balance Simulator

A headless script that plays whole runs (round 1 → N) with Stockfish playing both sides, so the economy, AI budget curve and move limit can be tuned with data instead of single playtests.

```bash
npm run sim -- --rounds 10 --games 100
```

| Option | Default | Meaning |
|---|---|---|
| `--rounds` | 10 | Rounds per run |
| `--games` | 20 | Number of runs (total battles = runs × rounds) |
| `--seed` | 1 | Seed for drafting, placement, first mover and move picks. Runs are reproducible. |
| `--depth` | `SEARCH_DEPTH` (8) | Overrides the engine depth |
| `--workers` | CPU count − 2 | Parallel Stockfish processes |
| `--player` | `redraft` | Stand-in player policy. `redraft` re-drafts the whole army each round at its full value. `shop` keeps a persistent `Shop` and spends gold greedily (see below). |
| `--player-style` | `random` | Stand-in player style (`balanced`, `fortress`, `heavy`, `cavalry`), or random per run |
| `--player-points` | `economy` | `economy` = the player's army value follows DESIGN.md income. `ai` = the player gets the same budget as the AI each round, which isolates engine and style balance from the economy. |
| `--ai-budget a,b` | — | Replaces the AI budget `6×round` with `a + b×round` (±1 noise kept). Write a negative `a` as `--ai-budget=-2,6`. The results below predate the change from `4 + 2×round`, so `--ai-budget 4,2` reproduces the old curve. |
| `--plies` | `PLY_LIMIT` (60) | Overrides the move limit (see section 7) |
| `--decisive lead,plies` | off | Prototype early end: a side that holds a material lead of at least `lead` for `plies` consecutive half-moves wins (`decisive` end reason) |
| `--lead` | 5 | Material lead threshold for the "lead≥N / no mate / no win" columns |
| `--json` | off | Dumps every game record instead of the tables |

**How it works.** The script lives in `scripts/sim/` and runs with `tsx`, so it is not part of the browser bundle. It reuses `draftAiArmy`/`placeAiArmy`/`aiBudget`, `startPosition`, `runBattle` and `roundIncome` unchanged. `nodeEngine.ts` is a `MoveSource` that runs `stockfish-19-lite-single.js` as a child process with the same UCI flow as `src/engine/stockfish.ts` (MultiPV 3, `pickMove`). The stand-in player has an AI style for the whole run and places with `placeAiArmy`. With `--player redraft` it re-drafts its whole army each round at its current army value (3 pawns + 3 gold = 6 at the start, then +5/+6/+7 per round). This is an optimistic "spends everything well" player that can freely reshape its army. With `--player shop` (`scripts/sim/shopPlayer.ts`) it keeps one `Shop` from `startingShop()`, adds `roundIncome` after each battle, and before each battle spends greedily through `buyPawn`/`upgradePiece`, so the 16-piece cap and the piece limit apply as in the real shop. Each step buys a pawn while pawns are below the style's pawn share of army + gold, otherwise makes an affordable upgrade picked by the style's weights for the target piece, otherwise buys a pawn. It never sells, and gold that fits nothing (usually 0–1) carries over. It plays on through all rounds even after a third loss, so later rounds have samples. The run score applies the 3 lives afterwards.

**Columns.** W/D/L are from the player's side. `pts P/AI` is the average army value. `limit` = the battle hit the 60-ply limit. `mate` = it ended in checkmate. `lead≥5` = one side was ever 5+ points of material ahead. `no mate` / `no win` = of those games, how often that side failed to checkmate, or failed to win at all.

## First results (2026-10-09, seed 1, 100 runs × 10 rounds each)

### 1. Current rules (`npm run sim -- --rounds 10 --games 100`)

| Round | pts P/AI | W/D/L | avg ply | limit | mate |
|---|---|---|---|---|---|
| 1 | 6.0 / 6.0 | 35 / 27 / 38 | 56.9 | 84% | 7% |
| 2 | 12.0 / 7.9 | 97 / 2 / 1 | 56.4 | 72% | 27% |
| 3 | 18.9 / 10.1 | 97 / 3 / 0 | 50.4 | 42% | 55% |
| 5 | 32.7 / 14.1 | 100 / 0 / 0 | 35.8 | 8% | 92% |
| 10 | 65.0 / 24.2 | 100 / 0 / 0 | 17.6 | 0% | 100% |

Every run is still alive after round 10, with an average score of 6.3. 298 of 1000 battles were unplayable (see problem 1).

### 2. Equal budgets (`--player-points ai`): engine and style balance

- Overall W/D/L is 37/26/36. **88% of battles hit the move limit and only 7% end in mate.**
- When a side gets 5+ points ahead, it fails to mate 86% of the time. It still wins on material 82% of the time.
- By AI style (player W/D/L): Balanced 50/27/24, Fortress 47/24/29, **Heavy Artillery 26/24/50**, **Cavalry Charge 24/32/44**.
- By player stand-in style: Heavy Artillery wins 57%. Fortress wins only 24% and loses 49%.

### 3. Equal budgets at depth 12 (`--player-points ai --depth 12`)

- W/D/L is 35/32/34. **91%** of battles hit the limit, 4% end in mate, and 90% of 5+ leads go unmated.
- The search took about 10× longer (623s against 65s) and changed nothing about conversion.

### 4. AI budget at 6×round (`--ai-budget 0,6`)

- The AI budget now tracks the player's income: 59 vs 60 points by round 10.
- Overall W/D/L is 40/10/50, with an average run score of 2.2. 51% of runs survive 10 rounds.
- By AI style (player W/D/L): Balanced 43/11/46, Fortress 39/8/52, Heavy Artillery 46/9/45, Cavalry Charge 29/14/57.
- 39% of battles were unplayable because big budgets draft armies Stockfish refuses (see problem 1).

### 5. AI budget at 6×round, depth 12 (`--ai-budget 0,6 --depth 12`)

- W/D/L is 40/14/46, with an average run score of 2.2. 76% of battles hit the limit and 17% end in mate.
- These are the same as at depth 8 within noise, at about 10× the time (638s).

### 6. Shop player vs redraft player (2026-10-09, seed 1, 100 runs × 10 rounds, 6×round unless noted)

`npm run sim -- --rounds 10 --games 100 --player redraft|shop [--ai-budget 0,5]`

| Player | AI budget | pts P/AI (round 10) | W/D/L | Run score | Alive after round 10 |
|---|---|---|---|---|---|
| redraft | 6×round | 59.6 / 60.1 | 44 / 9 / 48 | 3.64 | 34% |
| **shop** | **6×round** | 58.3 / 60.0 | **38 / 11 / 52** | **3.19** | **27%** |
| redraft | 5×round | 68.0 / 50.0 | 93 / 4 / 3 | 9.13 | 97% |
| shop | 5×round | 67.5 / 49.9 | 92 / 5 / 4 | 9.13 | 99% |
| shop | 6×round − 1 | 62.8 / 59.0 | 63 / 8 / 29 | 6.11 | 59% |
| shop | 6×round − 2 | 66.5 / 57.9 | 85 / 4 / 11 | 8.42 | 85% |

- **The shop player is only a little weaker.** It loses 6 points of win rate and 0.45 of run score. Its army value is the same within 1–2 points, because the greedy plan spends nearly all its gold. The loss comes from composition: it can't sell, so early knights and bishops stay, and by round 10 its armies are capped at 16 pieces with 4–5 rooks and few pawns. The gap grows in later rounds (rounds 5–10: 30–42% wins against 40–51%).
- Shop player by style: Cavalry Charge wins 53%, the others 28–36%. Redraft by style was Cavalry 70%, Heavy 50%, Fortress 34%, Balanced 23%.
- **Material decides almost everything, so the budget knob is very steep.** At 5×round the AI falls 1 point further behind each round, and from round 3 the player wins 95%+ either way. One point less per round (6×round − 1) moves the shop player from 38% to 63% wins and run score 3.19 → 6.11. Two points less (6×round − 2) gives 85% wins. Wins also snowball through the +2 win bonus.
- **Recommendation: keep 6×round; don't lower the slope to 5×round.** 5×round turns a run into a near-certain 10-round survival for any player who spends their gold, which is the bar both stand-ins clear. A human will place worse than the heuristics in some ways and better in others (e.g. no fixed style, reacting to the AI's army), so playtests should decide any easing. If they show 6×round is too hard, `6×round − 1` is the next step: about two-thirds wins and 59% of runs surviving 10 rounds for the shop player. That is generous for a competent player but leaves room for human mistakes. Lower the intercept, not the slope.

### 7. Move limit and an early decisive end (2026-10-09, seed 1, 100 runs × 10 rounds, redraft player, 6×round)

`npm run sim -- --rounds 10 --games 100 --plies 60|90|120 [--decisive 10,6]`

| Ply limit | Decisive end | W/D/L | avg ply | limit | mate | decisive | no mate (lead≥5) | Run score | Wall time |
|---|---|---|---|---|---|---|---|---|---|
| **60 (current)** | — | 44 / 9 / 48 | 52.9 | 68% | 29% | — | 66% | 3.64 | 51s |
| **90** | — | 42 / 10 / 48 | 68.7 | 44% | **50%** | — | **45%** | 3.65 | 65s |
| 120 | — | 38 / 13 / 49 | 80.2 | 30% | 60% | — | 33% | 3.17 | 114s |
| 60 | 10 for 6 plies | 41 / 9 / 50 | 47.4 | 56% | 10% | 32% | 90% | 3.42 | 53s |
| 90 | 10 for 6 plies | 42 / 10 / 48 | 61.3 | 39% | 16% | 40% | 84% | 3.60 | 64s |
| 120 | 10 for 6 plies | 40 / 13 / 47 | 71.5 | 26% | 18% | 46% | 82% | 3.09 | 88s |

Wall time is with 14 engines while other sims were running at times, so treat it as rough. It tracks average plies.

- **90 plies is the sweet spot.** Mates go from 29% to 50% and limit endings from 68% to 44%. A side that gets 5+ points ahead now mates 55% of the time instead of 34%. W/D/L and run score don't change (the material tiebreak was already picking the right winner, "no win" stays 11–13%), so the economy and AI-budget results above still hold.
- **120 plies gives diminishing returns and costs balance.** Mates rise only to 60%. Draws grow (13%, and 47% in round 1, where 6-point armies shuffle into repetition or bare kings). Player wins fall to 38%, the run score drops to 3.17, and battles average 80 plies.
- **Battle length in the browser** (400 ms per move at 1×): about 21 s per battle at 60 plies, 27 s at 90 and 32 s at 120. The UI shows the move counter as `Move n/PLY_LIMIT÷2`, so a change shows up there automatically.
- **The decisive end doesn't help.** A 10-point lead held for 6 plies almost always comes before the mate, so it mostly turns mates into "decisive" wins (mate 29% → 10% at 60 plies). Limit endings fall only 12 points, because most limit games never reach a 10-point lead. It ends games a little earlier (−5 to −9 plies) and leaves W/D/L unchanged, so it saves time but adds no drama. It is the material tiebreak applied sooner. It stays a sim flag.
- Late rounds already mate at 60 plies (round 10: 77% mate, 22% limit). Early rounds are where the limit decides (rounds 1–7: 69–92% limit). At 90 plies rounds 1–2 still hit the limit 53–72% of the time, because small armies rarely have mating material.

**Recommendation: raise `PLY_LIMIT` to 90** (45 moves each). Mates become the most common ending and the existing balance holds, for about 6 s more per battle. This needs the user's OK and a DESIGN.md update ("Move limit"). Don't adopt the decisive-material end.

## Problems found

1. **Fixed:** the piece limit in `src/rules/composition.ts` (see DESIGN.md) now applies to the shop, placement and `draftAiArmy`. At the 6×round AI budget all 1000 battles of `npm run sim -- --rounds 10 --games 100` play out.
   **Stockfish refuses armies the game allows (bug, affects the real game).** Stockfish 17+ rejects a position when a side's pawns plus "promoted" pieces exceed 8. Promoted pieces are knights, bishops or rooks beyond 2, and queens beyond 1. For example, 7 pawns + 4 bishops counts as 9. The engine prints `CRITICAL ERROR … Unsupported position. Too many pieces for WHITE` and then never sends `bestmove`.
   - The player can buy into this. `draftAiArmy` produces it too: at current budgets 15 of 1000 AI armies, and 160 of 1000 at 6×round. Once the pawn cap is hit, leftovers pile into upgrades.
   - In the browser, `Engine.candidates` waits for `bestmove` forever, so **the battle would freeze**.
   - Fix ideas: enforce the limit in placement, the shop and the drafter (e.g. at most 2 each of N/B/R and 1 Q beyond what pawns allow), and/or add a timeout in `Engine.candidates`.
2. **Fixed:** `Engine.candidates` returns no moves on the CRITICAL ERROR line or after a 10 s timeout (restarting the worker), so `runBattle` plays a random legal move.
   **Stockfish lite hangs on some legal positions (bug, affects the real game).** It hangs every time on `8/6k1/8/b7/8/1B2K1N1/5N2/5B2 b - - 0 15` at depth 6+, with MultiPV 1 or 3 and in a fresh process. That position has two same-coloured white bishops, which needs 3+ bishops. A second hang, `8/k2r2B1/1pb5/8/1KB1b2P/8/8/8 w - - 6 30`, has two same-coloured black bishops. Each came up in about 1 of 1000 battles.
   - The browser game would freeze here too. A per-search timeout in the browser engine, with a random-move fallback, would cover both bugs.
   - Separately, some searches stall once and recover after an engine restart. That was about 2 per 1000 battles at depth 8 and 13 per 1000 at depth 12.
3. **The AI budget curve is far too flat.** Player army value grows 5–7 per round, the AI's only 2.
   - From round 2 the stand-in player wins about 97%. By round 10 the player fields 65 points against 24.
   - A real player won't play perfectly, but the gap is too large to close. `--ai-budget 0,6` gives roughly even games (40/10/50), which is a reasonable starting point. Something like `6×round − 1` to keep round 1 at 5–7 is worth testing.
4. **Battles rarely end in mate. The 60-ply limit decides most games.**
   - At equal budgets 88% of battles reach the limit, and a 5-point lead is mated only 14% of the time. Depth 12 doesn't help (4% mates).
   - So the limit, not search depth, is the constraint. The armies start 5 ranks apart and 30 moves each is too short to break through and mate.
   - In isolation the engine mates fine at depth 8 (KQ vs K in 15–23 plies, KR vs K in 23–60). So the reported K+Q vs K non-mate most likely came up with too few plies left.
   - The material tiebreak does pick the right winner in most of these games (only 18% of big leads fail to win).
   - Options: a longer limit (90–120 plies), an early "decisive material" end (e.g. a lead of 10+ for N plies), or accepting that most rounds are won on material. Section 7 measures these and recommends 90 plies.
5. **Style balance.** At equal points, Heavy Artillery is the strongest style for either side, and Fortress is weak as a player stand-in (24% wins). Fortress's ~60% pawns rarely trade into a material lead within 60 plies. Worth re-checking once the move limit changes.
6. **Depth 8 is cheap.** 1000 battles take about 20–70 s with 14 engines. Depth 12 is about 10× slower for no measurable change.

## Caveats

- Both stand-in players use AI placement heuristics rather than human placement. `redraft` re-drafts from scratch each round, so it never sells at a loss. `shop` never sells at all, and its greedy plan doesn't save gold for a queen or react to the opponent.
- Unplayable battles (problems 1 and 2) are left out of W/D/L and count as draws for income. At high budgets that removes many of the most lopsided games.
- `scripts/sim` is not covered by `npm run typecheck` (no `@types/node` in the project).
