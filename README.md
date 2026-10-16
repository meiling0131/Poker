<p align="center">
  <img src="docs/pocket-aces.svg" width="300" alt="A pair of aces: the ace of spades and the ace of hearts, with two poker chips">
</p>

<h1 align="center">Verve Poker</h1>

<p align="center">
  No-limit Texas Hold'em in your browser, made for phones first. Every player gets 1,000 a day,<br>
  plays six bots with their own styles, and competes for the day's best on a shared leaderboard.
</p>

---

## Where this comes from

This project is based on **[meiling0131/Poker](https://github.com/meiling0131/Poker)**, forked at commit `810bd62`. The original had the game engine, the six bots, the chip-true table, practice play and private rooms with friends. A lot has changed since. The main shift is that money is now real within the game: balances, every bet and every payout are kept in a database on the server, and the day resets at midnight with a leaderboard. The sections below list what changed, what was added, what was removed, and what is still unfinished.

### Changed

- **Regular play runs on the server.** In the original, a game against bots was dealt in your browser. Now each player gets a private table on the Verve server (a Cloudflare Durable Object), which deals, runs the bots and records everything. Practice still runs in the browser.
- **Money.** The original had a daily allowance of 1,000 kept in the browser. Now each player has a real balance in the database: 1,000 at the start of each day (US Eastern), checked by the server on every buy-in and cash-out.
- **Stakes.** The blind fields are replaced by three tables: 1/2 with a 200 minimum buy-in, 2/5 with 500, and 5/10 with 1,000. A stake you can't afford is greyed out.
- **Buying in and cashing out.** The fixed 买一手 +200 / 退一手 −200 buttons are replaced by one bank panel with a slider in steps of the minimum buy-in. A request runs at once if you aren't in a hand, and otherwise as soon as you fold or the hand ends.
- **Betting.** A 2×2 grid: Call and Raise pick the chips, Bet sends them, Fold folds. Raise opens a slider with Min., ½ pot, Pot and All in marks. Pre-actions (Check/Fold, Check, Call Any) are buttons.
- **Chips.** Buy-ins arrive as 25s, and stacks are only rearranged when 自动整理筹码 (auto-tidy) is on.
- **End of a hand.** A regular or practice table waits for 继续游戏 (next hand) or 退出牌桌 (leave). The result stays in the middle of the table until the next hand. Leaving folds you if you're still in the hand and cashes your stack out to your balance.
- **Bots.** Each bot has a fixed id, and its displayed name comes from the database. Every table has its own copy of each bot, which buys its chips from the bank.
- **The table.** The dealer, small blind and big blind are marked with D, S and B chips beside the names. A 45-second ring counts down each turn, and your hand type is shown as you play. Cards are dealt one at a time, and the bots wait until every card has landed.
- **The player card.** Tapping a seat opens the same stats popup as the lobby's 查看数据 (view stats).
- **The lobby.** A casino-green background, your balance in large type, a name pill, a scrolling leaderboard, the stake tiles and flat buttons.
- **Sound.** The generated beep is replaced by sound files for your turn, the run-it-twice choice, every action, each card dealt, each board card, the payout and completed bank transactions.
- **Deploying.** The GitHub Actions deploy and the GitHub Pages copy are gone. You deploy with `npm run deploy` from your machine, or by linking the repo in Cloudflare's dashboard (see [DEPLOY.md](DEPLOY.md)).

### Added

- **Players without a sign-in.** Your browser keeps a random id and a secret token; the server stores only a hash of the token. You leave a name to play, can change it once, and can clear the account in 设置 (settings).
- **A database (Cloudflare D1).** It has these tables:
  - `players`: the day's players and balances.
  - `transactions`: a ledger of every buy-in, cash-out, bet and payout, which is the source of truth for every balance.
  - `games`: one row per player per hand.
  - `stats`: each player's totals for the day, with VPIP, PFR, steal, 3-bet, WSD and WWSF ratios.
  - `leaderboard`: the saved bests.

  See [DATABASE.md](DATABASE.md).
- **The leaderboard.** 今日最佳 (today's best) is live: balance plus chips at the table, among players who have played a hand today. 昨日最佳, 本周最佳, 本月最佳 and 历史最佳 (yesterday, this week, this month, all time) are saved at midnight. Ties go to more money, then the bigger biggest win, then the higher share of hands won, then chance.
- **查看数据.** Your stats for the day: hands, hands won, your biggest win with its five cards and hand type, and seven ratios, each with an explanation.
- **The day's close.**
  - **23:55 Eastern:** no new hands, and the tables send everyone back to the lobby.
  - **00:00:** a hand still running is overtime and gets a warning.
  - **00:05:** an overtime hand still running is called off and every bet is refunded.
  - **00:06:** the leaderboard is saved and the old day's data is deleted.

  Each new day, everyone starts again at 1,000.
- **设置 (settings).** 游戏音效 turns all sounds on or off. 机器人速度 (bot speed) offers 正常, 较快 and 更快.
- **Developer tools.** `/d1` is a page for browsing the local database. `/audit` checks every balance against the ledger. Both only work on your own machine.
- **Tests.** Tests for the server, the money, the database writes, the day's close, the leaderboard and the sounds: 82 in all.

### Removed

- **The floors.** The second-floor lounge is gone; every table uses the first-floor look.
- **Custom blinds.** Replaced by the three stakes.
- **The browser-side daily allowance.** Replaced by the server balance.
- **Seat swapping (和 TA 换座位).** It let players skip the blinds by changing seats.
- **The host's table reset.** It also cleared every player's chips.
- **Action confirmations.** Including the one for all-in.
- **The 整理 (tidy) button.** Replaced by the 自动整理筹码 switch.
- **The table's top-bar extras.** The 主页 (home) button and the settings menu are gone, and hand hints are now always on.
- **The win/loss banner.** The 这把 +N / −N line and the bust message are gone.
- **The friends room list in the lobby.** It showed the rooms people were in.
- **The bot avatar and personality line.** They used to appear on the player card.
- **Automated deploys.** The GitHub Actions workflow and GitHub Pages are gone.

### Still in progress

- **Friends mode.** The 好友模式 button in the lobby doesn't do anything yet. The online rooms on the server were updated for real balances and the day's close, but haven't been tried end to end. Transfers between players aren't built.
- **The 记录 (records) page.** It's disabled. Stats are shown through the 查看数据 popup for now.
- **关于 (about).** The button is a placeholder.
- **Deployment.** This version hasn't been deployed anywhere. The Cloudflare database hasn't been created (`database_id` in `wrangler.jsonc` is a placeholder). [DEPLOY.md](DEPLOY.md) has the steps.
- **Known gaps:**
  - During a hand, 今日最佳 counts the stack a player had before that hand.
  - In a rare restart, a hand's chip rows could be written twice. The fix is planned.
  - The hand log still says 买一手 / 退一手 for buy-ins and cash-outs of any size.
  - The sound files aren't yet levelled to the same loudness.

## How to play

1. Open the game (your deployed Worker's address, or http://127.0.0.1:8787 when running it locally) and tap the name pill to leave a name. Your balance for the day is 1,000.
2. Pick a stake and tap **进入游戏** (enter game). The bank panel opens: slide to the amount and tap **买入** (buy in). **练习模式** (practice) gives pretend chips that are never recorded.
3. On your turn, tap chips or use **Call** / **Raise** to pick an amount, then **Bet** to send it. **Fold** folds.
4. After a hand, tap **继续游戏** for the next one, or **退出牌桌** to leave. Leaving takes your chips back to your balance.
5. Tap your name in the lobby for **查看数据**, or tap a seat at the table to see that player's stats.

The day closes at midnight US Eastern. The next day you leave a name again and start at 1,000.

## For developers

A single page with plain ES modules and no build step. The page, the game server and the database are one Cloudflare Worker.

### Layout

```
index.html          page skeleton and the import map (written by tools/stamp.js)
css/                styles, loaded in numeric order; later files override earlier ones
js/
  main.js           entry: identity, the player row, restore the last mode
  config.js         constants: bots, timings (DEAL_STEP …), the server address
  settings.js       stakes, normal/practice
  state.js          shared runtime state, written through setX(); views register redraws on `view`
  player.js         the player row, stats, bot names and the leaderboard from the server
  cards.js          cards, shuffling, hand ranking, equity        ← pure logic, tested
  chips.js          chips: exact payment, change, tidying         ← pure logic, tested
  pots.js           main and side pots                            ← pure logic, tested
  table.js          queries and small operations on the table state
  engine.js         the dealer: dealing, betting rounds, all-in runouts, showdown, calling off a hand
  bots.js           bot strategy
  stats.js          per-player counts, and the games rows a hand writes
  talk.js           bot lines, emoji
  fx.js             sounds, confetti, keeping the screen awake
  online.js         seat docs and following the table
  net.js            server client: a WebSocket behind a doc/onSnapshot interface
  actions.js        your actions, the bank panel, auto-tidy
  modes.js          lobby, practice, regular and online; server messages
  ui/               views (lobby, table, your seat, records) and event handlers
                    anim.js: animations and the sounds that go with them
server/             the Verve server (Cloudflare Worker + Durable Objects)
  worker.js         routes (below) and the every-minute schedule
  room.js           one table: runs js/engine.js, money requests, the day's close (alarms)
  bank.js           cash and chip rows in transactions
  games.js          a hand's games and stats rows
  day.js            the day's close, staging, the leaderboard
  audit.js          the books check (/audit)
  player.js         player rows: names, token check
  bots.js           the bots' permanent rows
  lobby.js          the friends room list
  d1view.js         the /d1 page
migrations/         the database schema, applied in order
sounds/             sound effects (copied into the build)
tests/              node:test tests
tools/              stamp.js (module versions), simulate.js and benchmark.js (bots), headless.js
DATABASE.md         every table and rule of the database
DEPLOY.md           deploying to Cloudflare
```

### Run it locally

```
npm install
npm run dev          # builds dist/ and runs the Worker locally: http://127.0.0.1:8787
npm run serve        # the page alone (practice only): http://localhost:8000
```

`npm run dev` uses a local database. Apply the migrations to it once with `npx wrangler d1 migrations apply verve --local`. Put `LOCAL_DEV=1` in a `.dev.vars` file to turn on `/d1` and `/audit`. To run the midnight job by hand, open `http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*`.

### After changing code

```
npm run stamp        # refresh the version numbers in index.html (after any js or css change)
npm run check        # eslint + tests; also fails if the import map is stale
```

To deploy, see [DEPLOY.md](DEPLOY.md).

### Server routes

| Route | What |
| --- | --- |
| `/solo?uid&token&sb&bb` (WebSocket) | your regular table for that stake |
| `/room/<code>` (WebSocket) | a friends room |
| `POST /player/get`, `/player/set`, `/player/stats` | your row, your name, your stats (with your token) |
| `GET /stats?id=` | anyone's stats for the day (the player card) |
| `GET /leaderboard` | today live, plus yesterday, week, month, all time |
| `GET /bots` | the bots' ids and names |
| `GET /rooms` | the friends room list |
| `GET /d1`, `GET /audit` | local only: browse the database, check the books |

On a table's socket, the server sends `{t:'table',S}` (with your own two cards in `S.mine`), `{t:'seat',doc}`, `{t:'money',…}` and `{t:'closed'}`. The browser sends `{t:'seat',…}`, `{t:'money',delta}`, `{t:'leave'}` and the owner's `{t:'cmd',name,args}`: next, speed, clearstats, approve, kick and unkick.
