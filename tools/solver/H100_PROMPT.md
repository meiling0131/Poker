# 提示词：在 H100 上训练机器人的策略表、精确求解翻牌并上线

把下面整段（分隔线之间）发给在 H100 机器上运行的 AI 编程助手（比如 Claude Code）。它会从准备环境、训练、检查、对比测试一直做到上线。

---

你在一台有 NVIDIA H100（80GB）的机器上工作。任务是为德州扑克游戏 https://github.com/meiling0131/Poker 做两件事：

1. 用 GPU 训练机器人单挑翻牌后的博弈论策略表；
2. 同时用开源求解器在 CPU 上精确求解几百个翻牌。

确认比现在线上那版更强后上线。推送到 `main` 会通过 GitHub Actions 自动部署到 Cloudflare。

## 背景

- 求解器在 `tools/solver/`。开始前先读 `tools/solver/README.md` 和 `solve.py` 开头的说明。
- 原理：GPU 上的 Discounted CFR。五条翻牌前路线各解一次：`srp_ip`、`srp_oop`、`3bp_oop`、`3bp_ip`、`4bp`。每条街把手牌分成 10 组；`ranges.json` 是起始范围。
- 产物和流程：
  - `out/<路线>.json` 是训练出的表。
  - `pack.py` 把表打包成 `js/gto-table.js`，机器人在牌桌上用 `js/gto.js` 查表。
  - 线上现在是一版在 4 核 CPU 上练的粗糙表：单加注底池 500 次迭代、3-bet 底池 1000 次、4-bet 底池 2000 次，每次 32 副公共牌。这次要练一版细得多的。
- 已知问题：CPU 版 `srp_ip` 里，大盲面对转牌 3/4 池下注时，中等牌弃得太多（干燥牌面上 strength 4/5 made 弃 92%）。这正是「容易被诈唬」。新表要把这个问题练掉。
- 精确翻牌策略在 `tools/flops/`（先读它的 README）：
  - `solver/` 是基于开源 postflop-solver（AGPL-3.0）的 Rust 小程序，一次精确求解一个翻牌；
  - `batch.py` 批量求解，再按牌面类别 × 决策点 × 手牌类别整理成 `js/flop-table.js`；
  - 游戏在单挑翻牌时先查这张表。
- 这个 Rust 程序是照着库的源码写的，但还没编译过（写它的环境不允许编译外部代码）。编译不过就修 `solver/src/main.rs`，但要保持文件开头写明的输入输出格式不变。

## 规则

- 不要改 `tree.py`、`poker.py` 里的分组、下注尺寸和信息集编号，也不要改 `solve.py` 里的 `NB`、`EHS_BINS`、`POT_T`。`js/gto.js` 必须和它们完全一致，`tests/bots.test.js` 会检查。只调命令行参数。
- 同样，不要改 `tools/flops/classes.py` 的分类，也不要改 `batch.py` 的决策点、动作格子和下注尺寸。它们和 `js/flops.js` 必须一致。
- 只有第 7 步的检查和第 8 步的对比都通过才上线。没通过就不推 `main`，把结果和原因报告给我。
- `tools/solver/out/`、`tools/flops/out/` 已被 git 忽略。只提交 `js/gto-table.js`、`js/flop-table.js`、`index.html`（版本号）和必要的文档；如果修了，再加上 `tools/flops/solver/src/main.rs`。

## 步骤

### 1. 准备

```bash
git clone https://github.com/meiling0131/Poker.git && cd Poker    # 已有就 git pull
nvidia-smi
python3 --version   # 需要 3.9+
node --version      # 需要 20+，测试和对比用
nproc               # CPU 核数，精确翻牌求解用
cargo --version     # 没有就装 Rust：https://rustup.rs
```

在 `tools/solver` 里建 venv，装和本机 CUDA 匹配的 PyTorch（见 pytorch.org，例如 `pip install torch --index-url https://download.pytorch.org/whl/cu124`）。装好后确认：

```bash
python3 -c "import torch; print(torch.__version__, torch.cuda.get_device_name())"
```

### 2. 冒烟测试（几分钟）

```bash
cd tools/solver
python3 solve.py --scenario 4bp --pool 2000 --iters 50 --report 10 --out /tmp/smoke
python3 show.py /tmp/smoke/4bp.json
```

### 3. 测速

```bash
python3 solve.py --scenario srp_ip --pool 20000 --batch 4096 --iters 40 --report 10 --save 100000 --out /tmp/calib
```

- 记下日志里的 `s/it` 和 `GPU xxGB`。
- 五个进程会同时用这块卡，每条的速度大约是单独跑时的一半到三分之一。
- 按这个估算选 `--iters`：目标是最慢的 `srp_ip`、`srp_oop` 在 6 小时左右练完，至少 2000 次，能到 4000 更好。
- 显存不够就把 `--batch` 降到 2048。

### 4. 正式训练（五条同时跑，在 tmux 里或用 nohup）

```bash
mkdir -p out
for s in srp_ip srp_oop 3bp_oop 3bp_ip 4bp; do
  nohup python3 solve.py --scenario $s --batch 4096 --pool 150000 --runouts 64 --chunk 1024 \
    --iters 4000 --report 50 --save 250 > out/$s.log 2>&1 &
done
```

- 先发牌池，要十几到二十几分钟，之后才开始迭代。
- 用 `nvidia-smi` 看显存；五个进程合计放不下就分两批跑。
- 中断了用同样的命令加 `--resume` 接着练。

### 4b. 同时开始精确翻牌求解（用 CPU，和 GPU 训练一起跑）

```bash
cd ../flops
cargo build --release --manifest-path solver/Cargo.toml
python3 selftest.py
# 先只解一个翻牌，确认程序能跑、输出格式对
python3 batch.py run --flops 2 --lines srp_ip --threads 8 --report 1
python3 batch.py table && python3 batch.py show srp_ip | head -60
```

- 确认：日志里的 exploitability 在底池的 0.5% 左右；`show` 的结果合理（强牌多下注/加注，空气多过牌/弃牌，听牌有半诈唬）。
- 然后正式跑：留 8 个核给 GPU 训练，其余每 8 核一个求解：

```bash
J=$(( ($(nproc) - 8) / 8 )); [ $J -lt 1 ] && J=1
nohup python3 batch.py run --flops 320 --threads 8 --jobs $J > out/run.log 2>&1 &
cd ../solver
```

- 中断了用同样的命令接着跑，已完成的会跳过。
- 内存不够（进程被杀）就减少 `--jobs`。
- 大约要几个到十几个小时，取决于核数；日志里有预计剩余时间。
- 如果明显赶不上 GPU 训练，可以先用 `--flops 160`。

### 5. 盯训练

- 看 `out/*.log`。
- `strategy moved` 应该越来越小。降到 0.001 左右，或到了迭代上限，就算练完。
- `OOP EV` 应该趋于稳定。
- 出现 `Traceback`、`out of memory` 或进程消失，就查原因、调参数，然后 `--resume`。

### 6. 等五条路线都练完，精确翻牌求解也跑完，再做后面的步骤

```bash
cd ../flops && python3 batch.py table && cd ../solver
```

### 7. 检查策略合不合理

```bash
for s in srp_ip srp_oop 3bp_oop 3bp_ip 4bp; do for t in 0 1 2 3; do python3 show.py out/$s.json --tex $t; done; done
```

逐项确认：
- 每个下注都是弱牌多弃、中等牌和听牌多跟、强牌加注或跟。
- 「Turn, the flop caller facing a 3/4-pot barrel」里 `strength 4/5 made` 的 fold 不超过 65%，`strength 5/5` 基本不弃。
- 河牌面对下注时，最弱几组的 all-in（诈唬加注）不超过 8%。
- 持续下注的一方在干燥牌面（`--tex 3`）有相当比例的下注。

不满足的路线用 `--resume --iters <更多>` 接着练，再查。

精确翻牌表也看几个牌面类别，比如 `python3 ../flops/batch.py show srp_ip --cls 6`（A 高、第二张 T 以上、彩虹、不连）和 `--cls 64`（9 以下的对子面）：
- 暗三、两对在被过牌到和面对下注时多下注或加注；
- 空气面对下注多弃；
- 听牌有跟注也有加注。

### 8. 和线上那版对比（脚本玩家打机器人）

```bash
cd ../..                                   # 回到仓库根目录
python3 tools/solver/pack.py --to /tmp/new-table.json
python3 tools/flops/batch.py pack --to /tmp/flops.json
node --input-type=module -e "import t from './js/gto-table.js'; console.log(JSON.stringify(t))" > /tmp/old-table.json
mkdir -p /tmp/ab
for s in 1 2 3; do for h in barreler stealer tag station; do
  for v in new old; do echo "GTO_TABLE=/tmp/$v-table.json node tools/exploit.js $h 3000 $s > /tmp/ab/$v-$h-$s.txt 2>&1"; done
  echo "GTO_TABLE=/tmp/new-table.json FLOP_TABLE=/tmp/flops.json node tools/exploit.js $h 3000 $s > /tmp/ab/flops-$h-$s.txt 2>&1"
  echo "NO_GTO=1 node tools/exploit.js $h 3000 $s > /tmp/ab/none-$h-$s.txt 2>&1"
done; done | xargs -P "$(nproc)" -I{} sh -c "{}"
grep -H -o "= [-0-9.]* bb/100" /tmp/ab/*.txt | sort
```

- 四种变体：`old` 线上那版；`new` 新的 GPU 表；`flops` 新的 GPU 表加精确翻牌表；`none` 两张表都不用。

- 数字是脚本玩家每 100 手赢多少个大盲，**越负说明机器人越强**。
- 每个脚本玩家取三个种子的平均：`barreler` 每条街都开火，`stealer` 偷盲加持续下注，`tag` 正常紧凶，`station` 什么都跟。
- 跟注站由机器人自己的规则对付，只要不比 `none` 差太多就行。
- **上线条件：**
  - `new` 在 `barreler`、`tag`、`stealer` 三项的平均值之和不高于 `old`；
  - 并且任何一项都不比 `old` 高出 40 以上。
- 每局 3000 手的波动大约是一个种子 ±50。差距很小时，可以再加种子 4、5、6 复核。
- 精确翻牌表单独决定：`flops` 比 `new` 好（同样的规则）才上线它，否则只上新的 GPU 表，`js/flop-table.js` 保持 `null`。

### 9. 上线

```bash
python3 tools/solver/pack.py              # 写入 js/gto-table.js
python3 tools/flops/batch.py pack         # 写入 js/flop-table.js（只在它通过第 8 步时）
npm run stamp && npm run check            # 版本号、lint 和全部测试，必须全过
git add js/gto-table.js js/flop-table.js index.html
git commit -m "Bots: the solver table trained on an H100, and exact flop strategies"
git push origin main
```

推送后去 https://github.com/meiling0131/Poker/actions 确认 “Deploy to Cloudflare” 成功。

### 10. 汇报（用中文）

- 每条路线的迭代次数、最后的 `strategy moved`、用时和显存。
- 精确翻牌求解：解了多少个翻牌、平均 exploitability、用时；`main.rs` 有没有修、修了什么。
- 第 7 步的检查结果：特别是 `srp_ip` 转牌那一项，新旧数字对比。
- 第 8 步的表格：每个脚本玩家，old / new / flops / none 四列的三种子平均。
- 是否上线；没上线的话说明原因和下一步建议。

---
