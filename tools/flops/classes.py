"""Hand categories, board classes and the representative flops, exactly as js/flops.js has them.

Cards are strings like 'As', 'Td' (rank 2..9 T J Q K A, suit s h d c), the same text the game and the solver use.
"""
from collections import Counter
from itertools import combinations, permutations

RANKS = '23456789TJQKA'
SUITS = 'shdc'
DECK = [r + s for s in SUITS for r in RANKS]
CATS = 12
CAT_NAMES = ['air', 'overcards / ace high', 'gutshot', 'flush or open-ended draw', 'combo draw / pair + draw',
             'weak pair', 'top pair, weak kicker', 'overpair / top pair J+ kicker', 'two pair', 'set / trips',
             'straight / flush', 'full house +']


def rank(c):
    return RANKS.index(c[0]) + 2


def category5(cards):
    """Hand category of five cards (0 high card .. 8 straight flush), as js/cards.js eval5."""
    rs = sorted((rank(c) for c in cards), reverse=True)
    counts = sorted(Counter(rs).values(), reverse=True)
    flush = len({c[1] for c in cards}) == 1
    u = sorted(set(rs))
    straight = len(u) == 5 and (u[-1] - u[0] == 4 or u == [2, 3, 4, 5, 14])
    if straight and flush:
        return 8
    if counts[0] == 4:
        return 7
    if counts[0] == 3 and counts[1] == 2:
        return 6
    if flush:
        return 5
    if straight:
        return 4
    if counts[0] == 3:
        return 3
    if counts[0] == 2 and counts[1] == 2:
        return 2
    return 1 if counts[0] == 2 else 0


def hand_category(hole, board):
    """What two hole cards make of a three-card flop (js/flops.js handCategory)."""
    made = category5(list(hole) + list(board))
    if made >= 6:
        return 11
    if made >= 4:
        return 10
    br, hr = [rank(c) for c in board], [rank(c) for c in hole]
    top = max(br)
    n = br.count
    pocket = hr[0] == hr[1]
    if pocket and n(hr[0]) >= 1:
        return 9
    if not pocket and (n(hr[0]) == 2 or n(hr[1]) == 2):
        return 9
    if not pocket and n(hr[0]) == 1 and n(hr[1]) == 1:
        return 8
    cards = list(hole) + list(board)
    suits = Counter(c[1] for c in cards)
    fd = any(k >= 4 and any(h[1] == s for h in hole) for s, k in suits.items())
    ranks = {rank(c) for c in cards}
    if 14 in ranks:
        ranks.add(1)
    oesd = gut = False
    for low in range(1, 11):
        miss = [r for r in range(low, low + 5) if r not in ranks]
        if len(miss) != 1:
            continue
        if (miss[0] == low and low <= 9) or (miss[0] == low + 4 and low >= 2):   # AKQJ, A234: gutshots
            oesd = True
        else:
            gut = True
    pair = 0
    if pocket:
        pair = 7 if hr[0] > top else 5
    else:
        m = 0 if n(hr[0]) == 1 else 1 if n(hr[1]) == 1 else -1
        if m >= 0:
            pair = (7 if hr[1 - m] >= 11 else 6) if hr[m] == top else 5
    if pair == 7:
        return 7
    if (pair and (fd or oesd)) or (fd and (oesd or gut)):
        return 4
    if pair:
        return pair
    if fd or oesd:
        return 3
    if gut:
        return 2
    return 1 if all(r > top for r in hr) or 14 in hr else 0


def board_class(board):
    """The flop's class (js/flops.js boardClass): 0..59 unpaired, 60..64 paired."""
    rs = sorted((rank(c) for c in board), reverse=True)
    hi = 0 if rs[0] == 14 else 1 if rs[0] == 13 else 2 if rs[0] == 12 else 3 if rs[0] >= 10 else 4
    if len(set(rs)) < 3:
        return 60 + hi
    most = max(Counter(c[1] for c in board).values())
    u = set(rs)
    if 14 in u:
        u.add(1)
    run = max(sum(1 for r in range(lo, lo + 5) if r in u) for lo in range(1, 11))
    return ((hi * 2 + (1 if rs[1] >= 10 else 0)) * 3 + (most - 1)) * 2 + (1 if run >= 3 else 0)


def canonical(flop):
    """The same flop up to renaming the suits: the smallest sorted form over all 24 suit permutations."""
    best = None
    for perm in permutations(SUITS):
        m = dict(zip(SUITS, perm))
        form = tuple(sorted((RANKS.index(c[0]), m[c[1]]) for c in flop))
        if best is None or form < best:
            best = form
    return best


def all_flops():
    """The 1755 different flops, each with how many of the 22100 deals it stands for."""
    count, example = Counter(), {}
    for flop in combinations(DECK, 3):
        k = canonical(flop)
        count[k] += 1
        example.setdefault(k, flop)
    return [(example[k], count[k]) for k in sorted(count)]


def pick_flops(total):
    """About `total` flops spread over every board class in proportion to how often it comes (at least two each),
    each with its weight: the deals it stands for."""
    by_class = {}
    for flop, w in all_flops():
        by_class.setdefault(board_class(flop), []).append((flop, w))
    deals = sum(w for fl in by_class.values() for _, w in fl)
    picked = []
    for cls in sorted(by_class):
        fl = sorted(by_class[cls], key=lambda x: sorted((-rank(c) for c in x[0])))
        share = sum(w for _, w in fl)
        k = min(len(fl), max(2, round(total * share / deals)))
        step = len(fl) / k
        chosen = [fl[int(i * step)] for i in range(k)]
        scale = share / sum(w for _, w in chosen)
        picked += [(flop, w * scale, cls) for flop, w in chosen]
    return picked
