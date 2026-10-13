# Verve Poker

单页德州扑克：人机练习，或者和朋友开房间联机（Verve 服务器发牌，或旧的 Firebase 方式）。没有构建步骤，GitHub Pages 直接发布 `main` 分支。

## 目录

```
index.html          页面骨架，以及 import map（由 tools/stamp.js 生成）
css/                样式，按编号顺序加载，后面的会覆盖前面的
  0-tokens.css      颜色、字体变量（只在这里定义）
  1-base.css        牌桌、座位、牌、操作区、面板
  2-layout.css      手机一屏布局、筹码轨、下注区
  3-theme.css       牌桌外观和 iPhone 尺寸
  4-features.css    确认按钮、房主审批、提前操作、头像表情、统计
  5-skins.css       牌桌皮肤：一楼会议室、二楼休息区
  6-lobby.css       主页：标题两边选楼层、盲注、模式卡片和按钮颜色
js/
  main.js           入口：连接 Firebase，恢复上次的模式
  config.js         常量和 Firebase 配置
  util.js           小工具（$、fmt、esc、store…）
  settings.js       盲注、练习/正式模式、牌型提示、每日买入额度
  state.js          共享的运行状态（按用途分组），写入用 setX()；界面通过 view 钩子注册重画函数
  cards.js          牌、洗牌、比牌型、胜率估算        ← 纯逻辑，有测试
  chips.js          筹码：精确付款、找零、整理          ← 纯逻辑，有测试
  pots.js           主池和边池                          ← 纯逻辑，有测试
  crypto.js         联机底牌加密（ECDH + AES-GCM）
  table.js          牌桌状态上的查询和小操作
  engine.js         房主引擎：发牌、下注轮、全下跑牌、摊牌结算
  bots.js           机器人策略
  stats.js          我的统计
  talk.js           头像、机器人台词、表情
  fx.js             彩带、轮到你的提示音、屏幕常亮
  online.js         联机同步：房间文档、座位文档、记录文档、审批和请出
  net.js            连 Verve 服务器：用 WebSocket 模拟 Firestore 的 doc/onSnapshot 接口，online.js 不用改
  actions.js        你的操作：确认、下注预设、提前操作、买入/退出/整理
  seats.js          换座位：人机局直接换；联机向房主申请
  modes.js          菜单 / 人机 / 联机 之间切换
  ui/               各块界面（牌桌、操作区、记录页、大厅）和事件处理
                    依赖方向只有一个：ui/ 用游戏逻辑，游戏逻辑不引用 ui/（重画走 state.js 的 view）
server/             Verve 服务器（Cloudflare Worker + 每个房间一个 Durable Object）
  worker.js         入口：/room/<房间号> 转给这个房间的 Durable Object
  room.js           房间：用 js/engine.js 发牌和推进牌局，存进 Durable Object 存储，按人推送
wrangler.jsonc      Cloudflare 部署配置：一个 Worker 同时放网页和 Verve 服务器
tests/              node:test 单元测试
tools/stamp.js      按文件内容给每个模块加版本号，防止更新时新旧文件混用
tools/simulate.js   无界面模拟人机局：npm run sim -- 300 maniac 1（--check 查筹码守恒，--trace=奶龙 看大输的手）
tools/benchmark.js  让机器人对 4 种陪练（fold/station/maniac/nit）各打多局，比较强弱：npm run bench
```

## 本地运行

模块不能用 `file://` 打开，起一个本地服务器：

```
npm run serve        # http://localhost:8000
```

## 改完代码之后

```
npm run stamp        # 更新 index.html 里的版本号（每次改 js 或 css 都要跑）
npm run check        # eslint + 单元测试；import map 没更新也会报错
```

然后提交、推到 `main`，GitHub Pages 大约一分钟后上线。

推到 `main` 也会自动部署到 Cloudflare（网页和 Verve 服务器一起）：https://verve.meiling-wang0131.workers.dev
（`.github/workflows/deploy.yml`，需要仓库 Secret `CLOUDFLARE_API_TOKEN`；也可以在 Actions 页面手动运行）

## 联机需要的 Firebase 字段

座位文档 `rooms/{房间}/seats/{uid}` 由玩家自己写：`name pub join t act buyN cashN tidyN emo seatReq`。
房间文档 `rooms/{房间}` 和记录文档 `rooms/{房间}/meta/records` 由房主写，房间里的人读。

## Verve 服务器（Cloudflare）

设置了服务器地址后，联机改由服务器当庄家：洗牌、发牌、计时、结算都在 Cloudflare 上跑，
房主只是有审批、请人、换座位、重置权限的普通玩家，房主离开或锁屏牌局照常继续。
每个人的底牌只发给本人，别人（包括房主）的浏览器里根本没有。

```
mkdir -p dist && cp -r index.html css js dist/
npx wrangler dev                 # 本地网页 + 服务器 http://127.0.0.1:8787/?server=http://127.0.0.1:8787
```

推到 `main` 自动部署（见上面）。`js/config.js` 里的 `SERVER_URL` 是现在用的服务器
（`https://verve.meiling-wang0131.workers.dev`），所有人都走服务器；留空则还是 Firebase。
也可以在网址后加 `?server=<地址>` 临时切换（会记在浏览器里）。

协议：`wss://<服务器>/room/<房间号>?uid=…&token=…`（建房再加 `&create=1&sb=1&bb=2`）。
服务器发 `{t:'table',S}`（S 里带 `mine`：你自己的两张牌）和 `{t:'seat',doc}`；
客户端发 `{t:'seat',op:'set'|'update',data}`（字段同上面的座位文档）和房主命令 `{t:'cmd',name,args}`
（approve / swap / kick / unkick / restart）。uid 第一次连上时绑定 token，别人冒用会被拒绝。
