"""Compile one stack depth of the heads-up game into the files the CUDA trainer reads.

  python3 hu_export.py --stack 100 --out out/hu100.prog

Every way the preflop can reach the flop is a "line" with its own postflop tree; every way it can end all in is a
"show" line (one showdown). The GPU program walks all lines for each sampled board, one after another; each line
starts with ROOT_ENTER(line) (its ranges come from the host's preflop strategy every iteration) and ends with
ROOT_EXIT(line), which adds every hand's value into the line's accumulators. Information sets are the postflop act
nodes themselves (full betting history), times board texture and hand bucket.

File layout (little endian): "PCF2", version 2, counts, line table, act tables, prefetch lists, ops, then the
preflop tree (nodes with their actions, leaves).
"""
import argparse
import os
import struct

import numpy as np

from hu_tree import Config, Sizes, build_postflop, build_preflop, PNode

ROOT_ENTER, ROOT_EXIT, ACT_ENTER, ACT_EXIT, CHILD, ACCUM, FOLD, SHOW, STREET_ENTER, STREET_EXIT, FOLDSHOW = range(1, 12)
MAXD, MAXLOC = 14, 32
OPDT = np.dtype([('code', 'u1'), ('d', 'u1'), ('a', 'u1'), ('b', 'u1'), ('i', '<i4'), ('x', '<f4'), ('y', '<f4')])
ACTIONS = ('fold', 'call', 'raise', 'allin')


def compile_game(cfg):
    proot, pnodes, leaves = build_preflop(cfg)
    lines = []                                   # (kind 0 flop / 1 show, pot, behind, leaf index)
    roots = []                                   # each line's postflop root (or its showdown node)
    acts, act_line, pf, ops = [], [], [], []
    act_id, local, lists = {}, {}, {}

    def op(code, d=0, a=0, b=0, i=0, x=0.0, y=0.0):
        assert d < MAXD and (code not in (CHILD, ACCUM, FOLDSHOW) or i < MAXD), 'tree too deep for the walk kernel'
        ops.append((code, d, a, b, i, x, y))

    def street_list(start):
        out = []

        def rec(n):
            out.append(n)
            for _, k in n.kids:
                if k.kind == 'act' and k.street == n.street:
                    rec(k)
        rec(start)
        return out

    def register(start, line):
        lst = street_list(start)
        assert len(lst) <= MAXLOC, 'street subtree too large for the walk kernel'
        off = len(pf)
        for k, n in enumerate(lst):
            if id(n) not in act_id:
                act_id[id(n)] = len(acts)
                acts.append(n)
                act_line.append(line)
            local[id(n)] = k
            pf.append(act_id[id(n)])
        lists[id(start)] = (off, len(lst))

    def gen(n, d, start, line):
        op(ACT_ENTER, d, local[id(n)], n.street, act_id[id(n)])
        kids = dict(n.kids)
        # facing a bet with a showdown behind the call: fold and call evaluated together (they share the
        # opponent's reach), the call's values at level d + 2
        fused = 0 in kids and 1 in kids and kids[1].kind == 'show'
        if fused:
            fk, sk = kids[0], kids[1]
            op(CHILD, d, 0, n.player, d + 1)
            op(CHILD, d, 1, n.player, d + 2)
            op(FOLDSHOW, d + 1, fk.folder, n.street, d + 2, fk.c[fk.folder], sk.c[0])
            op(ACCUM, d, 0, n.player, d + 1)
            op(ACCUM, d, 1, n.player, d + 2)
        for slot, kid in n.kids:
            if fused and slot in (0, 1):
                continue
            op(CHILD, d, slot, n.player, d + 1)
            if kid.kind == 'fold':
                op(FOLD, d + 1, kid.folder, n.street, 0, kid.c[kid.folder])
            elif kid.kind == 'show':
                op(SHOW, d + 1, 0, n.street, 0, kid.c[0])
            elif kid.street != n.street:
                register(kid, line)
                off, cnt = lists[id(kid)]
                op(STREET_ENTER, d + 1, kid.street, cnt, off)
                gen(kid, d + 1, kid, line)
                poff, pcnt = lists[id(start)]
                op(STREET_EXIT, d + 1, n.street, pcnt, poff)
            else:
                gen(kid, d + 1, start, line)
            op(ACCUM, d, slot, n.player, d + 1)
        mask = sum(1 << s for s in range(6) if n.mask[s])
        op(ACT_EXIT, d, mask, n.player | (n.street << 1), act_id[id(n)])

    for li, lf in enumerate(leaves):
        if lf['kind'] == 'fold':
            continue
        line = len(lines)
        assert line < 256
        lf['line'] = line
        pot = lf['c'][0] + lf['c'][1]
        if lf['kind'] == 'show':
            lines.append((1, pot, 0.0, li))
            from hu_tree import Node
            roots.append(Node('show', lf['c'], 0))
            op(ROOT_ENTER, 0, line, 0, len(pf))
            op(SHOW, 0, 0, 0, 0, lf['c'][0])
            op(ROOT_EXIT, 0, line)
            continue
        behind = cfg.stack - lf['c'][0]
        lines.append((0, pot, behind, li))
        root = build_postflop(pot, behind, cfg.postflop)
        roots.append(root)
        register(root, line)
        off, cnt = lists[id(root)]
        op(ROOT_ENTER, 0, line, cnt, off)
        gen(root, 0, root, line)
        op(ROOT_EXIT, 0, line)
    act_mask = [sum(1 << s for s in range(6) if n.mask[s]) for n in acts]
    return dict(proot=proot, pnodes=pnodes, leaves=leaves, lines=lines, roots=roots, acts=acts, act_line=act_line,
                act_mask=act_mask, pf=pf, ops=ops)


def write(path, cfg, g):
    with open(path, 'wb') as f:
        f.write(b'PCF2')
        f.write(struct.pack('<i', 2))
        f.write(struct.pack('<5i', len(g['ops']), len(g['acts']), len(g['pf']), len(g['lines']), len(g['pnodes'])))
        f.write(struct.pack('<fi', cfg.stack, len(g['leaves'])))
        for kind, pot, behind, leaf in g['lines']:
            f.write(struct.pack('<iffi', kind, pot, behind, leaf))
        np.asarray(g['act_mask'], np.int32).tofile(f)
        np.asarray(g['act_line'], np.int32).tofile(f)
        np.asarray(g['pf'], np.int32).tofile(f)
        np.array(g['ops'], OPDT).tofile(f)
        leaf_index = {id(lf): i for i, lf in enumerate(g['leaves'])}
        for n in g['pnodes']:                      # player, contributions, then 4 action slots: kind, index
            f.write(struct.pack('<iff', n.player, n.c[0], n.c[1]))
            for a in ACTIONS:
                k = n.kids.get(a)
                if k is None:
                    f.write(struct.pack('<ii', -1, -1))
                elif isinstance(k, PNode):
                    f.write(struct.pack('<ii', 0, k.id))
                else:
                    f.write(struct.pack('<ii', 1, leaf_index[id(k)]))
        for lf in g['leaves']:                     # kind 0 fold / 1 show / 2 flop, contributions, folder, line
            kind = {'fold': 0, 'show': 1, 'flop': 2}[lf['kind']]
            f.write(struct.pack('<iffii', kind, lf['c'][0], lf['c'][1], lf.get('folder', -1), lf.get('line', -1)))


def default_config(stack):
    return Config(stack, postflop=(Sizes((.33, .75, 1.25)), Sizes((.33, .75, 1.25)), Sizes((.5, 1.0))))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--stack', type=float, required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--pushfold', action='store_true', help='test game: the small blind only folds or goes all in')
    a = ap.parse_args()
    cfg = default_config(a.stack)
    if a.pushfold:
        cfg.preflop_raises, cfg.limp = 0, False
    g = compile_game(cfg)
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    write(a.out, cfg, g)
    nflop = sum(1 for ln in g['lines'] if ln[0] == 0)
    print(f'{a.stack:g}BB: {len(g["pnodes"])} preflop nodes, {len(g["leaves"])} leaves, {nflop} flop lines, '
          f'{len(g["lines"]) - nflop} all-in lines, {len(g["acts"])} postflop act nodes, {len(g["ops"])} ops -> {a.out}')


if __name__ == '__main__':
    main()
