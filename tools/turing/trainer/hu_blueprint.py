"""Checkpoint -> the blueprint file the Rust bot reads (one per stack depth).

  python3 hu_blueprint.py --stack 100 --ckpt out/hu100.ckpt --out ../bot/data/bp100.bin [--show]

Layout (little endian): "HUBP", version, stack, buckets per street, the abstraction (version 1: the 17 bucket edges;
version 2: strength bins, potential bins, buckets, then the flop / turn / river edges, as the bucket file stores
them); the preflop tree with its
average strategy per class (float); the leaves; the lines; every postflop act node (player, street, action mask,
both players' contributions in big blinds, children: act index, -1 none, -2 fold, -3 showdown); the postflop
average strategy as bytes [act][texture][bucket][action].
"""
import argparse
import os
import struct

import numpy as np

from hu_export import ACTIONS, compile_game, default_config
from hu_tree import PNode

NTEX, NSL = 4, 6


def read_ckpt(path, NB):
    with open(path, 'rb') as f:
        assert f.read(4) == b'PCK2', 'not a heads-up checkpoint'
        _ver, rows, t, nact, npn = struct.unpack('<5i', f.read(20))
        boards, = struct.unpack('<q', f.read(8))
        elapsed, = struct.unpack('<d', f.read(8))
        R = np.fromfile(f, np.float32, rows * NSL)
        S = np.fromfile(f, np.float64, rows * NSL).reshape(nact, NTEX, NB, NSL)
        Rp = np.fromfile(f, np.float64, npn * 169 * 4)
        Sp = np.fromfile(f, np.float64, npn * 169 * 4).reshape(npn, 169, 4)
    return dict(t=t, boards=boards, elapsed=elapsed, S=S, Sp=Sp)


def read_abs(path):
    """(blueprint version, buckets per street, the abstraction's bytes) of a bucket file"""
    with open(path, 'rb') as f:
        assert f.read(4) == b'PBKT', 'not a bucket file'
        ver, = struct.unpack('<i', f.read(4))
        if ver == 1:
            return 1, 10, f.read(17 * 8)
        dims = f.read(12)
        ne, npb, nb = struct.unpack('<3i', dims)
        return 2, nb, dims + f.read(8 * ((ne - 1) * 2 + ne * (npb - 1) * 2 + nb - 1))


def normalize(S, mask):
    """average strategy rows; rows never reached play uniformly over the legal actions"""
    tot = S.sum(-1, keepdims=True)
    uni = mask / mask.sum(-1, keepdims=True)
    return np.where(tot > 0, S / np.maximum(tot, 1e-300), uni)


def to_bytes(p):
    q = np.floor(p * 255 + 0.5).astype(np.int64)
    return np.clip(q, 0, 255).astype(np.uint8)


def export(cfg, g, ck, abs_, path):
    acts, pnodes, leaves = g['acts'], g['pnodes'], g['leaves']
    act_index = {id(n): i for i, n in enumerate(acts)}
    leaf_index = {id(lf): i for i, lf in enumerate(leaves)}
    pmask = np.array([[1.0 if a in n.kids else 0.0 for a in ACTIONS] for n in pnodes])
    pre = normalize(ck['Sp'], pmask[:, None, :])
    amask = np.array([[1.0 if s < len(n.mask) and n.mask[s] else 0.0 for s in range(NSL)] for n in acts])
    post = normalize(ck['S'], amask[:, None, None, :])
    with open(path, 'wb') as f:
        f.write(b'HUBP')
        ver, nb, abs_bytes = abs_
        f.write(struct.pack('<IfI', ver, cfg.stack, nb))
        f.write(abs_bytes)
        f.write(struct.pack('<4I', len(pnodes), len(leaves), len(g['lines']), len(acts)))
        for n in pnodes:
            f.write(struct.pack('<Bff', n.player, n.c[0], n.c[1]))
            for a in ACTIONS:
                k = n.kids.get(a)
                if k is None:
                    f.write(struct.pack('<bi', -1, -1))
                elif isinstance(k, PNode):
                    f.write(struct.pack('<bi', 0, k.id))
                else:
                    f.write(struct.pack('<bi', 1, leaf_index[id(k)]))
        pre.astype(np.float32).tofile(f)
        for lf in leaves:
            kind = {'fold': 0, 'show': 1, 'flop': 2}[lf['kind']]
            f.write(struct.pack('<Bffbi', kind, lf['c'][0], lf['c'][1], lf.get('folder', -1), lf.get('line', -1)))
        for (kind, pot, behind, _leaf), root in zip(g['lines'], g['roots']):
            f.write(struct.pack('<Bffi', kind, pot, behind, act_index.get(id(root), -1)))
        for n in acts:
            mask = sum(1 << s for s in range(NSL) if n.mask[s])
            f.write(struct.pack('<BBBff', n.player, n.street, mask, n.c[0], n.c[1]))
            kids = [-1] * NSL
            for slot, k in n.kids:
                kids[slot] = act_index[id(k)] if k.kind == 'act' else (-2 if k.kind == 'fold' else -3)
            f.write(struct.pack('<6i', *kids))
        to_bytes(post).tofile(f)
    return pre


def class_name(c):
    R = '23456789TJQKA'
    if c < 13:
        return R[c] * 2
    i, s = (c - 13, 's') if c < 91 else (c - 91, 'o')
    hi = 1
    while i >= hi:
        i -= hi
        hi += 1
    return R[hi] + R[i] + s


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--stack', type=float, required=True)
    ap.add_argument('--ckpt', required=True)
    ap.add_argument('--buckets', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cuda', 'data', 'buckets2.bin'))
    ap.add_argument('--out', required=True)
    ap.add_argument('--show', action='store_true', help='print the small blind opening strategy by class')
    a = ap.parse_args()
    cfg = default_config(a.stack)
    g = compile_game(cfg)
    abs_ = read_abs(a.buckets)
    ck = read_ckpt(a.ckpt, abs_[1])
    assert ck['S'].shape[0] == len(g['acts']), 'checkpoint and game differ'
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    pre = export(cfg, g, ck, abs_, a.out)
    print(f'{a.stack:g}BB: {ck["t"]} iterations, {ck["boards"] / 1e9:.3f}G boards, {ck["elapsed"] / 60:.0f} min -> {a.out} '
          f'({os.path.getsize(a.out) / 1e6:.2f} MB)')
    if a.show:
        print('small blind first in (fold / limp / raise / all in):')
        order = sorted(range(169), key=lambda c: -pre[0, c, 2] - pre[0, c, 3])
        print('  ' + '  '.join(f'{class_name(c)} {pre[0, c, 0]:.2f}/{pre[0, c, 1]:.2f}/{pre[0, c, 2]:.2f}/{pre[0, c, 3]:.2f}'
                              for c in order))


if __name__ == '__main__':
    main()
