"""Cards, hand values and hand strength on the GPU, the same way the game counts them (js/cards.js).

A card is suit*13 + (rank-2): rank 2..14 (A = 14), suits spades, hearts, diamonds, clubs = 0..3.
The 1326 two-card hands are numbered as js/bots.js loops over them: (0,1), (0,2) .. (0,51), (1,2) ..
A hand value is the game's own number (js/cards.js enc): category * 16^5 + five ranks in base 16, so the
values here equal best7() in the browser exactly (tests/solver.test.js checks it).
"""
import torch

RANKS, SUITS = '23456789TJQKA', 'shdc'
NH = 1326


def card(s):
    return SUITS.index(s[1]) * 13 + RANKS.index(s[0])


class Deck:
    """Index tables for the 1326 hands, on one device."""

    def __init__(self, device):
        self.device = device
        a, b = torch.triu_indices(52, 52, 1, device=device)
        self.ha, self.hb = a, b                                   # the two cards of each hand
        hands_of = [((a == c) | (b == c)).nonzero().squeeze(1) for c in range(52)]
        self.ch = torch.stack(hands_of)                           # [52, 51]: the hands holding each card
        # where each hand sits in the card lists of its first and second card (flat index into [52 * 51])
        self.pa = torch.empty(NH, dtype=torch.long, device=device)
        self.pb = torch.empty(NH, dtype=torch.long, device=device)
        slot = torch.arange(52 * 51, device=device).reshape(52, 51)
        for c in range(52):
            first = a[self.ch[c]] == c
            self.pa[self.ch[c][first]] = slot[c][first]
            self.pb[self.ch[c][~first]] = slot[c][~first]

    def valid(self, board):
        """[N, k] board cards -> [N, 1326] bool: the hand shares no card with the board."""
        hit = torch.zeros(board.shape[0], 52, dtype=torch.bool, device=self.device)
        hit.scatter_(1, board.long(), True)
        return ~(hit[:, self.ha] | hit[:, self.hb])


def straight_high(pres):
    """[N, 13] bool rank presence -> [N] high card of the best straight (5 for the wheel), 0 if none."""
    ext = torch.cat([pres[:, 12:13], pres], 1)                     # the ace also plays low
    win = ext.unfold(1, 5, 1).all(-1)                              # [N, 10]: window j holds ranks j+1 .. j+5
    j = torch.arange(10, device=pres.device)
    return torch.where(win, j + 5, torch.zeros_like(j)).max(1).values


def evaluate(cards):
    """[N, k] cards (5 <= k <= 7) -> [N] int64 hand values, equal to js best7()."""
    cards = cards.long()
    n, dev = cards.shape[0], cards.device
    r, s = cards % 13, cards // 13
    one = torch.ones_like(r)
    cnt = torch.zeros(n, 13, dtype=torch.long, device=dev).scatter_add_(1, r, one)
    scnt = torch.zeros(n, 4, dtype=torch.long, device=dev).scatter_add_(1, s, one)
    fsuit = scnt.argmax(1)
    flush = scnt.gather(1, fsuit[:, None]).squeeze(1) >= 5
    inf = ((s == fsuit[:, None]) & flush[:, None]).long()
    fpres = torch.zeros(n, 13, dtype=torch.long, device=dev).scatter_add_(1, r, inf) > 0
    rv = torch.arange(2, 15, device=dev)                          # rank values 2..14
    pres = cnt > 0

    def top(mask, k):                                             # the k highest ranks present in mask
        return torch.where(mask, rv, torch.zeros_like(rv)).topk(k, 1).values

    def enc(cat, k):
        out = cat * 16 ** 5
        for i in range(k.shape[1]):
            out = out + k[:, i] * 16 ** (4 - i)
        return out

    key = torch.where(pres, cnt * 16 + rv, torch.zeros_like(cnt))
    order = key.argsort(1, descending=True)                        # ranks by count, then rank
    g, c = order + 2, cnt.gather(1, order)
    z = torch.zeros(n, 1, dtype=torch.long, device=dev)

    def without(*ranks):                                           # presence without some ranks
        m = pres.clone()
        for x in ranks:
            m = m & (rv[None, :] != x[:, None])
        return m

    sf = torch.where(flush, straight_high(fpres), torch.zeros_like(fsuit))
    st = straight_high(pres)
    v = enc(torch.zeros_like(fsuit), top(pres, 5))                             # high card
    v = torch.where(c[:, 0] == 2, enc(torch.ones_like(fsuit), torch.cat([g[:, :1], top(without(g[:, 0]), 3)], 1)), v)
    two = (c[:, 0] == 2) & (c[:, 1] == 2)
    v = torch.where(two, enc(torch.full_like(fsuit, 2), torch.cat([g[:, :2], top(without(g[:, 0], g[:, 1]), 1)], 1)), v)
    v = torch.where(c[:, 0] == 3, enc(torch.full_like(fsuit, 3), torch.cat([g[:, :1], top(without(g[:, 0]), 2)], 1)), v)
    v = torch.where(st > 0, enc(torch.full_like(fsuit, 4), torch.cat([st[:, None], z, z, z, z], 1)), v)
    v = torch.where(flush, enc(torch.full_like(fsuit, 5), top(fpres, 5)), v)
    full = (c[:, 0] == 3) & (c[:, 1] >= 2)
    v = torch.where(full, enc(torch.full_like(fsuit, 6), torch.cat([g[:, :2], z, z, z], 1)), v)
    v = torch.where(c[:, 0] == 4, enc(torch.full_like(fsuit, 7), torch.cat([g[:, :1], top(without(g[:, 0]), 1), z, z, z], 1)), v)
    v = torch.where(sf > 0, enc(torch.full_like(fsuit, 8), torch.cat([sf[:, None], z, z, z, z], 1)), v)
    return v


def hand_values(deck, board):
    """[N, k] boards -> [N, 1326] value of every hand on each board (hands that clash are still valued)."""
    n, k = board.shape
    cards = torch.cat([deck.ha[None, :, None].expand(n, -1, 1), deck.hb[None, :, None].expand(n, -1, 1),
                       board[:, None, :].long().expand(-1, NH, k)], 2)
    return evaluate(cards.reshape(-1, k + 2)).reshape(n, NH)


class Showdown:
    """For one batch of boards with fixed hand values, the opponent mass a hand beats, ties and can face.

    Card removal is exact: an opponent hand that shares a card with mine is not counted. lte(r) returns, for every
    hand h, L = sum of r over valid opponent hands worth less than h, E = worth the same, T = all valid ones.
    """

    def __init__(self, deck, vals=None, arrays=None):
        self.deck = deck
        if arrays is not None:                                      # precomputed (Pool), as int16 to save memory
            self.perm, self.gs, self.ge, self.cperm, self.cgs, self.cge = (x.long() for x in arrays)
            return
        n = vals.shape[0]
        self.perm, self.gs, self.ge = self._groups(vals)
        cv = vals[:, deck.ch]                                       # [n, 52, 51]
        self.cperm, self.cgs, self.cge = self._groups(cv.reshape(n * 52, 51))
        self.cperm, self.cgs, self.cge = (x.reshape(n, 52, 51) for x in (self.cperm, self.cgs, self.cge))

    def arrays(self):
        return [x.to(torch.int16) for x in (self.perm, self.gs, self.ge, self.cperm, self.cgs, self.cge)]

    @staticmethod
    def _groups(v):
        m, w = v.shape
        vs, perm = v.sort(1)
        idx = torch.arange(w, device=v.device).expand(m, -1)
        newg = torch.ones(m, w, dtype=torch.bool, device=v.device)
        newg[:, 1:] = vs[:, 1:] != vs[:, :-1]
        start = torch.where(newg, idx, torch.zeros_like(idx)).cummax(1).values
        endg = torch.ones(m, w, dtype=torch.bool, device=v.device)
        endg[:, :-1] = newg[:, 1:]
        end = torch.where(endg, idx + 1, torch.full_like(idx, w)).flip(1).cummin(1).values.flip(1)
        inv = torch.empty_like(perm)
        inv.scatter_(1, perm, idx)
        return perm, start.gather(1, inv), end.gather(1, inv)       # per original slot: group start / end (sorted)

    def totals(self, r):
        """T: the valid opponent mass for every hand."""
        d = self.deck
        sc = r[:, d.ch].sum(2)                                      # [n, 52]
        return r.sum(1, keepdim=True) - sc[:, d.ha] - sc[:, d.hb] + r

    def lte(self, r):
        d, n = self.deck, r.shape[0]
        zero = torch.zeros(n, 1, dtype=r.dtype, device=r.device)
        cum = torch.cat([zero, r.gather(1, self.perm).cumsum(1)], 1)
        l_all = cum.gather(1, self.gs)
        e_all = cum.gather(1, self.ge) - l_all
        rc = r[:, d.ch]                                             # [n, 52, 51]
        ccum = torch.cat([zero[:, :, None].expand(n, 52, 1), rc.gather(2, self.cperm).cumsum(2)], 2)
        lc = ccum.gather(2, self.cgs)
        ec = ccum.gather(2, self.cge) - lc
        sc = ccum[:, :, -1]
        lc, ec = lc.reshape(n, -1), ec.reshape(n, -1)
        l_cards = lc[:, d.pa] + lc[:, d.pb]                         # the hand's two card lists
        e_cards = ec[:, d.pa] + ec[:, d.pb]
        total = cum[:, -1:]
        return l_all - l_cards, e_all - e_cards + r, total - sc[:, d.ha] - sc[:, d.hb] + r

    def strength(self, valid):
        """Share of the valid opponent hands each hand beats, ties counting half (HS)."""
        r = valid.to(torch.float32)
        L, E, T = self.lte(r)
        return torch.where(T > 0, (L + E / 2) / T.clamp_min(1e-9), torch.zeros_like(T))


def texture_class(board):
    """[N, k] boards -> [N] 0 paired, 1 three or more of a suit, 2 three ranks within a straight's reach, 3 dry.
    The same as js/gto.js texClass (from js/bots.js texture())."""
    board = board.long()
    n, dev = board.shape[0], board.device
    r, s = board % 13, board // 13
    one = torch.ones_like(r)
    cnt = torch.zeros(n, 13, dtype=torch.long, device=dev).scatter_add_(1, r, one)
    scnt = torch.zeros(n, 4, dtype=torch.long, device=dev).scatter_add_(1, s, one)
    paired = (cnt >= 2).any(1)
    flushy = scnt.max(1).values >= 3
    pres = torch.cat([cnt[:, 12:13] > 0, cnt > 0], 1).long()       # ace low too
    run = pres.unfold(1, 5, 1).sum(-1).max(1).values               # most ranks inside any five in a row
    out = torch.full((n,), 3, dtype=torch.long, device=dev)
    out = torch.where(run >= 3, torch.full_like(out, 2), out)
    out = torch.where(flushy, torch.ones_like(out), out)
    return torch.where(paired, torch.zeros_like(out), out)
