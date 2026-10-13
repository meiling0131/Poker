<p align="center">
  <img src="docs/pocket-aces.svg" width="300" alt="A pair of aces: the ace of spades and the ace of hearts, with two poker chips">
</p>

<h1 align="center">Verve Poker</h1>

<p align="center">
  <b>English</b> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  No-limit Texas Hold'em in your browser: practise against six bots that each play their own way,<br>
  or open a private room and play your friends. Nothing to install, made for phones first.
</p>

<p align="center">
  <a href="https://verve.vpoker.workers.dev"><b>▶ Play now</b></a>
</p>

---

## The game

**Three ways to play**

| Mode | Who you play | Buy-ins |
| --- | --- | --- |
| **Normal** | You and 6 bots | 200 a time, out of a daily allowance of 1,000 that resets at local midnight. Leaving doesn't refund it. |
| **Practice** | You and 6 bots | Unlimited. Try lines and bet sizes freely. |
| **Friends** | 2–10 real players | 200 a time. The hand starts as soon as two players have bought in. |

**Two rooms to sit in.** Pick a floor from the lobby: the first-floor meeting room with its long walnut table and houndstooth armchairs, or the second-floor lounge with a dark stone table and leather sofas.

**Real chips.** Your stack is actual chips (1, 5, 10 and 25). Tap chips to push them over the line and build a bet. Payouts come back in exact change, and **整理 (Tidy)** sorts your stack. You can also use the buttons: Fold, Check/Call, Bet/Raise with presets or a custom amount, and All in. Every action asks for a quick confirmation, so a stray tap never costs you.

**Bots with personalities**

| Bot | Style |
| --- | --- |
| **Joe** | Loves to raise preflop and re-raise when raised; disciplined after the flop, rarely bluffs. |
| **sc** | Likes to see flops and lets go when the flop misses; with big hands, prefers check-calling or small bets. |
| **老周 (Lao Zhou)** | Very tight and steady. Plays good hands and seldom bluffs. |
| **奶龙 (Nailong)** | The big spender: sticky and loves to call, but needs a real hand for big money. Rebuys two at a time. |
| **Kmetsch** | Shows strong hands for a while, then starts bluffing, but only against one or two players and never a calling station. |
| **阿芳 (A-Fang)** | Plays lots of pots and isn't shy to raise. Loose, not reckless. |

**Playing with friends**

- Pick your own room code (or leave it blank for a random one) and, if you like, a password.
- The lobby lists the rooms people are in right now. Tap one, enter a name (and the password, if it has one) and you're in.
- The **Verve server** (on Cloudflare) deals every hand. Each player's hole cards are sent only to that player; no one else's browser, not even the host's, ever has them. The host can lock their phone or leave and the game carries on.
- The host approves buy-ins, can remove players, swap seats and reset the table.

**At the table**

- Dealing, flipping, chips sliding into the pot and to the winner. At showdown the winning five cards light up.
- Pre-actions while you wait (check/fold, check, call any), hints that name your hand, run it twice when all-in, side pots.
- Tap a seat for a player card with their stats, or to swap seats.
- Emoji, table talk from the bots, a sound when it's your turn, and the screen stays awake.
- **记录 (Records):** the ledger, hand log and your own stats.

## How to play

1. Open **[verve.vpoker.workers.dev](https://verve.vpoker.workers.dev)** and pick a floor.
2. **Against bots:** tap **Normal** or **Practice**, then **买一手 +200** (buy in) to get dealt in.
3. **With friends:** enter a nickname. Then either type a room code (or leave it blank) and tap **创建房间** (create; you can add a password), or tap a room in the list.
4. When it's your turn, tap chips to build a bet, or use **Fold / Call / Raise / All in**, then confirm.

The interface is in Chinese: 买一手 = buy in, 退一手 = cash out, 整理 = tidy chips, 下一手 = next hand.

---

## For developers

A single page with plain ES modules and no build step. GitHub Pages serves `main` as-is. Every push to `main` also deploys the page and the Verve server to Cloudflare as one Worker.

### Layout

```
index.html          page skeleton and the import map (written by tools/stamp.js)
css/                styles, loaded in numeric order; later files override earlier ones
  0-tokens.css      colour and font variables (defined only here)
  1-base.css        table, seats, cards, player panel, panels
  2-layout.css      phone layout, chip rail, bet zone
  3-theme.css       table look and page/header sizes
  4-features.css    confirm buttons, host approvals, pre-actions, avatars and emoji, stats
  5-skins.css       table skins: first-floor meeting room, second-floor lounge
  6-lobby.css       lobby: floors beside the title, stakes, mode cards, button colours
  7-table.css       table layout (one screen, cards scale with the table) and the animations
js/
  main.js           entry: connect to the server (or Firebase), restore the last mode
  config.js         constants and Firebase config
  util.js           small helpers ($, fmt, esc, store…)
  settings.js       stakes, normal/practice, hand hints, daily allowance
  state.js          shared runtime state, written through setX(); views register redraws on `view`
  cards.js          cards, shuffling, hand ranking, equity        ← pure logic, tested
  chips.js          chips: exact payment, change, tidying         ← pure logic, tested
  pots.js           main and side pots                            ← pure logic, tested
  crypto.js         hole-card encryption for Firebase rooms (ECDH + AES-GCM)
  table.js          queries and small operations on the table state
  engine.js         the dealer: dealing, betting rounds, all-in runouts, showdown
  bots.js           bot strategy
  stats.js          your stats
  talk.js           avatars, bot lines, emoji
  fx.js             confetti, your-turn sound, keep the screen awake
  online.js         online sync: room, seat and records documents; approvals and removals
  net.js            Verve server client: a WebSocket behind the same doc/onSnapshot interface
  actions.js        your actions: confirm, bet presets, pre-actions, buy in / cash out / tidy
  seats.js          seat swaps: direct against bots, by request online
  modes.js          switching between lobby, bots and online; room errors
  ui/               views (table, your seat and panel, records, lobby) and event handlers
                    anim.js: table animations, keyed by start time so redraws don't restart them
                    one direction only: ui/ uses the game logic, never the other way round
server/             Verve server (a Cloudflare Worker, one Durable Object per room)
  worker.js         entry: /room/<code> → that room's Durable Object; /rooms → the room list
  room.js           a room: runs js/engine.js, stores the table, sends each player their view; passwords
  lobby.js          the room list: every room with someone connected reports here
wrangler.jsonc      Cloudflare config: one Worker serves the page and the server
tests/              node:test unit tests
tools/stamp.js      versions every module by content so an update never mixes old and new files
tools/simulate.js   headless bot games: npm run sim -- 300 maniac 1 (--check for chip conservation)
tools/benchmark.js  bots against four sparring styles (fold/station/maniac/nit): npm run bench
```

### Run it locally

Modules don't load from `file://`, so serve the folder:

```
npm run serve                    # page only: http://localhost:8000

mkdir -p dist && cp -r index.html css js dist/
npx wrangler dev                 # page + Verve server: http://127.0.0.1:8787/?server=http://127.0.0.1:8787
```

### After changing code

```
npm run stamp        # refresh the version numbers in index.html (after any js or css change)
npm run check        # eslint + unit tests; also fails if the import map is stale
```

Then push to `main`. GitHub Pages updates in about a minute, and `.github/workflows/deploy.yml` deploys to Cloudflare (https://verve.vpoker.workers.dev). The workflow needs the repository secret `CLOUDFLARE_API_TOKEN`; you can also run it by hand from the Actions tab.

### Verve server

`SERVER_URL` in `js/config.js` is the server everyone uses. Leave it empty to fall back to Firebase. `?server=<url>` switches for one browser (remembered).

- **Connect:** `wss://<server>/room/<code>?uid=…&token=…`. Creating a room adds `&create=1&sb=1&bb=2`, plus `&pw=…` for a password.
- **Room codes** are 3–8 letters or digits, chosen by the creator (random when left blank).
- **Passwords** are hashed in the browser (SHA-256 of `verve:<code>:<password>`), and the server only stores the hash. Each uid is asked once; after that its token is enough.
- **Refusals:** the server sends `{t:'error',code}` and hangs up. The codes are `password` (missing or wrong), `taken` (someone else's room), `noroom` and `identity` (the uid's token doesn't match). A code frees up after its room has been empty for 12 hours.
- **Room list:** `GET /rooms` returns `[{code,n,online,pw,sb,bb,host}]`, where `n` is seated players, `online` is connected players and `pw` says whether there's a password.
- **Server → client:** `{t:'table',S}` (with `S.mine`, your own two cards) and `{t:'seat',doc}`.
- **Client → server:** `{t:'seat',op:'set'|'update',data}` and the host's `{t:'cmd',name,args}`, where name is approve / swap / kick / unkick / restart.

### Firebase rooms (when `SERVER_URL` is empty)

Each player writes their own seat document `rooms/{room}/seats/{uid}`: `name pub join t act buyN cashN tidyN emo seatReq`. The host writes the room document `rooms/{room}` and the records document `rooms/{room}/meta/records`, and everyone in the room reads them.
