"""Checks batch.py without the solver: a made-up solve in flop-solve's output format goes through `table` and `pack`.

  python3 selftest.py
"""
import base64
import json
import os
import shutil
import tempfile
import types

import batch
from classes import board_class, hand_category


def main():
    assert batch.node_key([], 110) == ''
    assert batch.node_key(['X'], 110) == 'x'
    assert batch.node_key(['B36'], 110) == 'b33'
    assert batch.node_key(['X', 'B83'], 110) == 'xb75'
    assert batch.node_key(['B36', 'R108'], 110) == 'b33r'
    assert batch.node_key(['X', 'B36', 'A1950'], 110) == 'xb33r'
    assert batch.node_key(['A1950'], 110) == 'ba'
    assert batch.node_key(['B36', 'R108', 'A1950'], 110) is None
    assert batch.slot('B36', '', 110) == 1 and batch.slot('B83', 'x', 110) == 2 and batch.slot('X', '', 110) == 0
    assert batch.slot('R108', 'b33', 110) == 2 and batch.slot('A1950', 'b33', 110) == 3 and batch.slot('F', 'b33', 110) == 0

    board = ['As', 'Kd', '7c']
    assert hand_category(['Ah', 'Ac'], board) == 9                 # a set of aces
    assert hand_category(['Qh', 'Jh'], board) == 2                 # AKQJ: only a ten makes it, a gutshot
    assert hand_category(['Qs', 'Js'], ['Ts', '9d', '2s']) == 4    # flush draw and open-ended: a combo draw
    cls = board_class(board)

    tmp = tempfile.mkdtemp()
    try:
        batch.OUT = tmp
        os.makedirs(os.path.join(tmp, 'solves', 'srp_ip'))
        json.dump([{'flop': 'AsKd7c', 'weight': 2.0, 'class': cls}], open(os.path.join(tmp, 'flops.json'), 'w'))
        solve = {'flop': 'AsKd7c', 'pot': 110, 'exploitability': 0.4,
                 'hands': [['AhAc', 'QhJh'], ['KhKc']],
                 'nodes': [{'path': [], 'player': 0, 'actions': ['X', 'B36', 'B83'], 'weights': [1.0, 0.5],
                            'strategy': [.5, .2, .25, .8, .25, 0]},
                           {'path': ['B36'], 'player': 1, 'actions': ['F', 'C', 'R108'], 'weights': [1.0],
                            'strategy': [0, .4, .6]}]}
        json.dump(solve, open(os.path.join(tmp, 'solves', 'srp_ip', 'AsKd7c.json'), 'w'))
        batch.table(types.SimpleNamespace())
        t = json.load(open(os.path.join(tmp, 'flop-table.json')))
        root = t['lines']['srp_ip'][f'{cls}:']
        assert root[9] == [.5, .25, .25, 0], root[9]               # the set: check half, bet each size a quarter
        assert root[2] == [.2, .8, 0, 0], root[2]                   # the gutshot bets a third of the pot
        assert t['lines']['srp_ip'][f'{cls}:b33'][9] == [0, .4, .6, 0]   # kings facing a third: call or raise
        batch.pack(types.SimpleNamespace(clear=False, to=os.path.join(tmp, 't.json')))
        packed = json.load(open(os.path.join(tmp, 't.json')))
        raw = base64.b64decode(packed['lines']['srp_ip'][f'{cls}:'])
        assert len(raw) == 12 * 4 and list(raw[9 * 4:9 * 4 + 4]) == [128, 64, 64, 0], list(raw[9 * 4:9 * 4 + 4])
    finally:
        shutil.rmtree(tmp)
    print('flops selftest: ok')


if __name__ == '__main__':
    main()
