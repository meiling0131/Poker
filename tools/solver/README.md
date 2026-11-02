# 机器人策略求解器（GPU）

离线训练机器人**单挑翻牌后**的博弈论（近似纳什均衡）策略表。训练好的表打包进 `js/gto-table.js`，机器人在牌桌上直接查表（`js/gto.js`），浏览器和服务器都不用做任何计算量大的事。没有表时（`export default null`），机器人用它们自己的规则（`js/bots.js`）。

## 它算的是什么

- **博弈：** 两人从翻牌打到河牌，起始范围来自机器人自己的翻牌前起手牌表（`js/preflop.js` → `ranges.json`）。五种翻牌前路线，各解一次：

  | 名字 | 路线 | 底池 / 后手（BB） |
  |---|---|---|
  | `srp_ip` | 按钮开池 2.5BB，大盲跟 | 5.5 / 97.5 |
  | `srp_oop` | 劫位开池，按钮位跟 | 6.5 / 97.5 |
  | `3bp_oop` | 大盲 3-bet 按钮到 9BB，按钮跟 | 18.5 / 91 |
  | `3bp_ip` | 按钮 3-bet 劫位到 7.5BB，劫位跟 | 16.5 / 92.5 |
  | `4bp` | 开池者有位置 4-bet 到 21BB，3-bettor 跟 | 42.5 / 79 |

- **下注：** 每条街下注 1/3、3/4、1.25 倍底池或全下；加注是跟注后再加 80% 底池；每条街最多一次下注、一次加注、一次全下再加注（`tree.py`）。
- **手牌分组：** 每条街 10 组。翻牌和转牌按「到河牌时对随机一手牌的平均胜率」分 5 档，每档再分成成牌和听牌；河牌按当下的胜率分 10 档。公共牌分 4 种牌面（对子面、三张同花、顺子面、干燥面）。
- **算法：** Discounted CFR（α=1.5, β=0, γ=2），向量化：每次迭代发一批完整的公共牌，1326 种手牌、两个玩家一起在 GPU 上算一遍（public chance sampling）。摊牌按精确的去牌（card removal）计算。
- **信息集：** 街 × 位置 × 牌面 × 本街开始时的 SPR 档 × 面对的下注大小档 × 本街已下注次数 × 主动权 × 手牌组。机器人在牌桌上用同样的方法算出这几个量来查表，算法和 Python 完全一致（测试见下）。

## 在 A100 上训练

```bash
cd tools/solver
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt          # PyTorch 请按你的 CUDA 版本装，见 pytorch.org

# 先跑一个小的确认环境没问题（一两分钟）
python3 solve.py --scenario 4bp --pool 2000 --iters 50 --report 10

# 正式训练：五条路线一个接一个，每条默认 3000 次迭代、每次 1024 副公共牌
python3 solve.py --all
```

- 开始时先发 10 万副公共牌并算好每手牌的分组，要几分钟；之后每次迭代大约一两秒（最大的两棵树），五条路线全部练完大约几个小时，可以放一晚上。
- 每 `--save`（默认 500）次迭代存一次表 `out/<路线>.json` 和断点 `out/<路线>.pt`；中断了加 `--resume` 接着练。
- 日志里的 `OOP EV` 是没位置一方的期望（BB），`strategy moved` 是平均策略和上次报告比变了多少，越练越小、趋于稳定就差不多了。
- 显存够的话可以把 `--batch` 加到 2048 或 4096，每次迭代更准；`--pool`（默认 10 万副公共牌）越大，对牌面的覆盖越全。
- 想要更细可以多练：`--iters 10000`。最大的 `srp_ip` / `srp_oop` 树有约 4900 个节点，其余小得多。

## 打包、测试、上线

```bash
python3 show.py out/srp_ip.json # 先看看几个常见局面的策略合不合理
python3 pack.py                 # out/*.json → js/gto-table.js
cd ../..
npm run stamp && npm run check  # 模块版本号、lint 和全部测试
node tools/exploit.js stealer 3000 1      # 看脚本玩家（偷盲、连续开火等）对机器人的结果
node tools/simulate.js                    # 机器人自己之间的数据
git add js/gto-table.js && git commit -m "Bots: solver table" && git push
```

推到 `main` 就会自动部署。想退回机器人自己的规则：`python3 pack.py --clear`。

不想先上线也能试：`python3 pack.py --to /tmp/t.json`，然后 `GTO_TABLE=/tmp/t.json node tools/exploit.js barreler 3000 1` 和 `NO_GTO=1 node tools/exploit.js barreler 3000 1` 对比有表和没表。

## 文件

| 文件 | 内容 |
|---|---|
| `poker.py` | 牌、手牌值（和 `js/cards.js` 的 `best7` 数值完全一样）、去牌后的摊牌计算、胜率、牌面分类 |
| `tree.py` | 下注树和信息集的编号（`js/gto.js` 用同样的编号） |
| `solve.py` | 发牌池、手牌分组、DCFR 训练、导出 |
| `pack.py` | 把训练好的表压成 `js/gto-table.js` |
| `show.py` | 把表里常见的局面打印出来看看（持续下注、面对持续下注、河牌面对大注），上线前检查策略合不合理 |
| `export_ranges.mjs` | 从 `js/preflop.js` 导出每条路线的起始范围到 `ranges.json`（改了起手牌表后重跑） |

## 校验

- `poker.py` 的手牌值和游戏里的 `best7` 逐一相同（5、6、7 张牌，各种牌型）。
- 去牌后的摊牌求和与逐对比较的暴力结果一致。
- `js/gto.js` 的牌面分类、当下胜率和信息集编号与 Python 完全一致。

## 局限

- 只管单挑的翻牌后；多人底池和翻牌前仍按机器人自己的规则（翻牌前是标准起手牌表）。
- 手牌分组和下注尺寸是抽象过的：真实下注会按占底池的比例归到最近的一档。
- 机器人的性格（Joe 爱开火、sc 求稳……）仍然在表的基础上做调整，所以它们不是纯 GTO，但都在合理的价格范围内。
