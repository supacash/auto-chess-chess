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

### 8. At 90 plies: Cavalry Charge and round 1 (2026-10-09, seed 1, 300 runs × 10 rounds, shop player, 6×round)

`npm run sim -- --rounds 10 --games 300 --player shop`. With ~750 games per AI style, each percentage is about ±3.5 points; with 300 games per round, about ±5.

**Cavalry Charge is the hardest AI style, and small tweaks don't change that.** Player wins against each AI style:

| Cavalry variant | vs Cavalry | vs Balanced / Fortress / Heavy | Run score |
|---|---|---|---|
| Current (knight weight 3, forward 0.8) | 25% | 33% / 32% / 39% | 2.76 |
| Knight weight 2 | 24% | 32% / 33% / 40% | 2.81 |
| Knight weight 2.5 | 25% | 32% / 32% / 40% | 2.78 |
| Forward 0.4 | 29% | 32% / 31% / 38% | 2.75 |
| Forward 0.6 | 24% | 32% / 31% / 41% | 2.74 |
| Knight 2 + forward 0.4 | 27% | 32% / 33% / 38% | 2.72 |

- The style is strong from either side: the stand-in player wins 49–55% when it plays Cavalry, 22–25% with the other styles. Heavy Artillery is always the easiest AI style. At equal points, knight/bishop-heavy armies beat rook/queen-heavy ones in this format, so it is a piece-value effect rather than a Cavalry layout quirk.
- **Decision:** keep Cavalry as it is. (It was briefly labelled "tough" in the opponent line; the label was removed.)

**Round 1 discount.** Round 1 at 90 plies was 28 / 38 / 34 (W/D/L, 6 v 6 points). With the AI budget 1 point lower in round 1 only (`ROUND_ONE_DISCOUNT`):

| | Before | Round 1 −1 |
|---|---|---|
| Round 1 W/D/L | 28 / 38 / 34 | 57 / 29 / 14 |
| Round 2 wins | 42% | 56% |
| All rounds W/D/L | 32 / 11 / 57 | 43 / 10 / 47 |
| Run score | 2.76 | 3.97 |
| Runs alive after round 10 | 24% | 33% |

- The round 1 win bonus (+2 gold) carries through the run, so the discount also offsets the extra difficulty the 90-ply limit added (shop player run score at 60 plies was 3.19). **Decision:** ship it and let playtests decide whether Normal needs further easing (Easy is 5×round).
- Stockfish still hung in about 1 in 1000 battles, all with 3+ bishops. The browser's 10 s timeout falls back to a random move.

### 9. Escalating board sizes on Fairy-Stockfish (2026-10-09, seed 1, 300 runs × 10 rounds, shop player)

`npm run sim -- --rounds 10 --games 300 --player shop [--board 8]`. The engine is now Fairy-Stockfish; `--board 8` keeps every round on 8×8 for comparison. The shop stand-in only buys pawns that fit the current board and upgrades otherwise.

| | 5×5→8×8 schedule | All 8×8 |
|---|---|---|
| Player W/D/L | 41 / 13 / 46 | 42 / 11 / 47 |
| Run score | 3.66 ±0.34 | 3.79 ±0.33 |
| Runs alive after round 10 | 26% | 26% |
| Checkmate / move limit | 64% / 25% | 48% / 45% |
| Avg plies | 54.5 | 72.5 |

- **Same balance, more decisive battles.** Points per round stay even on every board, and the run score matches fixed 8×8 within the margin. Small boards end in mate far more often, and battles are shorter.
- **The engine swap kept the balance:** fixed 8×8 on Fairy-Stockfish (run score 3.79) matches Stockfish's 3.97 (§8) within the margin.
- **Round 1 on 5×5 is drawish:** 50 / 40 / 10 W/D/L, mostly bare kings or insufficient material with 5–6 point armies.
- An earlier run with a stand-in that kept buying pawns that didn't fit scored only 2.09: on small boards, gold has to go into upgrades. The in-game bench shows extras, but players may need a hint.

### 10. Game modes (2026-10-09, seed 1, 300 runs × 10 rounds, shop player)

Board sizes shipped as a mode: **Growing board** (5×5 → 8×8, King + 4 pawns, AI 6×round + 1) and **Classic** (8×8, King + 3 pawns, AI 6×round). Both keep the round-1 discount.

| | Classic | Growing |
|---|---|---|
| Player W/D/L | 42 / 11 / 47 | 38 / 13 / 49 |
| Run score | 3.79 ±0.33 | 3.36 ±0.30 |
| Runs alive after round 10 | 26% | 20% |
| Checkmate | 48% | 65% |
| Round 1 W/D/L | 59 / 29 / 12 | 55 / 38 / 7 |

- The extra pawn alone (AI +1 only in round 1) made Growing much easier (run score 4.86): the pawn is permanent, so the player stayed a point ahead every round. Giving the AI +1 every round brings the modes within about one margin of each other.
- **The extra pawn barely reduced 5×5 round-1 draws** (40% → 38%). Small armies on a small board often trade down to bare kings or insufficient material. Deciding "insufficient material" endings on points is the remaining lever.

### 11. Fairy pieces in AI armies (2026-10-09, seed 1, 60 runs × 8 rounds, Classic 8×8, `--player-points ai`)

`npm run sim -- --rounds 8 --games 60 --player-points ai --board 8 --fairy none|ai`. The player stand-in drafts standard pieces at the same points as the AI, so the AI's results show whether fairy pieces are priced fairly. (`--fairy both` also gives the stand-in fairy pieces; the shop player stays standard.)

| AI armies | Player win | Draw | Loss | Run score |
|---|---|---|---|---|
| Standard (`--fairy none`) | 39% ±4 | 17% | 45% | 2.37 |
| Fairy, first-estimate values | 52% ±4 | 14% | 34% | 3.72 |
| Fairy, Camel 3→2, Grasshopper 2→1, Cannon 4→3 | 40% ±4 | 16% | 44% | 2.58 |

- With the first estimates, fairy armies were clearly weaker per point. Fortress (Ferz, Wazir, Man, Cannon) fell from 31% to 59% player wins and Heavy Artillery (Cannon, compounds) from 24% to 56%.
- After lowering the Camel, Grasshopper and Cannon, fairy armies match standard ones overall. Fortress was still weak with fairy pieces (50% ±9 player wins); section 12 fixes that.
- Not yet measured: the fusion pieces on their own, and the shop player buying fairy offers.

### 12. Repetition, insufficient material, Ferz and Wazir (2026-10-09, seed 1)

Two rule changes: the engine now gets the move history (`position fen … moves …`), so it sees repetitions as draws and the side that's ahead avoids them (Fairy-Stockfish has no contempt option); and insufficient material is decided on points.

Growing mode, `npm run sim -- --rounds 10 --games 300 --player shop` (compare section 10):

| | Before | After |
|---|---|---|
| Player W/D/L | 38 / 13 / 49 | 44 / 6 / 50 |
| Round 1 W/D/L | 55 / 38 / 7 | 70 / 17 / 14 |
| Run score | 3.36 ±0.30 | 3.93 ±0.35 |
| Checkmate | 65% | 69% |

Repetition endings fell from 5–8% of battles (section 11 runs) to 1–2%. Round 1 is now a little easier; overall the run score rose about half a point.

Fortress only, Classic 8×8, `--rounds 8 --games 60 --player-points ai --board 8 --ai-style fortress`:

| Fortress armies | Player win | Draw | Loss | Run score |
|---|---|---|---|---|
| Standard | 38% ±4 | 9% | 54% | 2.42 |
| Fairy, Ferz/Wazir 2 | 58% ±4 | 8% | 34% | 4.32 |
| Fairy, Ferz/Wazir 1 | 41% ±4 | 8% | 51% | 2.53 |

Ferz and Wazir are worth about a pawn here; they're now 1 point.

### 13. Classic balance check (shop player, 200 runs × 10 rounds per row, plus 10 runs × 30 rounds)

`npm run sim -- --board 8 --player shop --rounds 10 --games 200 --difficulty <d> --side <s>`

| Difficulty, side | Win | Draw | Loss | Run score | Alive after round 10 |
|---|---|---|---|---|---|
| Easy, White | 92% | 2% | 6% | 9.11 | 98% |
| Normal, White | 53% | 5% | 43% | 4.67 | 34% |
| Normal, random | 44% | 6% | 50% | 3.83 | 16% |
| Hard, White | 13% | 4% | 83% | 1.06 | 0% |

- **Normal** wins 60–70% in rounds 1–5, then falls to ~35% by round 9–10 at equal points (White).
- **First move** is worth ~18 points of win rate (White 53% vs random 44%, so Black ≈ 35%).
- **AI styles at equal points** (Normal, White): Cavalry Charge beats the player 59% of the time, Heavy Artillery only 25%.
- **Move limit** decides a third of Normal games (40–60% in rounds 1–3); 35% of games where a side was ≥5 ahead end without mate.
- **30 rounds:** the player's army stops growing at ~63 points by round 12 (the 16-piece cap, and this stand-in never upgrades, fuses or sells), while the AI budget keeps rising 6 a round; from round 12 on the player loses every game, mostly in under 10 plies.

### 14. Fixed stand-in and merge-first tuning (shop player, 200 runs × 10 rounds per row)

- **Stand-in bug:** §13's shop player never placed its pieces, so its 8-slot bench filled and it stopped buying at 63 points (King + 7 Queens). Fixed (the shop holds the placed army); it now also fuses, merges and sells once the board is full. With the fix it reaches a full board of queens around round 23 and the late game is no longer a wall.
- **AI drafting fix:** leftover points used to upgrade pawns first, so Fortress had no pawns at 40 points. Now leftovers buy more of the style's pieces while squares are free, then upgrade with pawns last.
- **Merge-first upgrades** (merges as the main way up, pricier gold upgrades, rarer rooks and queens): the player gets a little less army per gold, so budgets came down.

| Points per round (as White) | Win | Round 3 | Round 10 | Run score |
|---|---|---|---|---|
| 5.0 | 92% | 85% | 100% | 8.77 |
| 5.5 (Easy) | 78% | 59% | 95% | 6.49 |
| 6.0 (Normal) | 61% | 36% | 78% | 4.32 |
| 6.5 (Hard) | 31% | 8% | 47% | 1.06 |
| 6.75 | 23% | 7% | 31% | 0.63 |

- **Black:** at 5.5 with no handicap Black won 74% to White's 78%; with the 2% handicap Normal as Black won 58% (White 61%). The 12-point gap measured before merges (and 10% handicap, which made Black win 90%) belonged to the old economy.
- **Easy, random side:** 76%.
- **Open problem: the ramp runs backwards.** Every difficulty is hardest in rounds 3–5 and gets easier later (merged rooks and queens beat the AI's drafted armies at equal points). Runs end after 3 losses, so the early rounds decide them: Hard averages about one win.

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
- Tables include a `±win` column: the 95% margin of error on the win rate (normal approximation). The run score line has the same margin. Games within a run aren't fully independent, so the true margins are a little wider. Treat gaps smaller than the margins as noise.
- `npm run typecheck` covers `scripts/` (see `scripts/tsconfig.json`).
