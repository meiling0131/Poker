"""The betting tree a solve plays: heads up from the flop to the river, a few bet sizes per street.

Both players start the flop with half the pot each counted as theirs and the same stack behind. The first
player to act on every street is out of position (player 0), the other is in position (player 1).

Action slots (shared with js/gto.js):
  0 fold   1 check / call   2 bet a third of the pot, or raise   3 bet 3/4 pot   4 bet 1.25 pot   5 all in
A raise is a call plus 80% of the pot after the call (raise to = bet + 0.8 * (pot + to call)). A bet or raise that
would put in 60% or more of what is left becomes all in. At most a bet, a raise and an all-in re-raise per street.

Information-set keys (the bots look them up the same way, js/gto.js keyOf):
  street 0..2 (flop, turn, river) · player 0/1 · board texture 0..3 · SPR class at the start of the street 0..3 ·
  facing class 0..4 (nothing to call; a bet up to 45% of the pot, 90%, 160%, more or all in) · bets and raises
  so far this street 0..2 · initiative 0/1 (on the flop: the preflop raiser; later: the last street's aggressor)
"""

SLOTS = ('fold', 'call', 'small', 'medium', 'large', 'allin')
BET_SIZES = ((2, .33), (3, .75), (4, 1.25))
RAISE = .8
ALLIN_SHARE = .6
TEX, SPR, FACE, NBETS, INIT = 4, 4, 5, 3, 2
KM = SPR * FACE * NBETS * INIT                 # the key stride of one texture class
NKEYS = 3 * 2 * TEX * KM


def spr_class(spr):
    return 0 if spr < 1.5 else 1 if spr < 4 else 2 if spr < 10 else 3


def facing_class(to_call, pot, all_in):
    if to_call <= 0:
        return 0
    if all_in:
        return 4
    f = to_call / max(1e-9, pot - to_call)
    return 1 if f <= .45 else 2 if f <= .9 else 3 if f <= 1.6 else 4


def key_of(street, player, tex, spr_c, face_c, nb, init):
    return ((((((street * 2 + player) * TEX + tex) * SPR + spr_c) * FACE + face_c) * NBETS + min(nb, 2)) * INIT + init)


class Node:
    __slots__ = ('kind', 'player', 'street', 'c', 'kids', 'mask', 'kbase', 'folder', 'depth')

    def __init__(self, kind, c, street=0):
        self.kind, self.c, self.street = kind, tuple(c), street
        self.kids, self.mask, self.player, self.kbase, self.folder, self.depth = [], None, -1, 0, -1, 0


def build(pot0, stack0, init_player):
    """The tree for a pot of pot0 big blinds and stack0 behind each; init_player raised before the flop."""
    total = pot0 / 2 + stack0

    def street_start(street, c, init):
        pot, behind = c[0] + c[1], total - max(c)
        return act(street, 0, c, 0, init, spr_class(behind / pot))

    def end_of_street(street, c, aggr):
        if max(c) >= total - 1e-9 or street == 2:
            return Node('show', c, street)
        return street_start(street + 1, c, aggr)

    def put(c, p, to):
        nc = list(c)
        nc[p] = min(total, to)
        return nc

    def act(street, p, c, nb, init, spr_c, checked=False):
        o = 1 - p
        to_call, pot, behind = c[o] - c[p], c[0] + c[1], total - c[p]
        opp_all_in = c[o] >= total - 1e-9
        n = Node('act', c, street)
        n.player = p
        n.kbase = key_of(street, p, 0, spr_c, facing_class(to_call, pot, opp_all_in), nb, 1 if init == p else 0)
        kids = {}
        if to_call > 0:
            f = Node('fold', c, street)
            f.folder = p
            kids[0] = f
            kids[1] = end_of_street(street, put(c, p, c[o]), o)
            if not opp_all_in and behind > to_call and nb <= 2:
                if nb == 1:
                    to = c[o] + RAISE * (pot + to_call)
                    if to - c[p] < ALLIN_SHARE * behind:
                        kids[2] = act(street, o, put(c, p, to), nb + 1, init, spr_c)
                kids[5] = act(street, o, put(c, p, total), nb + 1, init, spr_c)
        else:
            kids[1] = end_of_street(street, c, -1) if checked else act(street, o, c, nb, init, spr_c, True)
            jam = behind <= 2.5 * pot
            for slot, frac in BET_SIZES:
                amt = frac * pot
                if amt < ALLIN_SHARE * behind:
                    kids[slot] = act(street, o, put(c, p, c[p] + amt), nb + 1, init, spr_c)
                else:
                    jam = True
            if jam and behind > 0:
                kids[5] = act(street, o, put(c, p, total), nb + 1, init, spr_c)
        n.kids = sorted(kids.items())
        n.mask = [1.0 if s in kids else 0.0 for s in range(6)]
        return n

    return street_start(0, (pot0 / 2, pot0 / 2), init_player)


def walk_nodes(root):
    out, stack = [], [(root, 0)]
    while stack:
        n, d = stack.pop()
        n.depth = d
        out.append(n)
        stack.extend((k, d + 1) for _, k in n.kids)
    return out
