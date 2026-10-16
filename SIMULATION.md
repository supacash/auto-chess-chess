# Balance Simulator

A headless script that plays whole runs (round 1 → N) with the game's engine playing both sides (Fairy-Stockfish until §22; `--depth N` still runs it), so the economy, AI budget curve and move limit can be tuned with data instead of single playtests.

```bash
npm run sim -- --rounds 10 --games 100
```

| Option | Default | Meaning |
|---|---|---|
| `--rounds` | 10 | Rounds per run |
| `--games` | 20 | Number of runs (total battles = runs × rounds) |
| `--seed` | 1 | Seed for drafting, placement, first mover and move picks. Runs are reproducible. |
| `--depth` | — | Plays with Fairy-Stockfish at this depth instead of the game's engine (sections before §22 used depth 8) |
| `--workers` | CPU count − 2 | Parallel engine processes (the native `acc` build: `cargo build --release -p acc-cli` in `engine/`) |
| `--player` | `redraft` | Stand-in player policy. `redraft` re-drafts the whole army each round at its full value. `shop` keeps a persistent `Shop` and spends gold greedily (see below). |
| `--player-style` | `random` | Stand-in player style (`balanced`, `fortress`, `heavy`, `cavalry`), or random per run |
| `--player-points` | `economy` | `economy` = the player's army value follows DESIGN.md income. `ai` = the player gets the same budget as the AI each round, which isolates engine and style balance from the economy. |
| `--ai-budget a,b` | — | Replaces the AI budget `6×round` with `a + b×round` (±1 noise kept). Write a negative `a` as `--ai-budget=-2,6`. The results below predate the change from `4 + 2×round`, so `--ai-budget 4,2` reproduces the old curve. |
| `--plies` | `PLY_LIMIT` (60) | Overrides the move limit (see section 7) |
| `--decisive lead,plies` | off | Prototype early end: a side that holds a material lead of at least `lead` for `plies` consecutive half-moves wins (`decisive` end reason) |
| `--lead` | 5 | Material lead threshold for the "lead≥N / no mate / no win" columns |
| `--json` | off | Dumps every game record instead of the tables |

**How it works.** The script lives in `scripts/sim/` and runs with `tsx`, so it is not part of the browser bundle. It reuses `draftAiArmy`/`placeAiArmy`/`aiBudget`, `startPosition`, `runBattle` and `roundIncome` unchanged. `nodeEngine.ts` is a `MoveSource` that runs the game's engine natively (the same moves as the WASM build the game ships: `npm run check:determinism`), or Fairy-Stockfish with `--depth`, as a child process speaking UCI, with the game's move picking (`pickMove`). The stand-in player has an AI style for the whole run and places with `placeAiArmy`. With `--player redraft` it re-drafts its whole army each round at its current army value (3 pawns + 3 gold = 6 at the start, then +5/+6/+7 per round). This is an optimistic "spends everything well" player that can freely reshape its army. With `--player shop` (`scripts/sim/shopPlayer.ts`) it keeps one `Shop` from `startingShop()`, adds `roundIncome` after each battle, and before each battle spends greedily through `buyPawn`/`upgradePiece`, so the 16-piece cap and the piece limit apply as in the real shop. Each step buys a pawn while pawns are below the style's pawn share of army + gold, otherwise makes an affordable upgrade picked by the style's weights for the target piece, otherwise buys a pawn. It never sells, and gold that fits nothing (usually 0–1) carries over. It plays on through all rounds even after a third loss, so later rounds have samples. The run score applies the 3 lives afterwards.

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

### 15. Budget ramp and merge-or-shop rooks and queens (shop player, 200 runs × 10 rounds per row)

- **Ramp:** the AI budget is perRound × round × RAMP[round] (aiArmy.ts): 1, 0.93, 0.92, 0.94, 1, 1.06, 1.10, 1.08, 1.04, then 1. Without it every difficulty was hardest in rounds 3–5 (Hard won 8–12% there, about one win a run). Holding the peak (1.10) from round 8 on made the AI outgrow the player and the late game a wall (Normal: 0% from round 15), so it comes back down to 1 by round 10.
- **No gold upgrades to rooks or queens:** only Pawn → minor (3 gold). The stand-in now rerolls (up to 6 a round, keeping 3 gold) and buys merge parts onto the bench when the board is full.

| Difficulty (as White) | R1 | R2 | R3 | R4 | R5 | R6 | R7 | R8 | R9 | R10 | All | Run score |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Easy (5.5) | 57% | 73% | 77% | 85% | 85% | 90% | 93% | 96% | 97% | 98% | 85% | 7.85 |
| Normal (6) | 57% | 55% | 59% | 61% | 61% | 66% | 76% | 80% | 88% | 77% | 68% | 5.70 |
| Hard (6.5) | 35% | 28% | 24% | 30% | 18% | 27% | 32% | 51% | 46% | 38% | 33% | 2.21 |

- **Normal, random side:** 64% (Black handicap 2%).
- **25 rounds (Normal, random side, 20 runs):** 65–70% through round 12, then 50% (13), 25% (14), 20% (15) and about 5% after: late on the player adds 4–5 points a round to the AI's 6, so runs end gradually around rounds 13–16 (8.2 wins on average).
- **Left as is:** Normal rounds 7–9 run a little easy (76–88%) and Hard dips in round 5 (18%).

### 16. Affinity pawns (shop player, 200 runs × 10 rounds per row)

Affinity pawns replaced the merge recipes (DESIGN.md: three matching affinity pawns make the piece; 2 rooks, 3 knights or 3 bishops make a queen). The stand-in collects up to two sets at a time and rerolls. Pawns cost gold but count 1 point until merged, so the old budgets were far too high: Normal at 6 per round won about 18%.

| Points per round (as White) | Win | Run score |
|---|---|---|
| 4.0 | 99% | 9.88 |
| 4.5 | 93% | 9.08 |
| 5.0 (Easy) | 76% | 7.18 |
| 5.25 | 69% | 6.33 |
| 5.75 | 26% | 2.14 |

- **Per round** (5.25): 78%, 55%, 74%, 73%, 77%, 68%, 58%, 64%, 72%, 71%: flat, the ramp works for this economy too.
- **Random side** (5.25): 64%.
- **25 rounds** (5.25, random side, 20 runs): 50–85% through round 12, then a gentle slide to 30–40% (no wall); 7.7 wins on average.
- **Chosen:** Easy 5, Normal 5.35, Hard 5.65 (Normal and Hard interpolated toward ~62% and ~33%).

### 17. 9×9 Growing board and late-game easing (shop player, 100 runs × 25 rounds per row)

Difficulty Easy 5.35 / Normal 5.5 / Hard 6 per round; the Growing board ends on 9×9 (18-piece armies). Without easing, the AI outgrew the player from round 16 (Growing Easy won 37% in rounds 16–20 and 27% in 21–25). The ramp now drops to 0.95 from round 16 and 0.9 from round 21:

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|
| Growing Easy | 70% | 69% | 67% | 45% | 61% | 63% | 10.6 | 11% |
| Growing Normal | 60% | 56% | 51% | 37% | 45% | 50% | 7.8 | 6% |
| Growing Hard | 38% | 24% | 15% | 9% | 9% | 19% | 2.9 | 0% |
| Classic Easy | 63% | 56% | 48% | 47% | 61% | 55% | 8.6 | 15% |
| Classic Normal | 50% | 42% | 29% | 28% | 40% | 38% | 4.8 | 3% |
| Classic Hard | 26% | 11% | 6% | 4% | 8% | 11% | 1.7 | 0% |

The stand-in builds worse than people (it rerolls rather than saving for interest), so real players finish runs more often.

### 18. Late-game ramp without the round-21 step (fairy pieces, shop player, 40 runs × 25 rounds per row)

`npm run sim -- --player shop --rounds 25 --games 40 --fairy both --difficulty <d> --board 8|schedule`. With the ramp easing to 0.95 from round 16 and again to 0.9 from round 21, every Easy and Normal suite won clearly more in rounds 21–25 than in 16–20 (the stand-in coasted to the finish, as a hand-played run did). Now it holds at 0.95 from round 16:

| Mode, difficulty | R16–20 | R21–25 before | R21–25 after | All after |
|---|---|---|---|---|
| Classic Easy | 56% | 69% | 58% | 56% |
| Classic Normal | 48% | 61% | 51% | 46% |
| Classic Hard | 26% | 41% | 41% | 26% |
| Growing Easy | 63% | 70% | 64% | 62% |
| Growing Normal | 52% | 67% | 53% | 50% |
| Growing Hard | 19% | 37% | 32% | 28% |

Classic Hard is unchanged: its AI budget is already at the cap (a full board of queens) by then, so the ramp doesn't reach it; the late climb there is the player catching up. Growing Normal was cut short twice by an engine crash on 9×9 (a WASM thread's stack overflow right after `bestmove`): the simulator now restarts an engine that dies between games, as the browser does, and the third run finished (8 stalled searches restarted, 3 of 1000 battles left out as hung).

### 19. Full sell refunds, 2-gold Wazir, unlimited Stackmen (RULES_VERSION 8; fairy pieces, shop player, 40 runs × 25 rounds per row)

Same command as §18, after the economy change: selling refunds the full price (fusions no more than their parts, plain pawns nothing), the Wazir costs 2 gold but is still worth 1 point, a player's Stackmen have no fee or limit (AI armies still field at most one), and Ferz, Wazir, Man and Stackman offers are rarer.

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | §18 All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|---|
| Classic Easy | 48% | 46% | 62% | 73% | 77% | 61% | 56% | 5.8 | 8% |
| Classic Normal | 47% | 55% | 57% | 64% | 79% | 60% | 46% | 5.7 | 15% |
| Classic Hard | 20% | 14% | 26% | 34% | 58% | 30% | 26% | 1.0 | 0% |
| Growing Easy | 66% | 60% | 71% | 81% | 85% | 72% | 62% | 10.9 | 28% |
| Growing Normal | 56% | 58% | 71% | 77% | 80% | 68% | 50% | 8.9 | 20% |
| Growing Hard | 46% | 35% | 41% | 50% | 60% | 46% | 28% | 4.3 | 5% |

- **The player got stronger, mostly late.** Every suite wins more than in §18. The rise is largest from round 11 on, where the stand-in's board is full and it sells to make room: a full refund leaves it more gold per round. Normal now wins 64–80% in rounds 16–25 (§18: about 50%), so the late game is easy again, and Growing Hard nearly doubled (28% → 46%).
- **Early rounds barely moved** (Classic Normal 47% in rounds 1–5), so the change is in the late economy, not the opening.
- **Noise:** each round is ±15 points and each run score about ±2.5, so Classic Easy and Normal (61% and 60%) are within noise of each other; their early rounds came out unusually close.
- **Engine:** 1–6 battles per suite hung even after a restart (left out, counted as draws), and 3–13 stalled searches restarted.
- **Next:** the late-game AI budget needs raising again for this economy (the ramp's 0.95 from round 16, or the per-round rate), then rerun this table. The stand-in never sells to speculate on sets, so real players gain more from full refunds than this shows.

### 20. Late-game ramp raised for full refunds (fairy pieces, shop player, 40 runs × 25 rounds per row)

Same command as §19, with the ramp at 1.02–1.06 in rounds 11–15, 1.07 in rounds 16–20 and 1.1 from round 21 (was 1 and then 0.95):

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | §19 All | §18 All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|---|---|
| Classic Easy | 48% | 46% | 60% | 49% | 69% | 54% | 61% | 56% | 5.4 | 8% |
| Classic Normal | 47% | 55% | 54% | 50% | 67% | 54% | 60% | 46% | 5.4 | 10% |
| Classic Hard | 20% | 14% | 25% | 24% | 49% | 26% | 30% | 26% | 1.0 | 0% |
| Growing Easy | 67% | 62% | 77% | 57% | 68% | 66% | 72% | 62% | 9.8 | 5% |
| Growing Normal | 56% | 56% | 68% | 55% | 67% | 60% | 68% | 50% | 6.7 | 8% |
| Growing Hard | 47% | 25% | 33% | 30% | 54% | 38% | 46% | 28% | 3.1 | 0% |

- **Rounds 16–20 are back to about 50% on Normal** (§19: 64–77%), and Hard to 24–30%.
- **Rounds 21–25 stay easy, and budget can't fix it.** The AI already fields 25–30 more points than the player there (Classic Normal round 25: 119 against 151) and still loses more often than in round 20. With boards full of queens and compounds, ~90% of late games end in mate, and the stand-in plays White, so moving first matters more than material (§13 measured first move at ~18 points of win rate). Random-side runs would show a flatter late game.
- **Easy and Normal are within noise of each other on Classic** (54% each; their budgets differ by 3%), as in §19.
- **Engine:** 2–9 battles per suite hung even after a restart (left out, counted as draws).

### 21. Prestige perks and the prestige step (Growing Normal, fairy pieces, shop player, 40 runs × 25 rounds per row)

`npm run sim -- --player shop --rounds 25 --games 40 --fairy both --difficulty normal --board schedule --perks <ids> [--prestige N] [--per-round X] [--save N]`. The sim applies perks through the game's own rules (prestige.ts); "+life" re-scores the same battles with one more life.

| Perk (alone, prestige 0) | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|
| None | 55% | 51% | 63% | 51% | 63% | 56% | 6.8 | 10% |
| War chest (+10 gold) | 91% | 83% | 81% | 66% | 68% | 78% | 15.8 | 28% |
| Squire (Knight + Bishop) | 91% | 87% | 82% | 75% | 80% | 83% | 16.4 | 35% |
| Tithe (+1 gold a round) | 81% | 85% | 94% | 85% | 91% | 87% | 17.9 | 63% |
| Haggler, 2 free rerolls | 68% | 67% | 83% | 76% | 84% | 75% | 11.5 | 23% |
| Haggler, 3 free rerolls | 69% | 65% | 83% | 78% | 83% | 75% | 12.2 | 30% |
| Royal favour, early queens only | 56% | 50% | 65% | 56% | 68% | 59% | 6.1 | 5% |
| Royal favour + a Queen | 97% | 92% | 93% | 84% | 90% | 91% | 20.7 | 70% |
| Royal favour + two queen-pawns | 78% | 77% | 83% | 71% | 81% | 78% | 13.0 | 25% |
| Second wind, +1 life | (same battles as None) | | | | | 56% | 8.6 | 18% |
| Second wind, +2 lives | 56% | 58% | 70% | 54% | 68% | 61% | 11.2 | 28% |
| Bazaar | 62% | 58% | 67% | 58% | 74% | 63% | 9.0 | 23% |
| Banker, saving 25 from round 3 | 24% | 12% | 73% | 85% | 98% | 58% | 1.1 | 0% |
| Banker, saving 10 from round 3 | 30% | 29% | 64% | 67% | 82% | 54% | 2.1 | 3% |

- **Early points decide runs.** A few gold or a minor piece at the start roughly doubles the stand-in's run score, because it wins the early rounds where most runs are lost.
- **Tuned:** Royal favour's early queens alone did nothing and a starting Queen was far too much, so it starts with two queen-pawns. One more life was worth much less than the gold perks; Second wind gives two. Haggler's third free reroll adds little (the stand-in runs out of gold to spend).
- **Not measurable here:** the stand-in only loses by saving, so Banker's numbers show the strategy, not the perk (tuned by hand). Spyglass (the stand-in ignores the opponent's placement) and Dynasty (it never crowns Heirs) aren't simulated.

The prestige step (0.25 AI points per round per level) was worth about 10 points of win rate, a third of one perk, so each level got easier. Tested at higher steps:

| Prestige run | AI per round | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|---|
| ★1, War chest, step 0.75 | 6.25 | 83% | 57% | 50% | 45% | 63% | 59% | 8.3 | 0% |
| ★1, War chest, step 1 | 6.5 | 79% | 50% | 44% | 34% | 58% | 53% | 7.1 | 0% |
| ★1, Tithe, step 1 | 6.5 | 47% | 41% | 42% | 44% | 74% | 49% | 4.0 | 3% |
| ★2, War chest + Tithe, step 1 | 7.5 | 70% | 44% | 32% | 42% | 78% | 53% | 5.5 | 0% |
| ★3, War chest + Tithe + Squire, step 1 | 8.5 | 75% | 26% | 25% | 42% | 82% | 50% | 4.7 | 0% |

- **Chosen: 1 point per round per level.** ★1 with a perk plays about like a fresh Normal run (run score 4–7 against 6.8), and each level after is a little harder (★2 5.5, ★3 4.7): later perks add less than the step does. Perks make the early rounds easy; the AI's extra points make rounds 6–20 the fight. Rounds 21–25 stay easy because both armies hit the full-board cap.
- The stand-in rarely reaches round 25 here, but a player who earned a prestige builds better than it does.

### 22. The game's own engine (RULES_VERSION 9; fairy pieces, shop player, 40 runs × 25 rounds per row)

Same command as §20, now on the game's own engine (depth 8 / 150k nodes, the native build; docs/ENGINE-PLAN.md). Rows are ours / Fairy-Stockfish (§20):

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|
| Classic Easy | 59% / 48% | 59% / 46% | 57% / 60% | 55% / 49% | 74% / 69% | **61% / 54%** | 6.9 / 5.4 | 8% / 8% |
| Classic Normal | 45% / 47% | 42% / 55% | 49% / 54% | 41% / 50% | 68% / 67% | **49% / 54%** | 5.6 / 5.4 | 10% / 10% |
| Classic Hard | 26% / 20% | 15% / 14% | 26% / 25% | 28% / 24% | 67% / 49% | **32% / 26%** | 1.6 / 1.0 | 0% / 0% |
| Growing Easy | 61% / 67% | 58% / 62% | 67% / 77% | 63% / 57% | 71% / 68% | **64% / 66%** | 7.1 / 9.8 | 8% / 5% |
| Growing Normal | 60% / 56% | 52% / 56% | 62% / 68% | 43% / 55% | 59% / 67% | **55% / 60%** | 7.7 / 6.7 | 8% / 8% |
| Growing Hard | 52% / 47% | 32% / 25% | 32% / 33% | 22% / 30% | 45% / 54% | **36% / 38%** | 4.2 / 3.1 | 0% / 0% |

- **The balance holds: no budget change needed.** The suites' overall win rates moved by −5 to +7 points, in both directions, and run scores by less than their ±2.2 margin. Nothing moved the same way across suites, so this is noise and engine variety, not a stronger or weaker AI.
- **Difficulty ordering is cleaner.** Easy > Normal > Hard now holds in both modes. In §20 Classic Easy and Normal had come out level (54% each).
- **More decisive battles.** 68–76% of battles end in checkmate and 23–30% at the move limit. Our engine converts a material lead better than Fairy-Stockfish did. Win rates didn't move with it, because both sides convert better.
- **The late game is still easy** (rounds 21–25, as §20 found): both armies hit the full-board cap and the stand-in moves first. Classic Hard's 67% there (§20: 49%) is part of the same thing.
- **No engine failures.** 0 stalled or hung searches in 6,000 battles. Fairy-Stockfish hung 2–9 times per suite (left out, counted as draws).
- **Time:** 12–17 minutes per suite with 14 engines.

### 23. Piece duels on the game's own engine (`npm run sim:duel -- --a X --b Y --games 200 --budget 40`)

Each game drafts one 40-point fairy army; one side gets it plus piece A, the other plus piece B, and the engine plays it out (colours alternate). The table shows A's score, ±7 points (95%).

| A vs B (points) | A's score | Reading |
|---|---|---|
| Bishop vs Knight (3 v 3) | 48% | even (sanity check) |
| Cannon vs Knight (3 v 3) | 48% | even |
| Man vs Knight (3 v 3) | 51% | even |
| Centaur vs Rook (5 v 5) | **69%** | the Rook is weaker |
| Dragon Horse vs Rook (5 v 5) | **64%** | the Rook is weaker |
| Wildebeest vs Rook (5 v 5) | **68%** | the Rook is weaker |
| Siege Cannon vs Centaur (6 v 5) | 47% | the Centaur plays like a 6 |
| Dragon King vs Archbishop (7 v 7) | **37%** | the Archbishop is stronger |
| Stackman vs Queen (9 v 9) | 60% | the Stackman is a little strong |
| Camel vs Wazir (2 v 1) | 77% | as its extra point says |

- **The minor pieces are priced right** at 3.
- **The Rook is weak for 5 points, against the fairy 5s.** That's the opposite of what the rook-pawn premium was for (6 gold for a 5-point Rook). The tuned evaluation agrees independently: it values the Rook at about 470–500 cp, against about 500–525 for the Centaur, Dragon Horse and Wildebeest.
- **The Centaur matches the 6-point Siege Cannon,** so the fairy 5s look underpriced rather than the Rook overpriced.
- **Done in §24:** the Rook recipe (2 one-gold rook-pawns + a Bishop, Knight or Man).
- **Done in §25:** the Centaur, Dragon Horse and Wildebeest at 6, the Dragon King at 6; the Archbishop and the Stackman as they were.

### 24. The new Rook recipe (RULES_VERSION 10; fairy pieces, shop player, 40 runs × 25 rounds per row)

A Rook is now two rook-pawns at 1 gold each plus a Bishop, Knight or Man of the player's choice (5 gold; it was three rook-pawns at 2 gold, 6 for a 5-point piece), and rook-pawn offers are rarer (weight 0.8, was 2). Same command as §22.

**The recipe alone made the player much stronger early.** Normal suites, player win rate (rows: §22 before / new recipe):

| Normal | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score |
|---|---|---|---|---|---|---|---|
| Classic | 45% / 61% | 42% / 60% | 49% / 66% | 41% / 45% | 68% / 64% | 49% / 59% | 5.6 / 8.1 |
| Growing | 60% / 75% | 52% / 74% | 62% / 80% | 43% / 53% | 59% / 54% | 55% / 67% | 7.7 / 10.9 |

- **Rounds 1–15 rose about 15 points.** The stand-in's army is 3–4 points bigger for the same gold: a Rook costs 5 instead of 6, and Knights merged from the free starting pawns are free partners.
- **Rounds 16–25 didn't move:** both armies are near the full-board cap there.

**Retuned: the AI budget ramp is 5% higher in rounds 2–15** (`RAMP` in aiArmy.ts).
- An 8% bump measured the same as 5% (Classic 45%, Growing 58%), so the smaller one was kept.
- **Round 1 needed no change.** 400 round-1 battles per row (`--rounds 1 --games 400`, the new `--round-one-discount` option):

  | Round 1, Normal | Old recipe | New recipe, discount 1 | Discount 0 | Discount −1 |
  |---|---|---|---|---|
  | Classic | 51% | 53% | 30% | 18% |
  | Growing | 66% | 67% | 55% | 38% |

  The jump the 40-game rows showed (53% → 68%) was noise. A round-1 Rook (two rook-pawns plus a Knight merged from the starting pawns) is 5 points for 2 gold, but the old best opening already reached about 6 points from that gold. The discount stays 1.

**All suites, recipe plus ramp** (rows: §22 / now):

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|
| Classic Easy | 59% / 53% | 59% / 63% | 57% / 57% | 55% / 44% | 74% / 65% | 61% / 56% | 6.9 / 7.2 | 8% / 8% |
| Classic Normal | 45% / 52% | 42% / 48% | 49% / 44% | 41% / 28% | 68% / 53% | 49% / 45% | 5.6 / 4.7 | 10% / 3% |
| Classic Hard | 26% / 37% | 15% / 30% | 26% / 26% | 28% / 14% | 67% / 47% | 32% / 31% | 1.6 / 2.3 | 0% / 0% |
| Growing Easy | 61% / 76% | 58% / 78% | 67% / 81% | 63% / 66% | 71% / 70% | 64% / 74% | 7.1 / 13.4 | 8% / 38% |
| Growing Normal | 60% / 67% | 52% / 59% | 62% / 68% | 43% / 47% | 59% / 50% | 55% / 58% | 7.7 / 8.9 | 8% / 5% |
| Growing Hard | 52% / 53% | 32% / 32% | 32% / 30% | 22% / 18% | 45% / 27% | 36% / 32% | 4.2 / 3.8 | 0% / 0% |

- **On average the balance is unchanged:** 49.3% across the six suites, against 49.5% in §22. Most suites are within noise of their old level.
- **Growing Easy is easier.** Rechecked with 120 runs (seed 5): 69% ±2, run score 11.6 ±1.4, against about 64% before. Classic Easy went the other way (61% → 56%). Growing starts on small boards, where a cheap Rook counts for more. Easy stays the easiest setting in both modes, so it was left as is.
- **Late rounds on Classic came out harder** (rounds 16–25, Normal 28% and 53%). Most of that is the knock-on of losing more in rounds 2–15 (less win income), plus noise (±7 per five rounds).

### 25. Repricing the fairy pieces (RULES_VERSION 11)

More duels, same command as §23 with 300 games (±6) and seed 3:

| A vs B (points) | A's score | Reading |
|---|---|---|
| Dragon Horse vs Centaur (5 v 5) | 46% | even |
| Wildebeest vs Centaur (5 v 5) | 52% | even |
| Dragon King vs Siege Cannon (7 v 6) | 52% | the Dragon King plays like a 6 |
| Archbishop vs Chancellor (7 v 8) | 48% | even |
| Archbishop vs Queen (7 v 9) | 36% | as priced, about |
| Stackman vs Queen (9 v 9) | 56% | a little strong (60% in §23) |

**New values:** Centaur, Dragon Horse and Wildebeest 6 (were 5), Dragon King 6 (was 7).
- **The 6s:** the three ex-5s beat the Rook (§23), play even with each other, and the Centaur plays even with the 6-point Siege Cannon.
- **The Dragon King:** a Rook plus a step; it plays even with the Siege Cannon and lost to the Archbishop 37% (§23), as a 6 should against a 7.
- **Left as they were:**
  - the Archbishop: even with the Chancellor and well below the Queen;
  - the Stackman: 58% ±4 against the Queen over both duels, and at most one per AI army.
- **Prices:** a fusion costs no more than its parts.
  - The Centaur now costs and sells for 6 (a Knight and a Man), so fusing one no longer loses a point.
  - The Dragon Horse (a Bishop and a Wazir) and Wildebeest (a Knight and a Camel) still cost 5 for a 6-point piece, like the Archbishop's 6 for 7.
  - The Dragon King stays 6.

**Balance: unchanged.** The §24 command; rows are §24 / now:

| Mode, difficulty | R1–5 | R6–10 | R11–15 | R16–20 | R21–25 | All | Run score | Reach 25 |
|---|---|---|---|---|---|---|---|---|
| Classic Easy | 53% / 52% | 63% / 59% | 57% / 68% | 44% / 47% | 65% / 60% | 56% / 57% | 7.2 / 7.7 | 8% / 10% |
| Classic Normal | 52% / 50% | 48% / 52% | 44% / 49% | 28% / 36% | 53% / 50% | 45% / 47% | 4.7 / 5.1 | 3% / 3% |
| Classic Hard | 37% / 40% | 30% / 33% | 26% / 20% | 14% / 12% | 47% / 42% | 31% / 29% | 2.3 / 2.8 | 0% / 0% |
| Growing Easy | 76% / 77% | 78% / 75% | 81% / 82% | 66% / 64% | 70% / 56% | 74% / 71% | 13.4 / 14.7 | 38% / 38% |
| Growing Normal | 67% / 65% | 59% / 64% | 68% / 68% | 47% / 46% | 50% / 42% | 58% / 57% | 8.9 / 9.1 | 5% / 8% |
| Growing Hard | 53% / 60% | 32% / 45% | 30% / 41% | 18% / 22% | 27% / 36% | 32% / 41% | 3.8 / 5.8 | 0% / 3% |

- **Five suites moved by 3 points or less.**
- **Growing Hard came out 9 points easier.** Rerun with 80 runs (seed 5), it scored 37% ±2 (run score 4.9 ±0.9), between §24's 32% and §22's 36%. The first row was a high draw, so no budget change was made.
- **The suites' 40-run rows vary by more than their ±3** (battles in one run aren't independent). Treat moves of up to about 5 points as noise.

### 26. Tuning the daily challenge's gold (shop player, 200–300 gauntlets per row)

`npm run sim -- --player shop --games 300 --fairy both --daily [--daily-gold N] [--daily-bonus N] [--daily-income N] [--daily-interest N]` plays the daily challenge: five battles at rounds 2, 4, 6, 8 and 10, no lives. The target is a run's same rounds: `--rounds 10 --games 200 --fairy both` (Growing Normal, seed 7) won rounds 2/4/6/8/10 **51/76/64/63/74%, 66%** on average, with armies about level with the AI.

| Daily (Growing Normal) | B1 | B2 | B3 | B4 | B5 | Avg | Wins / 5 | Cleared |
|---|---|---|---|---|---|---|---|---|
| +6 start, 2× income (first version; seed 7) | 37% | 45% | 45% | 39% | 47% | 43% | 2.1 | 17% |
| +6, 3× income (seed 7) | 37% | 79% | 83% | 97% | 99% | 79% | 3.9 | 30% |
| +9, 2× income, 2× interest (seed 7) | 34% | 50% | 46% | 48% | 53% | 46% | 2.3 | 12% |
| +12, +2 a battle (seed 11) | 59% | 66% | 69% | 72% | 86% | 70% | 3.5 | 33% |
| **+12, +1 a battle** (seed 11) | 59% | 65% | 62% | 61% | 74% | **64%** | 3.2 | 29% |

- **2× income was too little:** the stand-in fell 8–10 points behind the AI by the last battle. A run pays interest every round; the daily once.
- **Doubling the interest barely helped;** a flat bonus a battle did. +12 start and +1 a battle follows the run battle by battle, and the last battle (74%) matches round 10.
- **Classic (standard pieces, seed 11, +12 / +1):** a run's rounds 2–10 won 55/63/43/35/30% (45%); the daily 48/64/42/48/53% (51%), within noise, first battle included.
- **The first army stays the normal one.** With no discount the first battle is 59% (a run's round 2: 51%); 1 point off made it 63%, 2 points 76%.
- **A mistake on the way:** a first pass also let the stand-in reroll 12 times a shop instead of 6 (one shop per two rounds), picked +2 a battle, and found the first battle hard (41%). The cap doesn't matter at +6 starting gold but does at +12, where it buys partial sets it can't finish. Every row above is with the normal cap.
- The stand-in spends almost all its gold in both modes (under 1 gold left going into a battle: the report's "Gold unspent" line).

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
