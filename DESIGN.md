# Pawned Up — Design Document

The source of truth for how the game works. Update it whenever a rule or tuning decision changes.
Balance numbers come from the simulator; see [SIMULATION.md](SIMULATION.md) for the data behind them.

## Pitch
Draft and place a chess army, then watch an engine play the round for both sides. Survive as long as you can against stronger and stronger AI armies, on a board that grows as the run goes on.

## Scope today
- Single player against AI-drafted armies.
- Mobile-first web app with touch drag-and-drop, live on GitHub Pages, and an Android app (Capacitor, `android/`) with rewarded ads (AdMob test ads for now).
- No accounts or server. The run in progress and best scores live in the browser (localStorage).

## Core loop
1. **Shop.** Spend gold on the round's shop offers and rerolls, and merge pieces into stronger ones. You see the opponent's style and piece list (and, with Reveal on, where its pieces are).
2. **Place.** Arrange your army in your home rows. Extras wait on the bench.
3. **Battle.** **Auto fight**: the engine plays both sides; you watch, with an eval bar and 1×/2×/4×/Skip playback. In a **Play yourself** run (a New game option) every battle is **Play it** instead: you move your own pieces and the engine plays the opponent exactly as in auto battles.
4. **Result.** Win, lose or draw. Gold is paid out; a loss costs a life.
5. Repeat until you're out of lives.

## Runs
- **3 lives.** A loss costs one; a draw costs none. The score is rounds won.
- **Extra life (Android app):** the game-over card of a run lost on lives offers *Watch an ad for an extra life*: a rewarded ad brings the run back with 1 life at the next round, once per run. The run's end is only recorded on the Profile once the player moves on without reviving. No ads on the web (ad networks can't load in the cross-origin-isolated page) and none in multiplayer.
- **25 rounds.** Getting through round 25 with a life left wins the run: a victory card (record, and the end-of-run summary) and a "completed" count on the Profile. By then both armies are a full board of queens, so the run ends on a high instead of fading out. The header shows "Round 12/25". 
- **End-of-run summary:** the victory and game-over cards chart your army's points against your opponents' for each round (losses marked), with the run's best win streak and biggest army.
- **First-run tips:** one short tip at a time above the opponent line on the shop screen (how to play, a set ready to merge, tapping a piece for its choices, affinity pawns, interest and the lock, the opponent list), each dismissed for good with ×. Kept per device; Settings → *Show again* brings them back. In a match the how-to-play tip speaks of Ready and the last one standing.
- **Prestige:** the victory card offers *Prestige ★N*: start over at round 1 with the starting army and lives, one prestige level higher. Opponents get 1 more point per round per level (it was 0.25, less than any perk was worth, so each level got easier; SIMULATION.md §21), and the player picks one of three perks to keep for good (stackable ones can come up again). Each perk is a play style, tuned with the simulator to roughly double a run's score on its own:
  - **War chest:** +10 starting gold (stacks).
  - **Squire:** start with a Knight and a Bishop (stacks).
  - **Tithe:** +1 gold every round.
  - **Banker:** interest is +1 per 5 gold saved, up to +5 a round (normally per 10, up to 3). A saving strategy the simulator's stand-in can't play, so it's tuned by hand.
  - **Haggler:** the first 3 rerolls each round are free.
  - **Royal favour:** start with two queen-pawns; queens and queen-pawns show up from round 4 and twice as often. (A whole Queen to start was far too strong.)
  - **Second wind:** +2 lives.
  - **Spyglass:** see where the opponent's pieces stand while placing (only offered with Reveal off; Warlord counts it as Reveal).
  - **Dynasty** (fairy): a second Heir, and each Heir crowned pays 9 gold back. The first prestige of a fairy run always offers it.
  - **Bazaar** (fairy): fusion pieces show up in the shop, priced at what their parts cost.
  The header shows ★N; the Profile shows the highest prestige. Single player only.
- **Main menu** (the landing screen, and *Menu* in the header): *Resume game* (shown while a run or a Play it game is in progress, with its round and lives), *New game*, *Daily challenge* (see Daily challenge), *Multiplayer*, *Profile*, *Piece guide*, *Settings* and *Review your last battle*. A battle interrupted by a reload is reported here.
- **New run window** (opens from *New game*) sets the run's settings, which are fixed for the whole run:
  - **Board (game mode):** *Growing board* (default; 5×5 growing to 9×9, see Board sizes) or *Classic* (8×8 throughout).
  - **Difficulty:** how fast the AI's budget grows: Easy 5.35×round, Normal 5.5×round (default), Hard 6×round, times the ramp. Easy about matches a typical player (the simulator's stand-in matched it point for point over 25 rounds); Normal sits a little above; Hard is the real test. 5.75 / 6.25 suited a strong player but walled the stand-in (Normal 14% wins). The simulator's stand-in builds worse than people, so its win rates (SIMULATION.md §16) understate the difficulty.
  - **Play as:** White (default; you move first), Black (the opponent moves first, but its army is 2% smaller: moving second costs a few points of win rate) or Random each round. Your pieces are always white to the engine; playing Black only swaps the colours on screen and who moves first.
  - **Fairy pieces** (default on): fairy pieces in the shop and in AI armies, and fusion. Off = standard chess pieces only.
  - **Reveal opponent's placement:** an easier option that shows where the AI's pieces are during placement.
  - Starting a new run while one is in progress warns that it will be abandoned.
- **Best score** is kept per mode and difficulty.
- **Profile** (from the menu): the player's generated name (*New name* picks another; it's what friends see online) and records kept on this device, by tab:
  - *Single*: per board mode and difficulty, runs, best and average score, rounds won/lost/drawn (best scores from before records existed are carried over).
  - *Multiplayer*: online and vs bots, normal and Blitz: matches, wins, average place, top-2 rate and a 1st–4th bar.
  - *History*: the last 20 finished runs and matches.
  - *Fun*: most-bought piece (offers, upgrades and fusions), best and current win streak, checkmates delivered, biggest comeback (largest material deficit turned into a win).
  - Signing in to keep records across devices is planned (anonymous records would carry over).
- **Replays:** the last finished battle is kept (start position, seed, moves, evals); *Watch replay* on the result screen and *Review your last battle* on placement play it back. Auto battles are deterministic from their start position and seed.
- **Saving:** the run (army, gold, lives, record, settings and the current opponent) is saved after every change, so a reload resumes it. Saves carry a format version and are migrated when the format changes; runs saved before game modes existed load as Classic.
- **No replays:** when a battle ends, the game moves straight to the next round and drafts its opponent, so reloading on the result screen can't replay a round. Leaving or reloading *during* a battle counts as a loss on the next load (with a notice). A battle that fails with an error doesn't count.

## Pieces and economy
| Piece | Value | Merge | Or gold upgrade |
|---|---|---|---|
| Pawn | 1 | Starting pawns; Berolina pawns from the shop (fairy) | |
| Knight / Bishop | 3 | 3 knight-pawns / 3 bishop-pawns (1 gold each), or 3 plain pawns | Plain pawn + 3 gold |
| Rook | 5 | 2 rook-pawns (1 gold each) + a Bishop, Knight or Man of the player's choice | No |
| Queen | 9 | 3 queen-pawns (3 gold each), 2 Rooks, 3 Knights or 3 Bishops | No |
| King | — | Free, always owned, can't be sold |

- **Gold upgrades:** only a plain pawn (no affinity) → Knight/Bishop, for 3 gold. Rooks and Queens come only from merging or the shop; spare gold goes into rerolls.
- **Affinity pawns:** pawns bought for a piece (knight-, bishop-, rook- or queen-pawn), shown with a small badge of that piece. They fight as ordinary pawns (and count toward the 8-pawn limit) until three with the same affinity are merged into the piece; a Rook takes two rook-pawns and a Bishop, Knight or Man (below). Queen-pawns cost 3 gold and come only from round 6. They sell for their price. The piece panel and the offer show how many of the set you have ("you have 2/3"; rook-pawns "1/2", and whether a Bishop, Knight or Man is still missing). (Until RULES_VERSION 10 a Rook was three rook-pawns at 2 gold each, 6 for a 5-point piece, because rooks proved strong for their value under Fairy-Stockfish; on the game's own engine they lose to every 5-point fairy piece: SIMULATION.md §23.)
- **Start:** King + 3 pawns, plus 4 gold (Growing) or 3 gold (Classic).
- **Income:** 5 gold per round, +2 for a win, +1 for a draw, plus **interest**: +1 gold per 10 unspent (up to +3), counted on the gold saved before the battle. The shop shows the interest due ("23g +2 interest").
- **Shop lock:** 🔒 next to Reroll keeps the current offers (whatever's left of them) into the next round; it unlocks after that round, or when you reroll.
- **Selling** refunds what the piece is worth, as in other auto-battlers: its price (an affinity pawn's too), so collecting a set or changing plans costs nothing. Plain pawns are only ever the free starting pawns, so they sell for nothing. A fusion sells for no more than its parts (an Archbishop, worth 7, sells for 6), so fusing and selling never makes gold. The King and the Heir can't be sold. (Until RULES_VERSION 8 selling refunded value − 1, which made selling rare.)
- **Army size:** only pieces on the board count: at most two per file, a chess side's worth (16 on 8×8; on the smaller boards that's every home square: 10 / 12 / 14), so it grows with the board in Growing mode. AI armies follow the same limit. No limit on the mix of pieces.
- **Bench:** up to 8 pieces wait off the board, to mix and match. Bought pieces arrive there, so buying needs a free bench slot. A bench piece can go onto a full board by swapping with a placed one.
- Pieces lost in battle come back for the next round.
- **Shop offers:** 4 random offers each round, bought onto the bench: mostly affinity pawns, with finished pieces (priced at their value; the Wazir 2 gold) rare. Offers cost at most 2 + 2×round (Rooks from round 2; Queens and queen-pawns from round 6). Plain pawns aren't offered. Ferz, Wazir and Man are less common than the other fairy offers (they used to be in about three shops of four), and rook-pawns rarer still, as rare as the Man (about one shop in five): the Rook is getting a cheaper recipe (SIMULATION.md §23). Reroll: 1 gold. Fusion pieces are never offered except the Stackman (rare, 9 gold, fairy only, from round 4), nor is the Grasshopper (players didn't find it worth buying; it stays in the rules for old saves and replays). With fairy pieces off, offers are standard pieces only.
- **Piece info:** tapping any piece (yours, a shop offer, or the opponent's in its list or on the revealed board) shows its value, how it moves in words, and a move diagram: a 7×7 board with the piece in the middle and a mark on every square it reaches (a dot to move or capture, a ring to move only, a cross to capture only, a diamond to land by hopping; src/rules/movePattern.ts). A selected piece of yours shows its merges, upgrades and Sell in the shop, in place of the offers; a selected offer shows its Buy button under them. Each panel's *How it moves* opens the Piece guide on that piece.
- **Piece guide** (from the menu, or *How it moves* in a piece panel; it opens over the screen and *Back* returns there): every piece a player can meet, in four tabs (Standard, Pawns, Fairy, Fusions), with a legend for the diagram marks. Each piece shows its art, value, one-line description, move diagram, a *Fairy* tag when it needs Fairy pieces on, and how to get it: the starting army, a shop offer and its price (and first round), three-of-a-kind and two-Rook merges, the Rook recipe, gold upgrades and fusions. These are read off the shop rules (src/rules/pieceGuide.ts), so the guide follows any change to them; a piece no way gives (the Grasshopper) is left out.
- **No single-pawn purchases:** pawns come from shop offers (Pawn and Berolina pawn are the most common offers).
- **Merging** (free, every mode; one tap, but not automatic: completing a set doesn't merge it by itself):
  - Three affinity pawns with the same affinity → that piece, except the Rook:
  - **Rook** = two rook-pawns + a Bishop, Knight or Man (any of them, however it was made; 5 gold for a 5-point piece). The player picks which piece is used up: select a rook-pawn for one button per Bishop, Knight or Man type in the army (*+ ♞ → Rook*; that type's benched piece first), or select the very Bishop, Knight or Man to use (*+ 2 rook-pawns → Rook*). The selected piece becomes the Rook where it stands.
  - Three plain pawns (the starting pawns, or three Berolina pawns) → Knight or Bishop.
  - Two Rooks → Queen.
  - Three Knights → Queen, or three Bishops → Queen (no mixing knights and bishops).
  - Three Men → Stackman (fairy): three 3-point Men for a 9-point piece that frees two board squares. No fee and no limit per army: a Man now costs 3 gold however it's made (the Wazir costs 2), and Ferz, Wazir, Man and Stackman offers are rarer instead. AI armies still field at most one (the drafter has no shop to make them rare). (Until RULES_VERSION 8 it cost 3 gold and was one per army, because 1-gold Ferz + Wazir fusions made Men too cheap.) It's strong for 9 points (`npm run sim:duel`, 40-point armies: 65% against a Queen, 35% against a 12-point Amazon).
  - Three Queens → **Heir** (fairy, one per army, or two with the Dynasty prestige perk; can't be sold): a second king with its own icon (the king without its cross, smaller), benched (a queen's square may be on the front row, and like the King it can't stand there). While a side has its King and its Heir neither is royal: either can be captured (both attacked at once isn't mate either), and the last one left is a real king that can be checkmated. The battle screen announces the capture ("Their King was captured! Their Heir takes the crown.") (Fairy-Stockfish's Spartan-chess rules, on each board's two-kings variant, used only when an Heir is on the board; every other battle is unchanged). Our FENs write the Heir 'J'; the game's engine knows it as its own piece (Fairy-Stockfish, still used to test the rules, sees it as a second king). 27 points for checkmate insurance and two free squares (army totals, like the placement screen's points, the end-of-run chart and Absolute Unit, count it as 27; in battle it counts 0, like the King, so hiding it can't win on points): a late-game luxury, never sold. AI armies (and multiplayer bots) rarely field one from round 20 in fairy runs (12% of armies, paid for with 27 points of their budget, as three Queens).
  - Three of a kind merge in one tap: the selected piece shows *Merge 3 → Knight* (three plain pawns show a button each for Knight and Bishop), using it and two more of the same kind, benched ones first. The result takes the square of the first of them on the board. Two-piece merges are buttons on the selected piece, which becomes the result where it stands.
- **Fusion** (fairy pieces on): free, like merging. Knight + Bishop → Archbishop, Knight + Rook → Chancellor, Knight + Queen → Amazon, Knight + Man → Centaur, Rook + Ferz → Dragon King, Bishop + Wazir → Dragon Horse, Knight + Camel → Wildebeest, Cannon + Bishop → Siege Cannon, Ferz + Wazir → Man (1 + 2 gold for a 3-point piece made of two 1-point ones; Ferzes and Wazirs stand on the back row and don't count toward the 8-pawn limit). The selected piece becomes the compound where it stands; the partner is used up. Fused pieces sell for their value, but never more than their parts.

### Fairy pieces
Values are tuned with the simulator (SIMULATION.md section 11): at equal points, AI armies with fairy pieces do as well as standard ones.

| Piece | Value | Moves |
|---|---|---|
| Berolina pawn | 1 | Moves diagonally forward (two squares from rank 2), captures straight ahead; promotes like a pawn |
| Ferz | 1 | One square diagonally |
| Wazir | 1 | One square straight. Costs 2 gold (the one piece priced above its value), so a Man costs 3 gold from its parts; at equal armies it scores 54% ±7 against a Ferz, 60% against a pawn, so it's worth about what a Ferz is |
| Man | 3 | Like a king, but can be captured |
| Camel | 2 | Jumps (3,1) |
| Grasshopper | 1 | Along queen lines, hopping over a piece to land just beyond it |
| Cannon | 3 | Moves like a rook; captures by jumping over exactly one piece (Xiangqi) |
| Centaur | 6 | King + Knight (fusion) |
| Archbishop | 7 | Bishop + Knight (fusion) |
| Chancellor | 8 | Rook + Knight (fusion) |
| Amazon | 12 | Queen + Knight (fusion) |
| Dragon King | 6 | Rook + one diagonal step (fusion: Rook + Ferz) |
| Dragon Horse | 6 | Bishop + one straight step (fusion: Bishop + Wazir) |
| Wildebeest | 6 | Knight and Camel jumps (fusion: Knight + Camel) |
| Siege Cannon | 6 | Moves like a queen; captures by jumping exactly one piece (fusion: Cannon + Bishop) |
| Stackman | 9 | Jumps to any square up to two away, over anything in between (merge: three Men; also sold, rarely, for 9 gold) |

## Board sizes
In Growing mode the board opens up during the run:

| Rounds | Board | Home rows each | Home squares | Gap between armies | Move limit |
|---|---|---|---|---|---|
| 1–2 | 5×5 | 2 | 10 | 1 row | 60 plies (30 moves each) |
| 3–4 | 6×6 | 2 | 12 | 2 rows | 70 plies |
| 5–6 | 7×7 | 2 | 14 | 3 rows | 80 plies |
| 7–8 | 8×8 | 3 | 24 (16-piece limit) | 2 rows | 90 plies |
| 9+ | 9×9 | 3 | 27 (18-piece limit) | 3 rows | 100 plies |

- Classic uses the 8×8 row throughout.
- Placed pieces keep their squares when the board grows; a notice announces the new size.
- The engine supports boards up to 9×9 (its tables are sized for it); bigger boards would need a larger table and a longer move limit (two-thirds of 10×10 battles hit 90 plies under Fairy-Stockfish: [docs/SPIKE-FAIRY.md](docs/SPIKE-FAIRY.md)).

## Placement rules
- You own the bottom home rows; the AI owns the same number at the top (mirrored).
- The king can't go on the front home row; pawns can't go on the back row. A refused placement flashes its square red and the reason shows below the board.
- A piece made by a merge, fusion or upgrade isn't left selected (the next tap would move it).
- A pawn on your second rank may move two squares on its first move. No castling.
- Promotion works as normal (the engine picks the piece) and lasts only for that battle.

## Battle rules
- **Play yourself** (New game toggle, like Fairy pieces and Reveal): every battle of the run is played by hand (auto runs offer both Play it and Auto fight each round). Same opponents and difficulties, so it's the harder challenge; its records (best, runs, completions) are kept separately on the Profile ("Classic · Normal · Play yourself").
- **Review:** the result card's *Review* (and *Review your last battle*) opens the battle on its final position with a slider over every move and ⏮ ◀ ▶︎ Play ▶ ⏭ buttons, for auto and manual battles alike. Play it games show their eval bar only here: each position is evaluated by the engine the first time it's shown ("…" meanwhile), and the evals are saved with the battle.
- **Playing it yourself:** tap a piece then a highlighted square, or drag it. No move limit: the game ends on the board (checkmate, stalemate, repetition, insufficient material on points, the 50-move rule) or by resigning (a loss; it takes two taps). **Undo** takes back your last move and the opponent's reply. The eval bar is hidden until the game ends. The game is saved after every move, so closing or reloading the page resumes it instead of counting a loss.
- **Insufficient material** (nobody can mate) is decided on points like the move limit; level material is a draw.
- **Repetition:** the engine is given the moves played so far, so it sees repeated positions as draws and the side that is ahead avoids them.
- **First move:** White, i.e. the player unless they play Black (see Play as), unless a king starts in check (that side moves first). If both kings start in check, the AI re-places its army.
- **Move limit:** 10 × board size + 10 plies.
- **Win:** checkmate, or more material at the move limit, shown as a win/defeat **on points**.
- **Draw:** equal material at the limit, stalemate, threefold repetition, the 50-move rule, or insufficient material.

## AI opponent
- **Engine:** the game's own engine (`engine/`, Rust compiled to WASM, in a Web Worker) plays both sides with identical settings: depth 8 within 150,000 nodes, picking randomly among up to 3 moves within ~50 centipawns of the best for variety. Limits are in depth and nodes, never time, so every device plays the same battle. It plays the battle rules: at the move limit and with insufficient material the side ahead on points wins, and it plays for that. On par with Fairy-Stockfish at depth 8, which it replaced (RULES_VERSION 9; 49.7% over 2,000 game-drafted battles: docs/ENGINE-PLAN.md). Skill is in drafting and placement, not a better engine.
- **Budget per round:** difficulty × round × the ramp (rounded), ±1 random, −1 in round 1, and +1 every round in Growing mode (matching its extra starting gold so both modes have the same balance). −2% when the player is Black. Never more than a full board of queens around the king (15 queens, 135 points, on 8×8).
- **Ramp:** dips in rounds 2–4 (0.97–0.99), peaks around round 7 (1.16), 1.05 in round 10, then climbs again: 1.07 to 1.11 in rounds 11–15, 1.07 in rounds 16–20 and 1.1 from round 21. Rounds 2–15 went up 5% when a Rook became 5 gold (RULES_VERSION 10, SIMULATION.md §24). Until full sell refunds it eased to 0.95 from round 16 (SIMULATION.md §18); with them the late game was easy at that level (§19).
- **Styles** (a new style and army each round, shown during placement):

  | Style | Draft | Layout |
  |---|---|---|
  | Balanced | ~35% pawns, an even mix | King on d/e behind a pawn shield |
  | Fortress | ~60% pawns, minor pieces and rooks | King tucked in a corner behind a full pawn wall |
  | Heavy Artillery | ~20% pawns, rooks and queens | Rooks on the back row, queen central |
  | Cavalry Charge | ~25% pawns, knights and bishops | Pieces pushed forward |
  | Menagerie (fairy only) | ~30% pawns, mostly fairy pieces, many Berolina pawns | Pieces a little forward |

- **With fairy pieces on**, every style also drafts its own fairy pieces (Fortress: Ferz, Wazir, Man, Cannon; Heavy Artillery: Cannon, Chancellor, Archbishop, Amazon; Cavalry: Camel, Centaur, Archbishop; Balanced: a little of each), some of its pawns are Berolina pawns, and its leftover points can go into fusions (as if it had bought the partner). Fairy pieces are placed like the standard piece they resemble (short-range ones like knights, cannons like rooks).

- **Drafting:** non-pawn pieces by the style's weights, the rest on pawns (at most 8, and only as many as fit), then more of the style's pieces while squares are free, then leftover points into upgrades at their value difference, as if merged (pawns last, so pawn-heavy styles keep their pawns). Armies never exceed the board's home squares.
- **Placement:** each square is scored per piece for the style (tables written for 8×8 and scaled to smaller boards), with random noise and a random left/right flip. Pieces leave room for the pawns placed after them.
- **Engine safety net:** a search that fails, or doesn't answer within 30 seconds (searches are node-limited, so only a broken worker would), plays a random legal move instead and restarts the engine's worker.

## Achievements

Easy, fun goals (src/game/achievements.ts), unlocked once and kept in the records (they sync with them, from the earliest unlock). A notice slides in at the top when one unlocks (several unlocked at once queue up, one after another), and the result card lists the ones the battle unlocked ("🏆 New: …"); the Profile's *Awards* tab lists them by group (unlocked first), with progress for the collections. "On the board" counts placed pieces of a family, fusions included: knights (N, Archbishop, Chancellor, Amazon, Centaur, Wildebeest), rooks (R, Chancellor, Dragon King), queens (Q, Amazon), bishops (B, Archbishop, Dragon Horse, Siege Cannon), camels (Camel, Wildebeest), men (Man, Centaur, Stackman), pawns (pawns of any kind, Berolina pawns).

- **Armies and merges:** 15 of a family on the board (Bring in the Cavalry!, The Wall, Solomon, Silk Road, Oops all pawns, Sausage Party, Vatican); It's not a boulder… (a Rook from its recipe), I'm the Stackman, Finally, a son (an Heir), The infamous second son (secret; needs the Dynasty prestige perk); Dragons now? (Dragon King and Dragon Horse in one army); Barnyard (Camel, Wildebeest and Centaur); Absolute Unit (120+ points on the board); All Hands on Deck (every home square filled: only the small boards' army cap allows it).
- **Battles** (checked from the battle's moves, for the player's side): Holy Diver (a bishop-family piece takes in a corner from the opposite corner), David and Goliath (beat an army worth twice yours), Comeback Kid (win after being 10+ points behind), Pawn Storm (mate with a pawn), Long Live the King (win after losing the King), Royal Wedding (promote), Photo Finish (win on points by one).
- **Runs:** The Undefeated (win a run without losing a battle), Warlord (win a run on Hard with the board reveal off; any board, standard or fairy pieces), Prestigious (prestige ★3), Do It Yourself (win a Play it battle), Hoarder (50 gold), Shopaholic (10 rerolls in a round).
- **Multiplayer:** Last One Standing (win a match), Untouchable (win without losing a battle), Pool Shark (buy the last one in the pool), Kingmaker (finish 2nd with the winner on 1 HP), Specter (watch 5 battles after being knocked out).
- **Collections** (career, kept in the records): Zoo Keeper (field every fairy piece the shop sells: Berolina pawn, Ferz, Wazir, Man, Camel, Cannon, Stackman), Fusion Chef (make every fusion).

The Profile's Fun tab shows the most-bought piece (not counting pawns, Ferzes and Wazirs, which everyone buys most) and the collections' progress.

## Look and feel
- Chessnut SVG pieces (Apache 2.0). The board always shows the player at the bottom, and squares scale so every board size fills the same width.
- Moves animate at ~0.4 s at 1×, with an eval bar from the player's side.
- Results name the reason ("Victory on points", "Drawn by threefold repetition"). The result comes up as a sheet from the bottom of the screen with tiles for the round's gold, lives and record (rounds won, record and best when the run is over), the battle's new achievements on a gold banner, and confetti for a win.
- **Battles** show each side's remaining pieces and points above (them) and below (you) the board; the playback speeds are one segmented control beside Skip.
- **Phones held upright** fit the shop under the board (the Arcade design): one top row with the round, lives and Menu (board size, side, record and best under them), the opponent on one line ("VS Cavalry Charge · 12 pts" and its pieces), the bench's label on its border, and offer cards with a band coloured by price (1, 2–3, 4–5, 6–8, 9+ gold). The game's title shows only on the menu (and in a room's lobby). A board that grows announces it with a notice and a short swell; bought and merged pieces pop in, and placed pieces land. In a match the four players' health is two to a row, and the shop's countdown also shows over Ready.
- **Sound:** short synthesised effects (Web Audio, no sound files) for placing, buying, selling, merging, rerolling, refused moves, battle moves, captures and checks, results, achievements, the board growing and a match's last five seconds. Settings turns them off and sets their volume (10–100%, default 50%); the speaker on the menu is a quick mute, kept in step with Settings.
- **Settings** (from the menu; settings.ts, kept per device under `acc.settings.v1`, sound on/off under `acc.sound.v1`): sound on/off, effects volume, the speed battles start at (1×, 2× or 4×; the playback buttons still change it during a battle), *Reduce motion* (cuts animations, confetti, smooth scrolling and the menu's drifting pieces, as the device's own reduced-motion setting does; the device's setting still applies when it's off), *Tips: Show again* (clears the dismissed first-run tips), and About: the engine, pieces and code credits (moved there from the menu's footer) and a link to the privacy policy.
- **Privacy policy:** `public/privacy.html`, a static page in the Arcade colours, linked from Settings → About. Still a draft: its open questions (developer name, contact, data retention, ad personalisation, age rating) need answers before the Play Store listing.
- **Landscape:** the board never grows taller than fits on screen. On landscape phones, touch tablets held sideways and wide desktop windows (1000px and up) the header, run bar and Menu button share one short row, and the shop and battle screens use two columns: the board and bench stay in view on the left while the shop, opponent and battle controls scroll on the right, with the fight bar pinned to the bottom. The board grows up to 560px where the screen is tall enough. The installed web app no longer locks to portrait.

## Tech
- Vite + TypeScript 7, no UI framework. Biome for formatting and linting.
- Rules: the game's own engine (`engine/`, Rust compiled to single-threaded WASM), which plays Fairy-Stockfish's rules for these variants exactly (checked move for move against ffish by `npm run check:perft`); the same engine searches the battles, in a Web Worker. Single-threaded, so the page needs no cross-origin isolation. Fairy-Stockfish WASM played the battles until RULES_VERSION 9; a `fairy` build (`npm run build:fairy`) still plays them with it, with the cross-origin isolation it needs (COOP/COEP headers, coi-serviceworker on GitHub Pages) and its own RULES_VERSION (8 until the piece values changed in 11, then 12), so the game can go back to it (docs/ENGINE-PLAN.md).
- Code layout and conventions: see [CLAUDE.md](CLAUDE.md).

## Known issues
- **5×5 draws:** round 1 in Growing mode drew ~38% of the time; deciding insufficient material on points and showing the engine the move history brought that to 17% (SIMULATION.md section 12).
- **Safari / iOS:** the game's engine needs no cross-origin isolation, so nothing special. (A `fairy` build does: COEP forced to require-corp with a one-time reload fallback, untested on a real iPhone.)
- **Fairy balance:** fusion pieces and the shop player buying fairy offers aren't measured yet.

## Multiplayer
Live, TFT-style matches for 4 players. Everything that decides a match is deterministic from the match seed (pairings, bot armies, battles), so each client computes the results itself: there's no game server.
- **Health:** everyone starts at 30 HP. Losing a battle costs the round number plus 1 per 5 points of material the winner has left; a draw costs nothing. At 0 HP you're out; lower HP places worse among players knocked out in the same round. Last one standing wins (places 1st–4th).
- **Rounds:** everyone shops and places at the same time for 45 seconds (20 in Blitz), ending early when all are Ready. Your next opponent is known as soon as the shop opens (pairings come from the match seed), and you see the pieces they've placed (types only, updated as they shop); where they stand stays hidden until the battle starts (army positions are protected by the Firestore rules). If your king is still on the bench when the timer ends, it's placed for you.
- **Pairings and sides:** random each round from the match seed, including who is White, but nobody meets last round's opponent again if any other pairing avoids it (with two players left it can't be avoided; meeting a copy's owner counts as meeting them); White moves first. Your side is announced before the battle ("You're Black against …"), and your pieces are drawn in your colour at the bottom of the board. With an odd number left, the last player fights a copy of another player's army; only the odd player can take damage or extend a streak in that battle.
- **Income:** base 5, +1 for a win (+1 for a draw), plus a streak bonus for win or loss streaks: 2 in a row +1, 3 +2, 4 or more +3. Draws neither extend nor break a streak and pay no streak bonus. Streaks show in the health list (🔥 wins, ❄️ losses). +1 gold after a round played as Black. Interest and the shop lock work as in single player.
- **Battles:** auto only (no Play it in multiplayer). You watch your own. Online, each phone computes only its own battle and reports the result to the room; bot-vs-bot battles are computed by the first seated person's phone on a second engine, mostly during the shop (their armies are known from the seed). The round is applied from the reported results once everyone has watched theirs (or after 2 minutes, unreported battles counting as draws), so every phone gets the same health list; a phone still playing when the room moves on stops and catches up. Offline, the other battles run on the second engine alongside yours. Engines load when a match starts.
- **Rules:** Classic 8×8 with standard pieces by default. Whoever creates a room, looks for a quick play match or plays vs bots can pick **Growing board** (5×5 up to 9×9, as in single player: King + 3 pawns and 4 gold, bots get its +1 point a round) and **Fairy pieces** (fairy offers, fusion and fairy bot styles). The lobby shows the room's rules. Quick play only matches people with the same rules (board, pieces and Blitz); the lobby names them ("Growing Fairy Blitz"). Economy otherwise as in single player (offers, upgrades, fusion).
- **Shared pool:** everyone in a match buys affinity pawns, Ferzes and Wazirs from one supply: 12 knight-pawns, 12 bishop-pawns, 9 rook-pawns, 6 queen-pawns, 10 Ferzes, 10 Wazirs (fairy rooms). A pawn someone holds (board or bench) is out of the pool; merging it into its piece or selling it puts it back, and so does being knocked out. Offers show how many are left ("7 left", "sold out") and scarce pawns show up less often (chance × left/size). Bots each hold 2 of one kind per round (from the seed). Online, each person's holdings are shared in the room; two people buying the last copy at the same moment can both get it (friendly rooms, no transaction). Merging or fusing works the same for all of them: a Ferz and Wazir fused into a Man are back in the pool. Finished and other fairy pieces aren't pooled.
- **Perks:** the shops of rounds 3, 6 and 9 open (matches usually end by rounds 8–11) with a pick of one of three perks (seeded per player, so everyone's choices are fixed): War chest (+5 gold now), Squire (a Knight now), Tithe (+1 gold a round), Haggler (first reroll each round free), Royal favour (queens and queen-pawns from now on), Bulwark (−2 HP lost per loss, at least 1), Sharp edge (+2 damage when you win; not for a copy), Second wind (+8 HP at the end of that round, up to 30). One-off perks (Haggler, Royal favour) aren't offered twice, and Second wind isn't offered at full health (another perk takes its place). The shop timer keeps running; time's up or Ready takes the first choice. Bots pick their first choice, never Second wind (its use depends on their health back then, which a rejoined client doesn't know). Picks are shared in the room (health is worked out from them on every client) and shown as icons in the health list.
- **Scouting:** tap anyone in the health list for their health by round, perks, pawns from the pool, what they're placing now (people's shared preview, bots' army; types only) and last round's army on its home rows.
- **Watching:** the round card has a *Watch* button for each other battle of the round. This device replays it from the locked armies and the battle seed, so it goes exactly as it did wherever it was computed; then back to the card. Online, starting to watch counts the player as finished with the round (nobody waits on them), and if the room moves on meanwhile the replay stops and the card offers the next round. Knocked out while others play on, the final card offers *Keep watching the match*: online it follows the room (each round's results as they come, a Watch button per battle); offline this device plays the bots' remaining rounds. Records count the match when the player is knocked out.
- **Bots:** AI-drafted armies at the single-player Normal budget, the same on every client.
- **Offline:** *Multiplayer* → *Play vs 3 bots* (optional Blitz).
- **Online rooms** (Firebase project `auto-chess-chess`, anonymous sign-in): each room records the game's RULES_VERSION, and only players on that version can join it (`firestore.rules` checks the joiner's seat carries the room's version), since every phone computes its own battles; quick play only matches rooms on the same version. *Create room* gives a 4-letter code to share; others *Join room* with it; the host starts whenever they like and empty seats become bots. Players have generated names ("Golden Knight 19"). Ready uploads your army; the shop closes when everyone still in is ready or the deadline (server time) passes; the round ends once everyone has watched their battle (or after 2 minutes). Someone who leaves keeps their last army (or a lone king) and plays on until knocked out. *Leave* (two taps) exits a match. On the Profile a match counts as online only if another person played in it; a room that filled up with bots counts as a match against bots.
- **Rejoining:** each device saves its side of an online match (room, shop, gold, streak). After a reload, or after leaving, the menu offers *Rejoin match* while the match is on and the player is still in it (saves older than 6 hours aren't offered). A match started on another version of the game (RULES_VERSION) can't be rejoined: this phone would compute its battles differently. A player who missed rounds gets base income for each one (their last army fought them) and their streak starts over; one who rejoins mid-battle plays their battle, or waits if they had already finished it.
- **Quick play:** any rules (Classic or Growing board, standard or Fairy pieces, with or without Blitz). It takes a seat in an open quick play room with the same rules, fullest first, or makes one. A quick room has no code to share and no host button: it starts by itself once 4 people are in, or 30 seconds after the last person joined, with bots in the empty seats (anyone in the room may start it when it's due). Rooms nobody joined in the last 40 seconds aren't joined (they've started, or were abandoned). If two people make rooms at the same moment, someone still alone in the newer room moves to the older one.

## Daily challenge
A short daily gauntlet, the same for every player: five battles against armies fixed for the day, with a day streak. The puzzle is spending your gold to beat armies you can see coming.
- **The five armies:** from the day's seed (the UTC date plus RULES_VERSION, so a rules update starts a fresh challenge instead of quietly changing today's): a hand-made army or one from the AI drafter.
  - **Hand-made armies** (`src/rules/dailyPool.ts`, 19 to start): each has a name (shown as the opponent's: "The Pawn Wall", "Queen's Gambit"), the battle it was built for, a style tag and its exact layout. A battle picks one, half the time for now (`DAILY_POOL_SHARE`; to rise as the pool grows), from the armies that fit the day: written for that battle's board, no fairy pieces on a standard day, the day's style on a Fortress or Menagerie day, and points within 1 of the drafter's budget range for that battle on that day (Hard and playing Black included). It may be mirrored left to right. Nothing fits → the drafter. The pool covers every battle of Growing, Classic, Black and Play yourself days; Menagerie, Fortress and Hard days get a few.
  - **Balance** (SIMULATION.md §27, against the simulator's stand-in): the Classic armies play like drafted ones (54% a battle against 52%). The Growing ones are still about 11 points easier than drafted armies (70% against 59%), most of all in battles 1–3 and *The Royal Army*; the next pass should toughen them. Small armies swing hard on a point or a piece: one pawn more or a second Man took battle 1 armies from too easy to much too hard. All five are shown in full, pieces and squares, from the start: placement shows the current one (as with Reveal) and *Today's gauntlet* lists all five on their home rows, with the results so far. (A battle that would start with both kings in check re-places the army from the day's seed, so its squares can differ from the preview.)
- **Steeper than a run:** the battles use the Normal budgets of rounds 2, 4, 6, 8 and 10, on the Growing boards for those rounds (5×5, 6×6, 7×7, 8×8, 9×9), so five battles cover a whole run's arc. You start with King + 3 pawns and the mode's starting gold +12 (16 on Growing), and each battle pays two rounds' income (2 × (5, +2 a win, +1 a draw)), +1 gold, and interest once. Tuned with the simulator (SIMULATION.md §26) so its stand-in wins as often as in a run's rounds 2–10, battle by battle (64% a battle on Growing, against 66%; 3.2 wins a gauntlet, 29% of gauntlets cleared). The first army is the normal one: the first battle is if anything a little easier than round 2 of a run (59% against 51%).
- **Same shops for everyone:** each battle's shop, and each reroll, comes from its own stream of the day's seed, as does each battle's seed, so your choices never change what later battles bring.
- **Every battle is played** (no lives). **Score:** 100 per win, 50 per draw, plus the gold left after the fifth battle (shown as "4/5 won · 12 gold left").
- **Weekday themes** (UTC): Mon *Classic* (8×8 every battle, standard pieces) · Tue *Growing* (the default, fairy pieces on) · Wed *Menagerie* (every opponent a Menagerie army) · Thu *Black* (you play Black) · Fri *Fortress* (every opponent a Fortress) · Sat *Hard* (Hard budgets) · Sun *Play yourself* (you move your own pieces).
- **One attempt a day.** The daily is saved separately from normal runs (its own save, `acc.daily.v1`) and resumed like one; leaving mid-battle counts as a loss, as in a run. No prestige, no extra-life ad. A daily started before midnight can still be finished afterwards, and counts for the day it was started; today's opens once it's done. Its battles count toward the Fun stats and battle achievements, not toward the Single tab's per-mode records or run achievements.
- **Streak:** finishing the day's gauntlet (any score) keeps it; missing a UTC day resets it. Best streak is kept.
- **Reset:** UTC midnight, so everyone's day is the same day (needed for leaderboards later).
- **Menu:** a *Daily challenge* entry under New game, with today's theme and status (the theme / "Resume · battle 3/5" / "Done today · 412 points"; greyed out once done) and the streak (🔥 4).
- **Header:** "Daily 2/5", the theme in place of the lives, and the score so far ("Score 200 + gold").
- **Profile:** a *Daily* tab: current and best streak, days played, best and average score, and the last 14 days.
- **Records:** every finished day (date, theme, score, record, gold left), one per date; streaks are worked out from them, and syncing merges the days from both devices.
- **Later:** more hand-made armies (then a higher pool share); online leaderboards (they need the backend: one score per player per day, checked against the rules version).

## Roadmap
Done: reproducible seeded battles, RULES_VERSION, army snapshots, replays, browser smoke tests in CI, game modes, versioned saves, module structure, formatting/linting in CI, SVG pieces, fairy pieces with shop offers and fusion, Play as, the daily challenge.

Next candidates (not yet decided):
1. **Multiplayer:** balance runs for 4-player matches (see Multiplayer).
2. **Daily challenge follow-ups:** grow the hand-made army pool; online leaderboards.
3. **Auto-chess depth:** synergies between pieces; more fairy pieces and fusion recipes; tuning fairy values with the simulator.
4. **Bigger boards** past 8×8, with a longer move limit.

## Open questions
- Is Normal the right difficulty for real players? Settle by playtesting.
- Should the move limit, draws and the "on points" rule change once small-board draws are addressed?
- Would a per-round army cap (e.g. 3 + round) play better than a flat 16?
