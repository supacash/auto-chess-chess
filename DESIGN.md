# Auto Chess² — Design Document

The source of truth for how the game works. Update it whenever a rule or tuning decision changes.
Balance numbers come from the simulator; see [SIMULATION.md](SIMULATION.md) for the data behind them.

## Pitch
Draft and place a chess army, then watch an engine play the round for both sides. Survive as long as you can against stronger and stronger AI armies, on a board that grows as the run goes on.

## Scope today
- Single player against AI-drafted armies.
- Mobile-first web app with touch drag-and-drop, live on GitHub Pages. It can be wrapped as an app later (e.g. Capacitor).
- No accounts or server. The run in progress and best scores live in the browser (localStorage).

## Core loop
1. **Shop.** Spend gold on the round's shop offers and rerolls, and merge pieces into stronger ones. You see the opponent's style and piece list (and, with Reveal on, where its pieces are).
2. **Place.** Arrange your army in your home rows. Extras wait on the bench.
3. **Battle.** **Auto fight**: the engine plays both sides; you watch, with an eval bar and 1×/2×/4×/Skip playback. In a **Play yourself** run (a New game option) every battle is **Play it** instead: you move your own pieces and the engine plays the opponent exactly as in auto battles.
4. **Result.** Win, lose or draw. Gold is paid out; a loss costs a life.
5. Repeat until you're out of lives.

## Runs
- **3 lives.** A loss costs one; a draw costs none. The score is rounds won.
- **25 rounds.** Getting through round 25 with a life left wins the run: a victory card (record, and the end-of-run summary) and a "completed" count on the Profile. By then both armies are a full board of queens, so the run ends on a high instead of fading out. The header shows "Round 12/25". 
- **End-of-run summary:** the victory and game-over cards chart your army's points against your opponents' for each round (losses marked), with the run's best win streak and biggest army.
- **First-run tips:** one short tip at a time above the opponent line on the shop screen (how to play, a set ready to merge, affinity pawns, interest and the lock, the opponent list), each dismissed for good with ×. Kept per device.
- **Prestige:** the victory card offers *Prestige ★N*: start over at round 1 with the starting army and lives, one prestige level higher. Opponents get 0.25 more points per round per level, and the player picks one of three perks to keep for good (stackable ones can come up again): War chest (+2 starting gold, stacks), Squire (start with a Knight, stacks), Royal favour (queens and queen-pawns from round 4), Haggler (first reroll each round free), Second wind (+1 life), Tithe (+1 gold every round). The header shows ★N; the Profile shows the highest prestige. Single player only.
- **Main menu** (the landing screen, and *Menu* in the header): *Resume game* (shown while a run or a Play it game is in progress, with its round and lives), *New game*, *Multiplayer*, and *Review your last battle*. A battle interrupted by a reload is reported here.
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
| Rook | 5 | 3 rook-pawns (2 gold each) | No |
| Queen | 9 | 3 queen-pawns (3 gold each), 2 Rooks, 3 Knights or 3 Bishops | No |
| King | — | Free, always owned, can't be sold |

- **Gold upgrades:** only a plain pawn (no affinity) → Knight/Bishop, for 3 gold. Rooks and Queens come only from merging or the shop; spare gold goes into rerolls.
- **Affinity pawns:** pawns bought for a piece (knight-, bishop-, rook- or queen-pawn), shown with a small badge of that piece. They fight as ordinary pawns (and count toward the 8-pawn limit) until three with the same affinity are merged into the piece. Rook-pawns cost 2 gold (6 for a 5-point rook: rooks proved strong for their value); queen-pawns 3 gold and only from round 6. They sell for their price − 1. The piece panel and the offer show how many of the set you have ("you have 2/3").
- **Start:** King + 3 pawns, plus 4 gold (Growing) or 3 gold (Classic).
- **Income:** 5 gold per round, +2 for a win, +1 for a draw, plus **interest**: +1 gold per 10 unspent (up to +3), counted on the gold saved before the battle. The shop shows the interest due ("23g +2 interest").
- **Shop lock:** 🔒 next to Reroll keeps the current offers (whatever's left of them) into the next round; it unlocks after that round, or when you reroll.
- **Selling** refunds value minus 1 (minimum 0).
- **Army size:** only pieces on the board count: at most two per file, a chess side's worth (16 on 8×8; on the smaller boards that's every home square: 10 / 12 / 14), so it grows with the board in Growing mode. AI armies follow the same limit. No limit on the mix of pieces.
- **Bench:** up to 8 pieces wait off the board, to mix and match. Bought pieces arrive there, so buying needs a free bench slot. A bench piece can go onto a full board by swapping with a placed one.
- Pieces lost in battle come back for the next round.
- **Shop offers:** 4 random offers each round, bought onto the bench: mostly affinity pawns, with finished pieces (priced at their value) rare. Offers cost at most 2 + 2×round (Rooks from round 2; Queens and queen-pawns from round 6). Plain pawns aren't offered. Reroll: 1 gold. Fusion pieces are never offered except the Stackman (rare, 8 gold, fairy only), nor is the Grasshopper (players didn't find it worth buying; it stays in the rules for old saves and replays). With fairy pieces off, offers are standard pieces only.
- **Piece info:** tapping any piece (yours, a shop offer, or the opponent's in its list or on the revealed board) shows its value and how it moves.
- **No single-pawn purchases:** pawns come from shop offers (Pawn and Berolina pawn are the most common offers).
- **Merging** (free, every mode; one tap, but not automatic: completing a set doesn't merge it by itself):
  - Three affinity pawns with the same affinity → that piece.
  - Three plain pawns (the starting pawns, or three Berolina pawns) → Knight or Bishop.
  - Two Rooks → Queen.
  - Three Knights → Queen, or three Bishops → Queen (no mixing knights and bishops).
  - Three Men → Stackman (fairy): three 3-point Men (6 gold) for an 8-point piece that frees two board squares.
  - Three Queens → **Heir** (fairy, one per army, can't be sold): a second king with its own icon (the king without its cross, smaller), benched (a queen's square may be on the front row, and like the King it can't stand there). While a side has its King and its Heir neither is royal: either can be captured (both attacked at once isn't mate either), and the last one left is a real king that can be checkmated. The battle screen announces the capture ("Their King was captured! Their Heir takes the crown.") (Fairy-Stockfish's Spartan-chess rules, on each board's two-kings variant, used only when an Heir is on the board; every other battle is unchanged). The engine only pairs kings of one type, so it sees the Heir as a second king; our FENs write it 'J' and the game follows its square through the moves. 27 points for checkmate insurance and two free squares: a late-game luxury, never sold. Bots don't make Heirs (yet).
  - Three of a kind merge in one tap: the selected piece shows *Merge 3 → Rook* (three plain pawns show a button each for Knight and Bishop), using it and two more of the same kind, benched ones first. The result takes the square of the first of them on the board. Two-piece merges are buttons on the selected piece, which becomes the result where it stands.
- **Fusion** (fairy pieces on): free, like merging. Knight + Bishop → Archbishop, Knight + Rook → Chancellor, Knight + Queen → Amazon, Knight + Man → Centaur, Rook + Ferz → Dragon King, Bishop + Wazir → Dragon Horse, Knight + Camel → Wildebeest, Cannon + Bishop → Siege Cannon, Ferz + Wazir → Man (two 1-gold pieces make a 3-point piece: the reason to buy them over pawns, besides standing on the back row and not counting toward the 8-pawn limit). The selected piece becomes the compound where it stands; the partner is used up. Fused pieces sell for value − 2 (the same as selling both parts).

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
| Dragon King | 7 | Rook + one diagonal step (fusion: Rook + Ferz) |
| Dragon Horse | 5 | Bishop + one straight step (fusion: Bishop + Wazir) |
| Wildebeest | 5 | Knight and Camel jumps (fusion: Knight + Camel) |
| Siege Cannon | 6 | Moves like a queen; captures by jumping exactly one piece (fusion: Cannon + Bishop) |
| Stackman | 8 | Jumps to any square up to two away, over anything in between (merge: three Men; also sold, rarely, for 8 gold) |

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
- The engine supports boards up to 12×10. Measurements for 10×10 are in [docs/SPIKE-FAIRY.md](docs/SPIKE-FAIRY.md); bigger boards would need a longer move limit (two-thirds of 10×10 battles hit 90 plies).

## Placement rules
- You own the bottom home rows; the AI owns the same number at the top (mirrored).
- The king can't go on the front home row; pawns can't go on the back row.
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
- **Engine:** Fairy-Stockfish (WASM) plays both sides with identical settings: depth 8, MultiPV 3, picking randomly among moves within ~50 centipawns of the best for variety. Skill is in drafting and placement, not a better engine.
- **Budget per round:** difficulty × round (rounded), ±1 random, −1 in round 1, and +1 every round in Growing mode (matching its extra starting gold so both modes have the same balance). −2% when the player is Black. Never more than a full board of queens around the king (15 queens, 135 points, on 8×8).
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
- **Engine safety net:** a search over 10 seconds plays a random legal move instead and restarts the engine.

## Achievements

Easy, fun goals (src/game/achievements.ts), unlocked once and kept in the records (they sync with them, from the earliest unlock). A notice slides in at the top when one unlocks; the Profile's *Awards* tab lists them by group (unlocked first), with progress for the collections. "On the board" counts placed pieces of a family, fusions included: knights (N, Archbishop, Chancellor, Amazon, Centaur, Wildebeest), rooks (R, Chancellor, Dragon King), queens (Q, Amazon), bishops (B, Archbishop, Dragon Horse, Siege Cannon), camels (Camel, Wildebeest), men (Man, Centaur, Stackman), pawns (pawns of any kind, Berolina pawns).

- **Armies and merges:** 15 of a family on the board (Call the Cavalry!, The Wall, Solomon, Silk Road, Oops all pawns, Sausage Party, Vatican); It's not a boulder… (three rook-pawns into a Rook), I'm the Stackman, Finally a son (an Heir), The infamous second son (secret until a perk allows two Heirs); Dragons now? (Dragon King and Dragon Horse in one army); Barnyard (Camel, Wildebeest and Centaur); Absolute Unit (150+ points on the board); All Hands on Deck (every home square filled: only the small boards' army cap allows it).
- **Battles** (checked from the battle's moves, for the player's side): Holy Diver (a bishop-family piece takes in a corner from the opposite corner), David and Goliath (beat an army worth twice yours), Comeback Kid (win after being 10+ points behind), Pawn Storm (mate with a pawn), Long Live the King (win after losing the King), Royal Wedding (promote), Photo Finish (win on points by one).
- **Runs:** The Undefeated (win a run without losing a battle), Prestigious (prestige ★3), Do It Yourself (win a Play it battle), Hoarder (50 gold), Shopaholic (10 rerolls in a round).
- **Multiplayer:** Last One Standing (win a match), Untouchable (win without losing a battle), Pool Shark (buy the last one in the pool), Kingmaker (finish 2nd with the winner on 1 HP), Specter (watch 5 battles after being knocked out).
- **Collections** (career, kept in the records): Zoo Keeper (field every fairy piece the shop sells: Berolina pawn, Ferz, Wazir, Man, Camel, Cannon, Stackman), Fusion Chef (make every fusion).

The Profile's Fun tab shows the most-bought piece (not counting pawns, Ferzes and Wazirs, which everyone buys most) and the collections' progress.

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

## Multiplayer
Live, TFT-style matches for 4 players. Everything that decides a match is deterministic from the match seed (pairings, bot armies, battles), so each client computes the results itself: there's no game server.
- **Health:** everyone starts at 30 HP. Losing a battle costs the round number plus 1 per 5 points of material the winner has left; a draw costs nothing. At 0 HP you're out; lower HP places worse among players knocked out in the same round. Last one standing wins (places 1st–4th).
- **Rounds:** everyone shops and places at the same time for 45 seconds (20 in Blitz), ending early when all are Ready. Your next opponent is known as soon as the shop opens (pairings come from the match seed), and you see the pieces they've placed (types only, updated as they shop); where they stand stays hidden until the battle starts (army positions are protected by the Firestore rules). If your king is still on the bench when the timer ends, it's placed for you.
- **Pairings and sides:** random each round from the match seed, including who is White, but nobody meets last round's opponent again if any other pairing avoids it (with two players left it can't be avoided; meeting a copy's owner counts as meeting them); White moves first. Your side is announced before the battle ("You're Black against …"), and your pieces are drawn in your colour at the bottom of the board. With an odd number left, the last player fights a copy of another player's army; only the odd player can take damage or extend a streak in that battle.
- **Income:** base 5, +1 for a win (+1 for a draw), plus a streak bonus for win or loss streaks: 2 in a row +1, 3 +2, 4 or more +3. Draws neither extend nor break a streak and pay no streak bonus. Streaks show in the health list (🔥 wins, ❄️ losses). +1 gold after a round played as Black. Interest and the shop lock work as in single player.
- **Battles:** auto only (no Play it in multiplayer). You watch your own. Online, each phone computes only its own battle and reports the result to the room; bot-vs-bot battles are computed by the first seated person's phone on a second engine, mostly during the shop (their armies are known from the seed). The round is applied from the reported results once everyone has watched theirs (or after 2 minutes, unreported battles counting as draws), so every phone gets the same health list; a phone still playing when the room moves on stops and catches up. Offline, the other battles run on the second engine alongside yours. Engines load when a match starts.
- **Rules:** Classic 8×8 with standard pieces by default. Whoever creates a room (or plays vs bots) can pick **Growing board** (5×5 up to 9×9, as in single player: King + 3 pawns and 4 gold, bots get its +1 point a round) and **Fairy pieces** (fairy offers, fusion and fairy bot styles). The lobby shows the room's rules. Quick play is always Classic with standard pieces (rooms in other modes are never joined by it). Economy otherwise as in single player (offers, upgrades, fusion).
- **Shared pool:** everyone in a match buys affinity pawns, Ferzes and Wazirs from one supply: 12 knight-pawns, 12 bishop-pawns, 9 rook-pawns, 6 queen-pawns, 10 Ferzes, 10 Wazirs (fairy rooms). A pawn someone holds (board or bench) is out of the pool; merging it into its piece or selling it puts it back, and so does being knocked out. Offers show how many are left ("7 left", "sold out") and scarce pawns show up less often (chance × left/size). Bots each hold 2 of one kind per round (from the seed). Online, each person's holdings are shared in the room; two people buying the last copy at the same moment can both get it (friendly rooms, no transaction). Merging or fusing works the same for all of them: a Ferz and Wazir fused into a Man are back in the pool. Finished and other fairy pieces aren't pooled.
- **Perks:** the shops of rounds 3, 6 and 9 open (matches usually end by rounds 8–11) with a pick of one of three perks (seeded per player, so everyone's choices are fixed): War chest (+5 gold now), Squire (a Knight now), Tithe (+1 gold a round), Haggler (first reroll each round free), Royal favour (queens and queen-pawns from now on), Bulwark (−2 HP lost per loss, at least 1), Sharp edge (+2 damage when you win; not for a copy), Second wind (+8 HP at the end of that round, up to 30). One-off perks (Haggler, Royal favour) aren't offered twice, and Second wind isn't offered at full health (another perk takes its place). The shop timer keeps running; time's up or Ready takes the first choice. Bots pick their first choice, never Second wind (its use depends on their health back then, which a rejoined client doesn't know). Picks are shared in the room (health is worked out from them on every client) and shown as icons in the health list.
- **Scouting:** tap anyone in the health list for their health by round, perks, pawns from the pool, what they're placing now (people's shared preview, bots' army; types only) and last round's army on its home rows.
- **Watching:** the round card has a *Watch* button for each other battle of the round. This device replays it from the locked armies and the battle seed, so it goes exactly as it did wherever it was computed; then back to the card. Online, starting to watch counts the player as finished with the round (nobody waits on them), and if the room moves on meanwhile the replay stops and the card offers the next round. Knocked out while others play on, the final card offers *Keep watching the match*: online it follows the room (each round's results as they come, a Watch button per battle); offline this device plays the bots' remaining rounds. Records count the match when the player is knocked out.
- **Bots:** AI-drafted armies at the single-player Normal budget, the same on every client.
- **Offline:** *Multiplayer* → *Play vs 3 bots* (optional Blitz).
- **Online rooms** (Firebase project `auto-chess-chess`, anonymous sign-in): *Create room* gives a 4-letter code to share; others *Join room* with it; the host starts whenever they like and empty seats become bots. Players have generated names ("Golden Knight 19"). Ready uploads your army; the shop closes when everyone still in is ready or the deadline (server time) passes; the round ends once everyone has watched their battle (or after 2 minutes). Someone who leaves keeps their last army (or a lone king) and plays on until knocked out. *Leave* (two taps) exits a match. On the Profile a match counts as online only if another person played in it; a room that filled up with bots counts as a match against bots.
- **Rejoining:** each device saves its side of an online match (room, shop, gold, streak). After a reload, or after leaving, the menu offers *Rejoin match* while the match is on and the player is still in it (saves older than 6 hours aren't offered). A player who missed rounds gets base income for each one (their last army fought them) and their streak starts over; one who rejoins mid-battle plays their battle, or waits if they had already finished it.
- **Quick play:** Classic or Classic Blitz for now (fairy pieces and growing boards later). It takes a seat in an open quick play room in that mode, fullest first, or makes one. A quick room has no code to share and no host button: it starts by itself once 4 people are in, or 30 seconds after the last person joined, with bots in the empty seats (anyone in the room may start it when it's due). Rooms nobody joined in the last 40 seconds aren't joined (they've started, or were abandoned). If two people make rooms at the same moment, someone still alone in the newer room moves to the older one.
- **Not yet:** quick play for the other modes.

## Roadmap
Done: reproducible seeded battles, RULES_VERSION, army snapshots, replays, browser smoke tests in CI, game modes, versioned saves, module structure, formatting/linting in CI, SVG pieces, fairy pieces with shop offers and fusion, Play as.

Next candidates (not yet decided):
1. **Multiplayer:** quick play for more modes, and balance runs for 4-player matches (see Multiplayer).
2. **Daily challenges:** one seed for everyone (battles are already seeded and reproducible).
3. **Auto-chess depth:** synergies between pieces; more fairy pieces and fusion recipes; tuning fairy values with the simulator.
4. **Bigger boards** past 8×8, with a longer move limit.

## Open questions
- Is Normal the right difficulty for real players? Settle by playtesting.
- Should the move limit, draws and the "on points" rule change once small-board draws are addressed?
- Would a per-round army cap (e.g. 3 + round) play better than a flat 16?
