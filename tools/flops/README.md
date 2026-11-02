# 精确的翻牌策略（开源求解器）

用开源求解器 [postflop-solver](https://github.com/b-inary/postflop-solver) 把几百个有代表性的翻牌逐个精确求解。它用的是 Discounted CFR，不做任何抽象，每种手牌组合单独算，作者的测试比 PioSOLVER 还快。解出的结果被整理成牌桌上能直接查的表 `js/flop-table.js`。

- 机器人在单挑翻牌时先查这张表。
- 没有对应的格子，就用 GPU 训练的表（`js/gto.js`）。
- 再没有，就用机器人自己的规则。
- 转牌和河牌仍由 GPU 训练的表负责。

## 它怎么把几百万个策略压成一张小表

每次求解得到的是：这个翻牌上每个决策点、每一手牌的策略。整理时按三样东西归类，同一格里的策略按到达那个决策点的组合数和翻牌出现的频率加权平均。

- **牌面类别**（65 类）：
  - 最大的牌（A、K、Q、J 或 T、9 以下）；
  - 第二张是否 T 以上；
  - 彩虹面、两张同花、三张同花；
  - 三张牌能否组成顺子的一部分；
  - 对子面单独 5 类。
- **决策点**：
  - `''` 没位置先行动；
  - `x` 被过牌到；
  - `b33` / `b75` / `ba` 面对 1/3 池、3/4 池、全下；
  - `xb33` 过牌后面对下注；
  - `b33r` 下注后面对加注；
  - `xb33r` 面对过牌加注。
- **手牌类别**（12 类）：空气、高张/A 高、卡顺听牌、同花或两头顺听牌、组合听牌或对子加听牌、弱对子、顶对弱踢脚、超对或顶对 J 以上踢脚、两对、三条（暗三或明三）、顺子或同花、葫芦以上。

分类在 `classes.py` 和 `js/flops.js` 里各写了一遍，算法完全一样（测试会对比）。

## 运行（在你的机器上；需要 Rust 和 Python 3）

```bash
cd tools/flops
cargo build --release --manifest-path solver/Cargo.toml   # 编译求解程序（第一次要下载依赖）
python3 selftest.py                                        # 不用求解器的自检
python3 batch.py run --flops 320 --threads 8               # 五条路线 × 约 320 个翻牌，可中断、可接着跑
python3 batch.py table                                     # 整理成 out/flop-table.json
python3 batch.py show srp_ip --cls 6                       # 看看某个牌面类别的策略
python3 batch.py pack --to /tmp/flops.json                 # 先打包成试用文件
cd ../..
FLOP_TABLE=/tmp/flops.json node tools/exploit.js barreler 3000 1    # 有翻牌表
NO_GTO=1 node tools/exploit.js barreler 3000 1                       # 都没有
python3 tools/flops/batch.py pack                          # 满意了再写进 js/flop-table.js
npm run stamp && npm run check
```

- `--threads` 是每次求解用几个核，同时跑的求解数是总核数 ÷ threads。
- 每次求解的结果存在 `out/solves/<路线>/<翻牌>.json`，中断后重跑会跳过已完成的。
- 求解用的下注尺寸：翻牌 1/3、3/4 池；转牌 2/3 池；河牌 1/2、1 倍池；加注都是 3 倍；剩余筹码不多时加全下。
- 目标精度：可剥削度不超过底池的 0.5%（`--accuracy 0.005`）。
- 内存：单加注底池每次求解可能要几个 GB。同时跑的多了就减少 `--jobs`。

## 许可

postflop-solver 是 AGPL-3.0，所以 `solver/` 里这个小程序也是 AGPL-3.0。它只在你的机器上离线运行，游戏里只放它算出来的数据（`js/flop-table.js`），不包含它的代码。
