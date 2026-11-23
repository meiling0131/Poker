"""The heads-up no-limit hold'em abstract game the blueprint is solved on.

Amounts are in big blinds. Player 0 is the big blind (out of position after the flop), player 1 the small blind /
button (first to act preflop, last after it). Both start the hand with the same effective stack S.

Preflop is a small tree solved on the host with every hand separate (169 classes, no card abstraction). Each way
the preflop can end becomes a leaf:
  fold         someone folds: the other wins what was put in;
  show         both all in preflop: a showdown, evaluated on the GPU's sampled boards;
  flop line    the betting closes with chips behind: a postflop tree (built here) solved on the GPU.
Postflop trees follow tools/solver/tree.py (bet sizes as pot fractions, a raise = call + a pot fraction, a bet that
would put in 60% or more of what is left becomes all in, at most bet / raise / all-in re-raise per street), with
sizes per street so the river (re-solved live by the bot) can be coarser.
"""
from dataclasses import dataclass, field

ALLIN_SHARE = .6


@dataclass
class Sizes:
    bets: tuple             # bet sizes as pot fractions
    raise_frac: float = .8  # raise to = bet + raise_frac * (pot after the call)


@dataclass
class Config:
    stack: float                                   # effective stack, big blinds
    open_to: float = 2.5                           # small blind's raise
    iso_to: float = 4.0                            # big blind's raise over a limp
    preflop_raises: int = 3                        # sized raises before only all-in remains (open, 3-bet, 4-bet)
    limp: bool = True                              # may the small blind just call first in
    postflop: tuple = (Sizes((.33, .75, 1.25)), Sizes((.33, .75, 1.25)), Sizes((.5, 1.0)))


class Node:
    """postflop node, the same fields solve.py / export use (kind act / fold / show)"""
    __slots__ = ('kind', 'player', 'street', 'c', 'kids', 'mask', 'kbase', 'folder', 'depth')

    def __init__(self, kind, c, street=0):
        self.kind, self.c, self.street = kind, tuple(c), street
        self.kids, self.mask, self.player, self.kbase, self.folder, self.depth = [], None, -1, -1, -1, 0


def build_postflop(pot0, stack0, sizes):
    """postflop tree after a preflop with pot0 in the middle (half each) and stack0 behind each"""
    total = pot0 / 2 + stack0

    def street_start(street, c):
        return act(street, 0, c, 0)

    def end_of_street(street, c):
        if max(c) >= total - 1e-9 or street == 2:
            return Node('show', c, street)
        return street_start(street + 1, c)

    def put(c, p, to):
        nc = list(c)
        nc[p] = min(total, to)
        return nc

    def act(street, p, c, nb, checked=False):
        o = 1 - p
        to_call, pot, behind = c[o] - c[p], c[0] + c[1], total - c[p]
        opp_all_in = c[o] >= total - 1e-9
        n = Node('act', c, street)
        n.player = p
        kids = {}
        sz = sizes[street]
        if to_call > 0:
            f = Node('fold', c, street)
            f.folder = p
            kids[0] = f
            kids[1] = end_of_street(street, put(c, p, c[o]))
            if not opp_all_in and behind > to_call and nb <= 2:
                if nb == 1:
                    to = c[o] + sz.raise_frac * (pot + to_call)
                    if to - c[p] < ALLIN_SHARE * behind:
                        kids[2] = act(street, o, put(c, p, to), nb + 1)
                kids[5] = act(street, o, put(c, p, total), nb + 1)
        else:
            kids[1] = end_of_street(street, c) if checked else act(street, o, c, nb, True)
            jam = behind <= 2.5 * pot
            for slot, frac in zip((2, 3, 4), sz.bets):
                amt = frac * pot
                if amt < ALLIN_SHARE * behind:
                    kids[slot] = act(street, o, put(c, p, c[p] + amt), nb + 1)
                else:
                    jam = True
            if jam and behind > 0:
                kids[5] = act(street, o, put(c, p, total), nb + 1)
        n.kids = sorted(kids.items())
        n.mask = [1.0 if s in kids else 0.0 for s in range(6)]
        return n

    return street_start(0, (pot0 / 2, pot0 / 2))


@dataclass
class PNode:
    """preflop decision: player, contributions [bb, sb], children by action name"""
    player: int
    c: tuple
    kids: dict = field(default_factory=dict)    # action -> PNode or leaf dict
    id: int = -1


def build_preflop(cfg):
    """the preflop tree; leaves are dicts {'kind': 'fold'|'show'|'flop', 'c': (bb, sb), ...}"""
    S = cfg.stack
    leaves = []

    def leaf(kind, c, **kw):
        d = dict(kind=kind, c=tuple(c), **kw)
        leaves.append(d)
        return d

    def node(p, c, nraise, acted):
        """player p to act with contributions c; nraise sized raises so far; acted: has p acted already"""
        o = 1 - p
        to_call = c[o] - c[p]
        n = PNode(p, tuple(c))
        if to_call > 0:
            n.kids['fold'] = leaf('fold', c, folder=p)
        cc = list(c)
        cc[p] = c[o]
        if c[o] >= S - 1e-9:                         # facing all in: fold or call to a showdown
            n.kids['call'] = leaf('show', cc)
            return n
        # call / check: closes the betting unless it is the small blind's limp
        if p == 1 and nraise == 0 and not acted:
            if cfg.limp:
                n.kids['call'] = node(o, cc, 0, False)   # limp: the big blind still acts
        elif to_call == 0 and p == 0 and nraise == 0:
            n.kids['call'] = leaf('flop', cc)        # big blind checks behind a limp
        else:
            n.kids['call'] = leaf('flop', cc)
        behind = S - c[p]
        if nraise < cfg.preflop_raises:
            if nraise == 0:
                to = cfg.open_to if p == 1 else cfg.iso_to
            else:
                to = c[o] + (c[0] + c[1] + to_call)   # pot-sized re-raise
            if to - c[p] < ALLIN_SHARE * behind and to < S:
                rc = list(c)
                rc[p] = to
                n.kids['raise'] = node(o, rc, nraise + 1, True)
        rc = list(c)
        rc[p] = S
        n.kids['allin'] = node(o, rc, nraise + 1, True)
        return n

    root = node(1, (1.0, 0.5), 0, False)
    nodes = []

    def number(n):
        n.id = len(nodes)
        nodes.append(n)
        for k in n.kids.values():
            if isinstance(k, PNode):
                number(k)
    number(root)
    return root, nodes, leaves


def describe(cfg):
    root, nodes, leaves = build_preflop(cfg)
    flops = [lf for lf in leaves if lf['kind'] == 'flop']
    tot_a = tot_t = 0
    parts = []
    for lf in flops:
        pot = lf['c'][0] + lf['c'][1]
        t = build_postflop(pot, cfg.stack - lf['c'][0], cfg.postflop)
        st = [t]
        a = term = 0
        while st:
            n = st.pop()
            if n.kind == 'act':
                a += 1
                st.extend(k for _, k in n.kids)
            else:
                term += 1
        tot_a += a
        tot_t += term
        parts.append(f'{pot:g}:{a}/{term}')
    return len(nodes), len(leaves), len(flops), tot_a, tot_t, parts


if __name__ == '__main__':
    import sys
    river_sets = {'full': Sizes((.33, .75, 1.25)), 'two': Sizes((.5, 1.0)), 'one': Sizes((.75,))}
    for name, rv in river_sets.items():
        for S in (100, 50, 25, 12):
            cfg = Config(S, postflop=(Sizes((.33, .75, 1.25)), Sizes((.33, .75, 1.25)), rv))
            pn, pl, nf, a, t, parts = describe(cfg)
            print(f'river {name:4s} S={S:3d}: preflop {pn} nodes {pl} leaves, {nf} flop lines; postflop act {a}, '
                  f'terminals {t}  ' + ' '.join(parts))
        sys.stdout.flush()
