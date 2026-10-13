<p align="center">
  <img src="docs/pocket-aces.svg" width="300" alt="一对 A：黑桃 A 和红心 A，旁边两枚筹码">
</p>

<h1 align="center">Verve Poker</h1>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

<p align="center">
  浏览器里的无限注德州扑克：和六个各有打法的机器人练手，<br>
  或者开一个私人房间和朋友对局。不用安装，手机优先。
</p>

<p align="center">
  <a href="https://verve.vpoker.workers.dev"><b>▶ 马上开玩</b></a>
</p>

---

## 游戏介绍

**三种玩法**

| 模式 | 对手 | 买入 |
| --- | --- | --- |
| **正常模式** | 你和 6 个电脑 | 每次 200，从每日 1,000 的额度里扣，本地时间零点恢复；退出不返还。 |
| **练习模式** | 你和 6 个电脑 | 不限次数，随便练下注和打法。 |
| **好友模式** | 2–10 个真人 | 每次 200，满 2 人买入就自动开局。 |

**两个场景。** 在主页选楼层：一楼会议室，胡桃木长桌配千鸟格扶手椅；二楼休息区，深色石面方桌配皮沙发。

**真的筹码。** 你的筹码是一枚一枚的（1、5、10、25）。点筹码推过线就是下注，赢的钱按面值精确找零，**整理**一键理好筹码。也可以直接用按钮：弃牌、过牌/跟注、下注/加注（有预设金额，也能自定义）、全下。每个操作都要确认一下，手滑不会出错。

**各有性格的机器人**

| 机器人 | 打法 |
| --- | --- |
| **Joe** | 翻前爱加注，被加注就再加；翻牌后守纪律，不乱诈唬。 |
| **sc** | 爱看牌，没中就弃；大牌喜欢过牌跟注或者下小注。 |
| **老周** | 很紧很稳，只打好牌，很少诈唬。 |
| **奶龙** | 土豪：粘牌爱跟，但大钱要有大牌；输光一次买两手。 |
| **Kmetsch** | 先打几手实牌，再开始诈唬；只骗一两个人，不骗跟注站。 |
| **阿芳** | 爱入池，也敢加注，手松但不傻。 |

**和朋友联机**

- 房间号自己起（不填就随机），可以设密码。
- 主页顶上列出现在有人在的房间：点一下，填名字（有密码再填密码）就进。
- 每一手都由 **Verve 服务器**（在 Cloudflare 上）发牌。每个人的底牌只发给本人，别人的浏览器里（包括房主）根本没有。房主锁屏或离开，牌局照常继续。
- 房主可以审批买入、请人离开、换座位、重置牌桌。
- **公平洗牌：** 每手重洗一副 52 张，用 `crypto.getRandomValues` 做无偏 Fisher–Yates。人机局在你的浏览器里洗牌发牌，联机局在 Verve 服务器上。轮到真人时限 45 秒，超时自动过牌或弃牌。

**牌桌上**

- 发牌、翻牌、筹码滑进底池再滑向赢家都有动画；摊牌时赢的五张牌会亮起来。
- 等待时可以提前操作（过牌/弃牌、过牌、跟任何注），有牌型提示；全下可以选跑两次，自动分边池。
- 点别人的座位看资料卡和统计，也可以换座位。
- 发表情，机器人会说话，轮到你会提醒，打牌时屏幕不会熄灭。
- **记录**页：账本、牌局记录和你的统计。

## 怎么玩

1. 打开 **[verve.vpoker.workers.dev](https://verve.vpoker.workers.dev)**，选一个楼层。
2. **和电脑打：** 点**正常模式**或**练习模式**，再点**买一手 +200** 入局。
3. **和朋友打：** 先填昵称。可以填一个房间号（或者不填）点**创建房间**（可以设密码）；也可以直接点列表里的房间。
4. 轮到你时，点筹码凑出下注，或者用**弃牌 / 跟注 / 加注 / 全下**，再确认。

---

## 开发说明

单页应用，原生 ES 模块，没有构建步骤。GitHub Pages 直接发布 `main` 分支；每次推到 `main` 也会把网页和 Verve 服务器作为一个 Worker 部署到 Cloudflare。

### 目录

```
index.html          页面骨架，以及 import map（由 tools/stamp.js 生成）
css/                样式，按编号顺序加载，后面的会覆盖前面的
  0-tokens.css      颜色、字体变量（只在这里定义）
  1-base.css        牌桌、座位、牌、操作区、面板
  2-layout.css      手机布局、筹码轨、下注区
  3-theme.css       牌桌外观、页面和标题栏尺寸
  4-features.css    确认按钮、房主审批、提前操作、头像表情、统计
  5-skins.css       牌桌皮肤：一楼会议室、二楼休息区
  6-lobby.css       主页：标题两边选楼层、盲注、模式卡片和按钮颜色
  7-table.css       牌桌排版（一屏放下，牌按桌子大小缩放）和发牌、翻牌、筹码、赢家的动画
  8-polish.css      轮到谁的呼吸灯和倒计时环、下注弹出、手机底池筹码堆、手机下注抽屉、筹码塔点击区
js/
  main.js           入口：连 Verve 服务器，恢复上次的模式
  config.js         常量和服务器地址
  util.js           小工具（$、fmt、esc、store…）
  settings.js       盲注、正常/练习模式、牌型提示、每日买入额度
  state.js          共享的运行状态，写入用 setX()；界面通过 view 钩子注册重画函数
  cards.js          牌、洗牌、比牌型、胜率估算        ← 纯逻辑，有测试
  chips.js          筹码：精确付款、找零、整理          ← 纯逻辑，有测试
  pots.js           主池和边池                          ← 纯逻辑，有测试
  table.js          牌桌状态上的查询和小操作
  engine.js         发牌引擎：发牌、下注轮、全下跑牌、摊牌结算
  bots.js           机器人策略
  stats.js          我的统计
  talk.js           头像、机器人台词、表情
  fx.js             彩带、轮到你的提示音、屏幕常亮
  online.js         联机：你的座位文档、跟随牌桌；在服务器上处理座位文档、审批和请出
  net.js            连 Verve 服务器：用 WebSocket 模拟 Firestore 的 doc/onSnapshot 接口
  actions.js        你的操作：确认、下注预设、提前操作、买入/退出/整理
  seats.js          换座位：人机局直接换；联机向房主申请
  modes.js          主页 / 人机 / 联机 之间切换；进房失败的提示
  ui/               各块界面（牌桌、你的座位和操作区、记录页、主页）和事件处理
                    anim.js：牌桌动画，按开始时间算，牌桌重画时动画接着放，不会重来
                    依赖方向只有一个：ui/ 用游戏逻辑，游戏逻辑不引用 ui/
server/             Verve 服务器（Cloudflare Worker + 每个房间一个 Durable Object）
  worker.js         入口：/room/<房间号> 转给这个房间的 Durable Object；/rooms 是房间列表
  room.js           房间：用 js/engine.js 发牌和推进牌局，存进 Durable Object 存储，按人推送；房间密码
  lobby.js          房间列表：有人连着的房间都报到这里
wrangler.jsonc      Cloudflare 部署配置：一个 Worker 同时放网页和 Verve 服务器
tests/              node:test 单元测试
tools/stamp.js      按文件内容给每个模块加版本号，防止更新时新旧文件混用
tools/simulate.js   无界面模拟人机局：npm run sim -- 300 maniac 1（--check 查筹码守恒）
tools/benchmark.js  让机器人对 4 种陪练（fold/station/maniac/nit）各打多局，比较强弱：npm run bench
```

### 本地运行

模块不能用 `file://` 打开，起一个本地服务器：

```
npm run serve                    # 只有网页：http://localhost:8000

mkdir -p dist && cp -r index.html css js manifest.webmanifest icons dist/
npx wrangler dev                 # 网页 + Verve 服务器：http://127.0.0.1:8787/?server=http://127.0.0.1:8787
```

### 改完代码之后

```
npm run stamp        # 更新 index.html 里的版本号（每次改 js 或 css 都要跑）
npm run check        # eslint + 单元测试；import map 没更新也会报错
```

然后推到 `main`：GitHub Pages 大约一分钟后上线，`.github/workflows/deploy.yml` 同时部署到 Cloudflare（https://verve.vpoker.workers.dev）。这个流程需要仓库 Secret `CLOUDFLARE_API_TOKEN`，也可以在 Actions 页面手动运行。

### Verve 服务器

从 Worker 打开的页面直接连自己所在的网址；别处的副本（比如 GitHub Pages）用 `js/config.js` 里的 `SERVER_URL`，留空就只能和电脑打。网址后加 `?server=<地址>` 可以只给这个浏览器切换（会记住）。

- **连接：** `wss://<服务器>/room/<房间号>?uid=…&token=…`。建房再加 `&create=1&sb=1&bb=2`，有密码再加 `&pw=…`。
- **房间号：** 3–8 位字母或数字，由建房的人自己填，不填就随机。
- **密码：** 在浏览器里先算成 SHA-256（`verve:<房间号>:<密码>`）再发，服务器只存这个值。每个 uid 只在第一次进房时要密码，之后凭 token 直接进。
- **进不去时：** 服务器先发 `{t:'error',code}` 再断开。code 有四种：`password`（没填或填错）、`taken`（房间号被别人占着）、`noroom`（没有这个房间）、`identity`（uid 的 token 对不上）。房间空了 12 小时以后，别人才能用同一个房间号重新建。
- **房间列表：** `GET /rooms` 返回 `[{code,n,online,pw,sb,bb,host}]`。n 是入座人数，online 是在线人数，pw 表示有没有密码。
- **服务器发给客户端：** `{t:'table',S}`（S 里的 `mine` 是你自己的两张牌）和 `{t:'seat',doc}`。
- **客户端发给服务器：** `{t:'seat',op:'set'|'update',data}`（座位文档字段：`name join t act buyN cashN tidyN emo seatReq`），以及房主命令 `{t:'cmd',name,args}`（approve / swap / kick / unkick / restart）。
