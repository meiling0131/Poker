# Database

Player records live in a Cloudflare D1 database named `verve`. The Worker binding is `DB`. The tables are created by `migrations/0001_players.sql`, `migrations/0002_transactions.sql`, `migrations/0003_day.sql` and `migrations/0004_live_board.sql`.

This is the local database. Creating the remote one needs a Cloudflare API token, so `database_id` in `wrangler.jsonc` is still a local placeholder. The Worker writes `players` and `transactions`: the day's bot rows, the starting cash, buy-ins, cash-outs, stacks taken home, every bet and payout of a hand, the bots' buy-ins at each table, a `games` row for every seat of every hand, and each hand added to that player's `stats` row. `leaderboard` is not written yet.

From the project folder:

```bash
npx wrangler d1 execute verve --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'd1_%' ORDER BY name"
```

Replace the SQL to read any table, for example `SELECT * FROM players`.

## What is recorded

| Play | Rows written | Balance |
| --- | --- | --- |
| Regular, against bots | `games` and `stats` | Changes |
| Online, with friends | `games` and `stats` | Changes |
| Practice | Nothing | Stays as it is |
| The friends-table mode | Nothing | Stays as it is |

A bot has its own `players` row, `is_bot = 1`, and an empty `token_hash`. The id is fixed, so the same bot's hands add up every day. Bots are ranked with everyone else.

A bot's `players` row is permanent: it is never marked or deleted at night. It holds no money. Its `balance` column is unused, it gets no "Money for the day." row, and `/audit` skips it, because a bot plays only through its table copies (below), which buy their chips from the bank. The Worker adds any missing bot rows before the first `/player/get` or `/player/set` of each Eastern day, so running it again changes nothing.

Each bot id is 16 characters, the same length as `poker.uid`: `ubot`, then zeros, then the pinyin of the table name. A name that is already Latin is lowercased. The stored name is 🤖 plus the table name.

Each table gets its own copy of every bot. A copy starts with nothing and buys one minimum buy-in of chips from `ubank` when it has none (奶龙 buys two), as often as it needs. Its chips are written under `<bot id>@<table>`, for example `ubot000000000joe@u3k9x0q2m7c1v8z5:2/5`. A player has one regular table per stake, named by their id and the blinds, so the same bot at that player's 1/2 table is another copy. The table's minimum buy-in is the stake's (200, 500 or 1,000), and so is the copy's. The copy's chips on that table are the chip rows it received minus the ones it sent. Player A beating the bots at A's table leaves the bots at B's table untouched: B's copies still start from their own first buy-in. The bot's own `players.balance` stays at 1,000; the copies have no cash.

The game knows a bot only by this id: its seat, play style, chat lines, profile, buy-in records and stats all use it. The name shown at the table is `players.name`. The Worker reads it before it builds a table, and the browser reads it from `/bots`. Changing a bot's `name` in `players` changes it on the next table. Practice without the server uses the stored names above.

| Table name | id | Stored name |
| --- | --- | --- |
| Joe | `ubot000000000joe` | 🤖 Joe |
| sc | `ubot0000000000sc` | 🤖 sc |
| 老周 | `ubot00000laozhou` | 🤖 老周 |
| 奶龙 | `ubot00000nailong` | 🤖 奶龙 |
| Kmetsch | `ubot00000kmetsch` | 🤖 Kmetsch |
| 阿芳 | `ubot0000000afang` | 🤖 阿芳 |

## Who a player is

There is no sign-in. The browser keeps `poker.uid` and `poker.token` in local storage.

`poker.uid` is 16 characters: `u` plus 15 letters or digits. That string is `players.id`. `poker.token` is 32 letters or digits. The database stores a hash of it in `token_hash`, never the token itself. Clearing site data creates a new player. Each day is a new player: once the new day opens, a browser whose row belongs to the closed day forgets its `poker.uid`, `poker.token` and name, makes a new pair, and asks for a name again. The new row starts at 1,000.

## The day

The day is `America/New_York`. Every `day` column is that calendar date, `YYYY-MM-DD`. `players`, `games`, `stats` and `transactions` hold the open day only. `leaderboard` is what remains.

The day closes over ten minutes. The Worker's scheduled job (`server/day.js`, every minute) does the database steps, and every table wakes on its own Cloudflare alarm at 23:55, 00:00 and 00:05 for the table steps. Practice runs in the browser and is not affected.

| Eastern | Tables | Database | Lobby |
| --- | --- | --- | --- |
| 23:55 | No new hands, regular or online. A table between hands cashes everyone out and sends them to the lobby. A table mid-hand shows only 退出牌桌 and does the same when the hand ends. Buy-ins and cash-outs still work until then. | Every row is marked `is_previous_day = 1`, except bots' `players` rows. `staging` starts with the best balance. Names and new tables are refused. | The balance becomes a 5-minute MM:SS countdown, with 正在清理牌桌, plus `· 今日余额 N` for a named player. The name pill reads "-" and is disabled. 进入游戏, 好友模式 and the stakes are disabled. |
| 00:00 | A hand still running from 23:55 is overtime. Everyone at that table sees 超时牌桌: 该牌桌将在 12:05AM 被强制结束。届时您将会被弃牌，但下注的筹码将被退回。, with 确认. | The new day opens: names and new tables are allowed, and new rows are `0`. | A browser whose row is marked starts a new id and asks for a name. |
| 00:00–00:05 | An overtime hand that ends counts for the closed day. Its players are cashed out and sent to the lobby. A friend room then reopens for the new day. | — | — |
| 00:05 | An overtime hand still running is called off: every chip anyone put in goes back to them, and it writes no `games` or `stats` rows. Everyone is cashed out and sent to the lobby. | — | — |
| 00:06 | — | `/audit`, then the leaderboard from `staging` (昨日最佳, then week, month, all time), then every row marked `1` is deleted, `staging` is cleared, and `day_state.finished_day` is set. | — |

**Which day a row belongs to.** A person's money rows take the mark from that person's `players` row. A hand's chip rows, its `games` and `stats` rows, and a bot's buy-in belong to the day the hand started. They are marked when written during 23:55–24:00, or when that day is older than today. So an overtime hand's rows are marked even though they are written after midnight.

**staging** holds the closing day's top score so far, with everyone tied on it; the tie is broken at 00:06 (see leaderboard). Only people who played at least one hand that day are staged. `label` names a bot's best copy, such as 🤖 Joe · 林 2/5: the bot's name, the table owner's name and the stakes. At 23:55 it starts with the best balance. As each table closes, every player's final balance and every bot copy's chips are compared with it: a higher score clears it, and an equal one joins it. A bot is scored by its best copy that day. A person's score only rises, because a stack going home only adds to the balance.

**day_state** is one row: `closed_day`, the last day closed at 23:55, and `finished_day`, the last day finished. The new day opens once yesterday is closed, so a close the Worker missed runs before anything of the new day can be written. A finish the Worker missed runs on the next tick.

Locally, `wrangler dev` does not run the schedule. Start it with `npx wrangler dev --test-scheduled` and open `http://localhost:8787/__scheduled?cron=*+*+*+*+*` to run one tick.

## players

One row per person for the open day, plus the six permanent bot rows. A person's row is marked at 23:55 and deleted at 00:06.

| Column | Holds |
| --- | --- |
| `id` | Primary key. `poker.uid`, or a fixed bot id such as `ubot00000nailong`. |
| `token_hash` | Hash of `poker.token`. Empty for a bot. |
| `name` | Display name. A bot is stored as 🤖 plus its table name. |
| `is_bot` | `1` for a bot, otherwise `0`. |
| `balance` | Cash that is not on a table. Starts at 1,000. Used by regular and online play. Kept in step with `transactions`, which is the source of truth. Unused for a bot. |
| `table_chips` | The stack in front of a person at their table, for the live 今日最佳. Written when a hand's rows are written and after each buy-in or cash-out; leaving sets it to 0. During a hand it is still the stack from before that hand. |
| `is_previous_day` | `1` once the day has closed (23:55); the row is deleted at 00:06. Always `0` for a bot. |

Buying in moves chips from `balance` onto the table. Leaving the table, for any reason, folds a player who is still in the hand. The stack still in front of them goes back. Chips already in the pot stay there. The number used for ranking is `balance` plus chips still on a table.

## transactions

One row per movement, from `sender_id` to `receiver_id`. Primary key is `id`, a random transaction id. Every column except `remarks` and `completed_at` is required. The sender and receiver are not references to `players`, because either side can be the bank, a hand, or a bot's copy at one table. The bank's id is `ubank`. A hand's pot uses that hand's `game_id`.

`ubank` has an unlimited supply of cash and chips. It has no row in `players`, and its balance is never checked when it sends. Only the player's side of a movement is checked.

`transactions` is the source of truth. `players.balance` is updated in the same batch as each completed row and is checked against `transactions` by `/audit`. The closed day's rows are deleted at 00:06 with everything else (`is_previous_day`, see The day).

| Column | Holds |
| --- | --- |
| `id` | Primary key. A random transaction id, made by the Worker. |
| `ref` | Groups rows that complete or cancel together, such as the two rows of a buy-in. A row on its own uses its own `id`. |
| `sender_id` | Where it comes from. A player id, `ubank`, or a `game_id`. |
| `receiver_id` | Where it goes. A player id, `ubank`, or a `game_id`. |
| `asset` | `0` for chips, `1` for cash. |
| `amount` | Integer amount of that asset. Always greater than 0. |
| `status` | `pending`, `completed`, or `cancelled`. |
| `remarks` | Free text, such as why a row was cancelled. May be empty (`NULL`). |
| `created_at` | When the row was made. Milliseconds since the Unix epoch. |
| `completed_at` | When it completed. Empty while pending, and empty when cancelled. |
| `is_previous_day` | `1` for a row of the day being closed (see The day). Deleted at 00:06. |

Indexes are on `ref`, `sender_id`, `receiver_id`, and `status`.

A hand, a game, and a round are the same thing: preflop through the river, or until everyone but one folds.

| Movement | Rows |
| --- | --- |
| New player | `ubank` to player, cash 1,000, `remarks` "Money for the day.". Written completed, in the same batch as the `players` row. |
| Buy-in | Player to `ubank`, cash. `ubank` to player, chips. Same `ref`. |
| Cash-out | Player to `ubank`, chips. `ubank` to player, cash. Same `ref`. |
| Blind, call, raise, or all-in | Player to `game_id`, chips. `remarks` "Small blind.", "Big blind.", "Call.", "Raise." or "All-in.". |
| Pot paid, or an uncalled bet returned | `game_id` to player, chips. `remarks` "Pot won." or "Uncalled bet returned.". A chop or run-it-twice pays each share as its own row. |
| A bot copy's buy-in | `ubank` to `<bot id>@<table>`, chips, `remarks` "Bot buy-in.". One row; no cash moves. |
| Transfer between players | Giver to taker, chips or cash. Online only. Runs once neither side is still playing the hand. Not built yet. |

The Worker keeps the live hand in memory, and in the room's storage so a restart mid-hand keeps it. When the hand ends, every row for that hand is written completed in one batch, all with the hand's `game_id` as `ref`. A `game_id` is `g` plus 15 letters or digits. After the payout the `game_id`'s chips total zero. A player's chips on a table are their chip rows received minus sent: buy-ins and pots in, bets and cash-outs out.

### The books check

`GET /audit` checks the books against `transactions` and answers with the result as JSON. It runs only when called, and only on the local server, like `/d1`:

1. A person's `players.balance` that differs from their completed cash rows is set to what the rows say. Bots are skipped; their balance holds no money.
2. A `game_id` whose chips do not total zero is reported in the Worker log. It is left as it is.
3. A row still `pending` after 24 hours becomes `cancelled`, with `remarks` "Still pending after a day.". Nothing moved for it, so no balance changes.
4. A `stats` row that differs from the sum of that player's `games` rows (the same `is_previous_day`) is rebuilt from them, ratios included. A player with `games` rows and no `stats` row gets one, and a `stats` row with no `games` behind it is deleted.

```json
{ "fixed": [{ "id": "u3k9x0q2m7c1v8z5", "was": 1234, "now": 1000 }], "pots": [{ "game_id": "gq0c8x1m2v7z3k9a", "left": 20 }], "stale": 1, "stats": ["ubot00000nailong"] }
```

`fixed` lists the balances that were set back, `pots` the hands whose chips do not total zero, `stale` how many pending rows were cancelled, and `stats` the players whose `stats` row was rebuilt or removed. A clean run is `{ "fixed": [], "pots": [], "stale": 0, "stats": [] }`.

### Buy-in and cash-out

1. The browser sends only the amount. The Worker checks it straight away: enough cash for a buy, or enough chips on the table for a cash-out. A cash-out must leave at least the minimum buy-in, unless it takes the whole stack.
2. The Worker writes the rows as `pending`. A player has at most one pending buy or cash-out per hand. A newer one cancels the earlier one.
3. A player who is not playing runs it at once: no hand under way, sitting it out, or already folded. A player still in the hand waits until they fold or the hand ends.
4. When it runs, the Worker checks again. If it still holds, both rows become `completed` and the chips and `balance` change. If not, both become `cancelled` with the reason in `remarks`.
5. A buy writes D1 first, then adds the chips. A cash-out takes the chips off the table first, then writes D1, and puts the chips back if that write fails.

Pending requests run in the order they were made, as each player stops playing. A player who leaves has any pending buy cancelled, and their whole stack is cashed out as two completed rows with `remarks` "Left the table.". Cash paid by an online player still waiting for a seat goes back the same way if they leave or are removed before sitting down. 退出牌桌 does the same: a player still in the hand folds first, then the whole stack is cashed out, on regular tables too.

A refused request is answered with a code and the balance and stack the Worker holds, so the browser shows the real figures: `funds` (not enough cash), `chips` (not enough chips on the table), `amount` (not a multiple of the minimum buy-in), `identity` (no player row for this browser), `left`, `offline` (no database), `server` (the write failed).

Practice tables run in the browser with a pretend 1,000 and write nothing.

## games

One row per player per hand. A nine-player hand is nine rows. The next hand is nine new rows. Primary key is `game_id` plus `player_id`. `player_id` references `players.id`. The index `games_player` is on `player_id`.

`mode` is `regular` or `online`. Every count column is `0` or `1` for that one hand. `is_previous_day` is `1` for a hand of the day being closed (see The day).

The Worker writes a hand's rows when the hand ends, in the same batch as that hand's chip rows, so a hand is in both tables or in neither. A row is written for every seat dealt in, including a player who folded or left during the hand. A bot's row uses its bot id, not the table copy, so its hands add up across tables. A row whose player has no `players` row is skipped; the rest of the batch still goes in. A hand cut short before it ends (a room restarting mid-hand without its cards) writes its chip rows and no `games` rows. Practice writes nothing.

| Column | `1` means |
| --- | --- |
| `vpip` | They put in money before the flop, beyond the blinds. |
| `pfr` | They raised before the flop. |
| `ats` | They raised a steal: cutoff, button, or small blind, and it was folded to them. |
| `ats_opp` | That steal spot was offered: in one of those seats, with nobody before them having called or raised. The cutoff is the seat before the button, unless it is a blind. Heads-up the button is the small blind. |
| `3bet` | They re-raised an opening raise before the flop. |
| `saw_flop` | They saw the flop. |
| `wtsd` | They were still in at showdown. |
| `wsd` | They won a pot at showdown. A chop counts. |
| `wwsf` | They won a pot after seeing the flop. A fold win on the flop or later counts. |

`3bet` is quoted in SQL because the name starts with a digit. The same is true of `3bet_pct`.

| Column | Holds |
| --- | --- |
| `won` | `1` when `won_pot` is not `[]`. A chop sets this too. |
| `won_chop` | `1` when this player shared any pot in the hand. |
| `won_amount` | This player's own chips from the pots in `won_pot`. A chop stores their share. |
| `won_pot` | A JSON array of integers. `[]` when they won nothing. `0` is the main pot, `1` is the first side pot, then `2`, and so on. |
| `won_hand` | The five winning cards. Empty when they did not win. |

Chips returned because nobody called are left out of `won_amount` and `won_pot`.

A hand has at most one fewer pot than the number of players. Nine players can produce eight pots, numbered `0` through `7`. The best hand wins every pot that player is eligible for. A shorter all-in is not eligible for the side pots above their stack, so a worse hand can win those.

On run-it-twice, winning one half of a pot still puts that pot's index in `won_pot`. `won_hand` keeps the five cards from the run that paid more. Equal shares keep the first run.

Cards are comma-separated. Rank is uppercase, suit is lowercase, and ten is `T`. A fold win, with nothing shown, is `NA,NA,NA,NA,NA`.

```text
Ah,Kd,Ts,7c,2d
Qs,Qh,Jd,9c,3s
NA,NA,NA,NA,NA
```

One hand, three of its rows. Mei's queens are the best hand, so she wins pot `0`. She was all-in for less, so she cannot win the side pots. Lin wins pots `1` and `2` with ace-high. Yan won nothing.

| Player | won_pot | won_amount | won_hand | won | won_chop |
| --- | --- | --- | --- | --- | --- |
| Mei | `[0]` | 500 | `Qs,Qh,Jd,9c,3s` | 1 | 0 |
| Lin | `[1, 2]` | 180 | `Ah,Kd,Ts,7c,2d` | 1 | 0 |
| Yan | `[]` | 0 | | 0 | 0 |

A chop gives both players the same index. Each stores their own share, and both have `won_chop = 1`. Several pots in one hand still count as one hand won.

## stats

One row per player for the open day, summed from that player's `games` rows. Primary key is `player_id` plus `is_previous_day`, and `player_id` references `players.id`. Between 00:00 and 00:06 a bot can have two rows: the closed day's (`1`) and the new day's (`0`). The closed day's rows are deleted at 00:06.

Each hand is added to the row in the same batch that writes its `games` rows, so `stats` always matches `games`. The first hand of the day creates the row. A hand written twice is not added twice. `games` is the source: `/audit` rebuilds any row that differs from it. `day` is the Eastern date the row's hands belong to: the day each hand started (see The day).

The lobby's 查看数据 reads a player's own row through `POST /player/stats` (their `poker.uid` and `poker.token`) and shows the six ratios as percentages. Tapping a seat at a regular or online table shows the same popup for that player, read through `GET /stats?id=<player id>`, which anyone may call. A bot's row there adds up all of its tables today. A practice table has no database, so its cards show that session's counts, kept in the browser.

| Column | Holds |
| --- | --- |
| `hands` | Number of `games` rows. |
| `hands_won` | Rows with `won = 1`. Several pots in one hand still add 1. |
| `biggest_win_amount` | The largest `won_amount` from a single hand. A fold win can be it. |
| `biggest_win_hand` | `won_hand` from that same hand. |
| `vpip` through `wwsf` | Sums of the count columns, including `ats_opp` and `saw_flop`. |

The percent columns are recomputed with every hand, as a ratio from 0 to 1 (`0.25` is 25%). A ratio whose denominator is 0 stays empty (`NULL`).

| Column | Ratio |
| --- | --- |
| `vpip_pct` | `vpip / hands` |
| `pfr_pct` | `pfr / hands` |
| `ats_pct` | `ats / ats_opp` |
| `3bet_pct` | `3bet / hands` |
| `wsd_pct` | `wsd / wtsd` |
| `wwsf_pct` | `wwsf / saw_flop` |

## leaderboard

Saved bests: one row per `period`, which is `yesterday`, `week`, `month`, or `all_time`. Primary key is `period` plus `player_id`.

The lobby banner reads `GET /leaderboard`, when the lobby opens and every 30 seconds after:

| Slot | From |
| --- | --- |
| 今日最佳 | Live, never saved. Today's people who have played at least one hand, ranked by `balance + table_chips`. Bots are left out. A full tie is settled the same way all day, so the slot does not flicker. |
| 昨日最佳 | `yesterday`: the closed day's winner, saved at 00:06. |
| 本周最佳, 本月最佳, 历史最佳 | `week`, `month`, `all_time`, as saved. They are never compared with 今日最佳. |

Each slot shows a name and money only.

Players are ranked by money (`balance`). A tie on money goes to the bigger `biggest_win_amount`, then to the higher share of hands won (`hands_won / hands`; a player with no hands has 0). If all three are equal, one is chosen at random. A player who never played can only win a tie by chance, and only against others who never played.

`period = yesterday` is the best of the day that just closed. The `day` column is the date it was won. Only people who played at least one hand are ranked, and a bot is ranked by its best table copy.

Each saved row copies `name`, `is_bot`, the compared balance, and the same play columns as `stats`. `leaderboard.player_id` does not reference `players`, because these rows stay after `players` is wiped.

At 00:06 America/New_York, from `staging` (see The day):

1. The day's best is the top of `staging`, ranked as above when several are tied. By then every table has closed, so everyone's chips are back in their balance, and a bot is scored by its best table copy.
2. Replace `period = yesterday` with the day's best, with their closed-day `stats` row. A bot is entered as its best copy, under the copy's label.
3. The day's best replaces the holder of `week`, `month`, or `all_time` when they rank above them, by the same order. Otherwise the holder stays.
4. When the new day is a Monday, clear `week` after that comparison. When it is the 1st, clear `month`. `all_time` stays until a higher score replaces it.
5. Delete the closed day's rows from `games`, `stats`, `transactions` and `players`.

Clearing `week` on Monday means the new week starts empty. Sunday is included in the comparison before the clear. The same is true of the month on the 1st. Past weeks and past months are not kept. `all_time` is the row that stays until it is beaten.

D1 enforces foreign keys. That is why a `games` row is only written when its player has a `players` row, and why the midnight wipe deletes `games` and `stats` before `players`.
