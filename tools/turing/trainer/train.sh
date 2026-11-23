#!/bin/bash
# Train turing's blueprints on one GPU: the bucket tables once, then each stack depth in turn for its minutes (a
# checkpoint per depth, resumed when run again), each exported as a blueprint for the bot.
#   tools/turing/trainer/train.sh ["7:20 12:25 20:35 35:50 60:80 100:180"] [blueprint folder, default out/blueprints]
# Needs nvcc (an H100: sm_90; see cuda/Makefile), python3 with numpy, and torch for the kernel check against
# tools/solver/solve.py. On Purdue's Gautschi it ran as a Slurm job:
#   sbatch -A <account> -p ai -q normal -N 1 -n 1 -c 14 --gres=gpu:1 -t 8:00:00 tools/turing/trainer/train.sh
# Then: tools/turing/build.sh tools/turing/trainer/out/blueprints
set -uo pipefail
cd "$(dirname "$0")"
PY=${PY:-python3}
SPECS=${1:-"7:20 12:25 20:35 35:50 60:80 100:180"}
OUT=${2:-out/blueprints}
BIN=cuda/pcfr_hu3
BK=cuda/data/buckets2.bin
make -C cuda || exit 1
mkdir -p out cuda/data "$OUT"
[ -f $BK ] || $BIN precompute --out $BK || exit 1
for s in 20 100; do
  echo "### the kernel against solve.py at ${s}BB"
  $PY test_hu.py --stack $s || { echo "### kernel check failed"; exit 1; }
done
$PY hu_flop_table.py --buckets $BK --out "$OUT/flop.bkt"
for spec in $SPECS; do
  s=${spec%%:*}
  m=${spec##*:}
  echo "### ${s}BB for $m more minutes"
  $PY hu_export.py --stack "$s" --out "out/hu$s.prog" || exit 1
  # --minutes counts all the training a checkpoint has had, so a second run gets its own budget on top
  done_min=$($PY -c "import struct
try:
  f=open('out/hu$s.ckpt','rb'); f.read(32); print(int(struct.unpack('<d',f.read(8))[0]/60))
except Exception: print(0)")
  $BIN train --prog "out/hu$s.prog" --buckets $BK --ckpt "out/hu$s.ckpt" \
    --batch 8192 --minutes $((done_min + m)) --report 200 --save 500 --resume || echo "### training ${s}BB failed"
  $PY hu_blueprint.py --stack "$s" --ckpt "out/hu$s.ckpt" --buckets $BK --out "$OUT/bp$s.bin"
done
echo "### done at $(date)"
