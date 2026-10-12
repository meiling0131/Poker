# Texas Hold'em Poker

单页德州扑克：人机练习，或者用 Firebase 和朋友开房间联机。没有构建步骤，GitHub Pages 直接发布 `main` 分支。

## 目录

```
index.html          页面骨架，以及 import map（由 tools/stamp.js 生成）
css/                样式，按编号顺序加载，后面的会覆盖前面的
  0-tokens.css      颜色、字体变量（只在这里定义）
  1-base.css        牌桌、座位、牌、操作区、面板
  2-layout.css      手机一屏布局、筹码轨、下注区
  3-theme.css       牌桌外观和 iPhone 尺寸
  4-features.css    确认按钮、房主审批、提前操作、头像表情、统计
js/
  main.js           入口：连接 Firebase，恢复上次的模式
  config.js         常量和 Firebase 配置
  util.js           小工具（$、fmt、esc、store…）
  settings.js       盲注、练习/正式模式、牌型提示、每日买入额度
  state.js          共享的运行状态（S 牌桌、M 会话…），写入用 setX()
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
  actions.js        你的操作：确认、下注预设、提前操作、买入/退出/整理
  modes.js          菜单 / 人机 / 联机 之间切换
  ui/               各块界面（牌桌、操作区、记录页、大厅）和事件处理
tests/              node:test 单元测试
tools/stamp.js      按文件内容给每个模块加版本号，防止更新时新旧文件混用
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

## 联机需要的 Firebase 字段

座位文档 `rooms/{房间}/seats/{uid}` 由玩家自己写：`name pub join t act buyN cashN tidyN emo`。
房间文档 `rooms/{房间}` 和记录文档 `rooms/{房间}/meta/records` 由房主写，房间里的人读。
