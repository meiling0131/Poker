"""The heads-up walk against the PyTorch reference (tools/solver/solve.py's walk) on a GPU.

  python3 test_hu.py [--stack 20] [--boards 24]

Compiles the game, runs `pcfr_hu walktest` with a random regret table and random line ranges on random boards, and
walks every line again with solve.py's Solver.walk on the same boards and buckets: regret increments, strategy sums
and every hand's value at each line's root must agree.
"""
import argparse
import os
import subprocess
import sys
import tempfile

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, '..', '..', 'solver')     # this repo's tools/solver: solve.py, poker.py
sys.path.insert(0, REF)
sys.path.insert(0, HERE)
import solve  # noqa: E402
from poker import NH, Deck, Showdown, hand_values, texture_class  # noqa: E402
from hu_export import compile_game, default_config, write  # noqa: E402

NB, NTEX = 10, 4      # NB: --nb (10 for cuda/cuda2, 24 for cuda3)
DEV = torch.device('cuda')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--stack', type=float, default=20)
    ap.add_argument('--boards', type=int, default=24)
    ap.add_argument('--pcfr', default=os.path.join(HERE, 'cuda', 'pcfr_hu3'))
    ap.add_argument('--buckets', default=os.path.join(HERE, 'cuda', 'data', 'buckets2.bin'))
    ap.add_argument('--nb', type=int, default=24)
    a = ap.parse_args()
    global NB
    NB = solve.NB = a.nb
    rng = np.random.default_rng(11)
    cfg = default_config(a.stack)
    g = compile_game(cfg)
    nact, nlines = len(g['acts']), len(g['lines'])
    rows = nact * NTEX * NB
    with tempfile.TemporaryDirectory() as tmp:
        prog = os.path.join(tmp, 'g.prog')
        write(prog, cfg, g)
        boards = np.stack([rng.choice(52, 5, replace=False) for _ in range(a.boards)]).astype(np.int32)
        R = rng.normal(0, 1, (rows * 6,)).astype(np.float32)
        ranges = rng.uniform(0, 1, (nlines, 2, NH)).astype(np.float32)
        bf, rf, gf, of = (os.path.join(tmp, x) for x in ('b.bin', 'r.bin', 'g.bin', 'o.bin'))
        with open(bf, 'wb') as f:
            np.array([a.boards], np.int32).tofile(f)
            boards.tofile(f)
        R.tofile(rf)
        ranges.tofile(gf)
        subprocess.run([a.pcfr, 'walktest', '--prog', prog, '--buckets', a.buckets, '--boards', bf, '--R', rf,
                        '--rng', gf, '--out', of], check=True)
        raw = open(of, 'rb').read()
    o = 0

    def take(dt, n):
        nonlocal o
        x = np.frombuffer(raw[o:o + n * np.dtype(dt).itemsize], dt)
        o += n * np.dtype(dt).itemsize
        return x
    rinc, sinc = take(np.float32, rows * 6), take(np.float64, rows * 6)
    lineval, hcount = take(np.float32, nlines * 2 * NH).reshape(nlines, 2, NH), take(np.int32, NH)
    take(np.float64, 2)
    bk = take(np.uint8, a.boards * 3 * NH).reshape(a.boards, 3, NH)

    deck = Deck(DEV)
    b = torch.tensor(boards, device=DEV, dtype=torch.long)
    valid = deck.valid(b)
    tex = torch.stack([texture_class(b[:, :k]) for k in (3, 4, 5)], 1)
    buck = torch.tensor(bk.astype(np.int64), device=DEV)
    buck = torch.where(buck > NB - 1, torch.zeros_like(buck), buck)
    solve.KM = 1                                           # keys = act id * 4 + texture, the CUDA row layout
    for i, n in enumerate(g['acts']):
        n.kbase = i * NTEX
        n.mask = torch.tensor(n.mask, device=DEV, dtype=torch.float32)
    s = object.__new__(solve.Solver)
    s.deck, s.dev = deck, DEV
    s.R = torch.tensor(R, device=DEV).reshape(rows, 6)
    s.Rinc = torch.zeros_like(s.R)
    s.Sinc = torch.zeros(rows, 6, device=DEV, dtype=torch.float64)
    ok = valid.float()
    with torch.inference_mode():
        s.sd = Showdown(deck, hand_values(deck, b))
        s.valid, s.tex, s.bucket = valid, tex, buck
        s.onehot = [(torch.nn.functional.one_hot(buck[:, k], NB).float() * ok[..., None]).transpose(1, 2).contiguous()
                    for k in range(3)]
        s.nbr = torch.arange(NB, device=DEV)[None, :]
        ref_lv = np.zeros((nlines, 2, NH))
        for li, root in enumerate(g['roots']):
            r0 = torch.tensor(ranges[li, 0], device=DEV)[None] * valid
            r1 = torch.tensor(ranges[li, 1], device=DEV)[None] * valid
            v0, v1 = s.walk(root, r0, r1)
            ref_lv[li, 0] = (v0 * ok).sum(0).double().cpu().numpy()
            ref_lv[li, 1] = (v1 * ok).sum(0).double().cpu().numpy()
    tr, ts = s.Rinc.cpu().numpy().reshape(-1), s.Sinc.cpu().numpy().reshape(-1)
    fails = 0

    def check(name, x, y, tol):
        nonlocal fails
        err = np.abs(x - y).max() / max(1e-12, np.abs(y).max())
        good = err < tol
        fails += not good
        print(f'  {"ok  " if good else "FAIL"} {name}: max error {err:.2e} of the largest ({np.abs(y).max():.3g})')
    check('regret increments', rinc, tr, 2e-4)
    check('strategy sums', sinc, ts, 2e-4)
    check('line root values', lineval.astype(np.float64), ref_lv, 2e-4)
    good = np.array_equal(hcount, ok.sum(0).cpu().numpy().astype(np.int32))
    fails += not good
    print(f'  {"ok  " if good else "FAIL"} valid-board counts')
    for li in range(nlines):
        e = np.abs(lineval[li] - ref_lv[li]).max() / max(1e-12, np.abs(ref_lv[li]).max())
        if e >= 2e-4:
            print(f'    line {li} ({"show" if g["lines"][li][0] else "flop"}, pot {g["lines"][li][1]:g}): {e:.2e}')
    print('ALL PASSED' if not fails else f'{fails} FAILED')
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
