"""Train the bots' postflop strategy on the GPU: discounted CFR (DCFR) over the betting tree in tree.py.

Heads up from the flop, with the starting ranges of one preflop line (ranges.json, from the bots' charts). Each
iteration deals a batch of whole boards from a pool and walks the tree once for all 1326 hands of both players at
once (vector-form CFR with public chance sampling). Hands are grouped into 10 buckets per street by strength
against a random hand (flop and turn: the expected strength at the river, split into drawing / made; river: the
strength itself), and a strategy is learned per bucket and per information-set key (tree.py), so the table stays
small and the bots can look it up from what they see at the table.

  python3 solve.py --scenario srp_ip --iters 3000 --batch 1024 --device cuda
  python3 solve.py --all --device cuda          # every scenario in ranges.json, one after another

The table goes to out/<scenario>.json (and a checkpoint to out/<scenario>.pt every --save iterations, picked up
again with --resume). pack.py turns the tables into js/gto-table.js.
"""
import argparse
import json
import os
import time

import torch

from poker import NH, Deck, Showdown, hand_values, texture_class
from tree import KM, NKEYS, build, walk_nodes

HERE = os.path.dirname(os.path.abspath(__file__))
NB = 10            # buckets per street
EHS_BINS = 5       # flop and turn: five strength bins, each split into made / drawing
POT_T = .05        # a drawing hand: expected strength at the river this much above the strength now
ALPHA, BETA, GAMMA = 1.5, 0.0, 2.0


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def random_boards(n, gen, dev, known=None, k=5):
    """n boards of k cards; with `known` [n, j] the first j cards are kept and the rest drawn around them."""
    keys = torch.rand(n, 52, generator=gen, device=dev)
    if known is not None:
        keys.scatter_(1, known.long(), 2.0)
        extra = keys.argsort(1)[:, :k - known.shape[1]]
        return torch.cat([known.long(), extra], 1)
    return keys.argsort(1)[:, :k]


def strength_now(deck, board):
    return Showdown(deck, hand_values(deck, board)).strength(deck.valid(board))


def strength_later(deck, known, runouts, gen):
    """Expected strength at the river against a random hand, over `runouts` random completions of the board."""
    acc = torch.zeros(known.shape[0], NH, device=known.device)
    cnt = torch.zeros_like(acc)
    for _ in range(runouts):
        full = random_boards(known.shape[0], gen, known.device, known)
        ok = deck.valid(full).float()
        acc += strength_now(deck, full) * ok
        cnt += ok
    return acc / cnt.clamp_min(1)


class Pool:
    """Boards dealt once, with what every hand makes of them: buckets per street, textures, river showdown tables."""

    def __init__(self, deck, n, runouts, gen, chunk):
        dev = deck.device
        self.n, self.deck = n, deck
        self.boards = random_boards(n, gen, dev)
        self.valid = deck.valid(self.boards)
        self.tex = torch.stack([texture_class(self.boards[:, :k]) for k in (3, 4, 5)], 1)
        ehs = torch.zeros(n, 2, NH, device=dev)          # flop, turn: expected strength at the river
        pot = torch.zeros(n, 2, NH, dtype=torch.bool, device=dev)
        hs = torch.zeros(n, NH, device=dev)              # river strength
        arrays = None
        t0 = time.time()
        for a in range(0, n, chunk):
            b = self.boards[a:a + chunk]
            for s, k in ((0, 3), (1, 4)):
                e = strength_later(deck, b[:, :k], runouts if k == 3 else max(8, runouts // 2), gen)
                ehs[a:a + chunk, s] = e
                pot[a:a + chunk, s] = e - strength_now(deck, b[:, :k]) > POT_T
            sd = Showdown(deck, hand_values(deck, b))
            hs[a:a + chunk] = sd.strength(deck.valid(b))
            part = sd.arrays()
            arrays = part if arrays is None else [torch.cat([x, y]) for x, y in zip(arrays, part)]
            if a == 0 or (a // chunk) % 20 == 0:
                log(f'  pool {min(n, a + chunk)}/{n} boards ({time.time() - t0:.0f}s)')
        self.sd_arrays = arrays
        v = self.valid
        self.edges = []
        bucket = torch.zeros(n, 3, NH, dtype=torch.uint8, device=dev)
        for s in range(3):
            x = (ehs[:, s] if s < 2 else hs)
            sample = x[v]
            if sample.numel() > 2_000_000:
                sample = sample[torch.randint(sample.numel(), (2_000_000,), generator=gen, device=dev)]
            bins = EHS_BINS if s < 2 else NB
            q = torch.quantile(sample.float(), torch.linspace(0, 1, bins + 1, device=dev)[1:-1])
            self.edges.append([round(float(e), 4) for e in q])
            idx = torch.bucketize(x.contiguous(), q.contiguous())
            if s < 2:
                idx = idx * 2 + pot[:, s].long()
            bucket[:, s] = idx.to(torch.uint8)
        self.bucket = bucket

    def batch(self, idx):
        sd = Showdown(self.deck, arrays=[x[idx] for x in self.sd_arrays])
        return self.valid[idx], self.tex[idx], self.bucket[idx].long(), sd


class Solver:
    def __init__(self, scen, deck, pool, dev):
        self.deck, self.pool, self.dev = deck, pool, dev
        self.root = build(scen['pot'], scen['stack'], scen['init'])
        self.nodes = walk_nodes(self.root)
        for n in self.nodes:
            if n.kind == 'act':
                n.mask = torch.tensor(n.mask, device=dev) if not torch.is_tensor(n.mask) else n.mask
        self.R = torch.zeros(NKEYS * NB, 6, device=dev)
        self.S = torch.zeros(NKEYS * NB, 6, device=dev, dtype=torch.float64)
        self.rng = [torch.tensor(scen['oop'], device=dev), torch.tensor(scen['ip'], device=dev)]
        self.t = 0

    def strategy(self, n, fi):
        reg = self.R[fi].clamp_min(0) * n.mask
        tot = reg.sum(-1, keepdim=True)
        return torch.where(tot > 0, reg / tot.clamp_min(1e-12), (n.mask / n.mask.sum()).expand_as(reg))

    def walk(self, n, r0, r1):
        if n.kind == 'fold':
            p = n.folder
            loss = n.c[p]
            t0, t1 = self.sd.totals(r1), self.sd.totals(r0)       # what each player's hands face
            return (-loss * t0, loss * t1) if p == 0 else (loss * t0, -loss * t1)
        if n.kind == 'show':
            c = n.c[0]
            l0, e0, t0 = self.sd.lte(r1)
            l1, e1, t1 = self.sd.lte(r0)
            return c * (2 * l0 + e0 - t0), c * (2 * l1 + e1 - t1)
        p, s = n.player, n.street
        fi = ((n.kbase + self.tex[:, s] * KM) * NB)[:, None] + self.bucket[:, s, :]
        sig = self.strategy(n, fi)
        vp = torch.zeros_like(r0)
        vo = torch.zeros_like(r0)
        va = torch.zeros(r0.shape + (6,), device=r0.device)
        for slot, kid in n.kids:
            if p == 0:
                a0, a1 = self.walk(kid, r0 * sig[..., slot], r1)
                va[..., slot], vo = a0, vo + a1
            else:
                a0, a1 = self.walk(kid, r0, r1 * sig[..., slot])
                va[..., slot], vo = a1, vo + a0
            vp = vp + sig[..., slot] * va[..., slot]
        regret = (va - vp[..., None]) * n.mask
        rp = r0 if p == 0 else r1
        oh = self.onehot[s]                                         # [B, NB, 1326]: hands by bucket (valid only)
        rows = (((n.kbase + self.tex[:, s] * KM) * NB)[:, None] + self.nbr).reshape(-1)
        self.Rinc.index_add_(0, rows, torch.bmm(oh, regret).reshape(-1, 6))
        self.Sinc.index_add_(0, rows, torch.bmm(oh, rp[..., None] * sig).reshape(-1, 6).double())
        return (vp, vo) if p == 0 else (vo, vp)

    def step(self, batch, gen):
        self.t += 1
        t = self.t
        idx = torch.randint(self.pool.n, (batch,), generator=gen, device=self.dev)
        self.valid, self.tex, self.bucket, self.sd = self.pool.batch(idx)
        ok = self.valid.float()
        self.onehot = [(torch.nn.functional.one_hot(self.bucket[:, s], NB).float() * ok[..., None]).transpose(1, 2).contiguous()
                       for s in range(3)]
        self.nbr = torch.arange(NB, device=self.dev)[None, :]
        r0, r1 = self.rng[0][None] * self.valid, self.rng[1][None] * self.valid
        self.Rinc = torch.zeros_like(self.R)
        self.Sinc = torch.zeros_like(self.S)
        v0, _ = self.walk(self.root, r0, r1)
        if t > 1:                                                  # DCFR: old regrets and strategies count less
            tt = t - 1
            self.R = torch.where(self.R > 0, self.R * (tt ** ALPHA / (tt ** ALPHA + 1)), self.R * (tt ** BETA / (tt ** BETA + 1)))
            self.S *= (tt / (tt + 1)) ** GAMMA
        self.R += self.Rinc
        self.S += self.Sinc
        joint = (r0 * self.sd.totals(r1)).sum()
        return float((r0 * v0).sum() / joint.clamp_min(1e-9))        # the out-of-position player's EV in big blinds

    def average(self):
        tot = self.S.sum(-1, keepdim=True)
        return torch.where(tot > 0, self.S / tot.clamp_min(1e-300), torch.zeros_like(self.S)).float()

    def export(self, scen_name, scen, path, edges):
        avg = self.average().reshape(NKEYS, NB, 6)
        mass = self.S.reshape(NKEYS, NB, 6).sum(-1)
        keep = mass.sum(1) > mass.sum() * 1e-7
        keys = {}
        for k in keep.nonzero().squeeze(1).tolist():
            rows = []
            for b in range(NB):
                rows.append([round(float(x), 3) for x in avg[k, b]] if mass[k, b] > 0 else [])
            keys[str(k)] = rows
        out = {'scenario': scen_name, 'about': scen.get('about', ''), 'pot': scen['pot'], 'stack': scen['stack'],
               'init': scen['init'], 'iters': self.t, 'nb': NB, 'ehsBins': EHS_BINS, 'potT': POT_T, 'edges': edges,
               'keys': keys}
        with open(path, 'w') as f:
            json.dump(out, f, separators=(',', ':'))
        return len(keys)


def run(name, scen, args, dev):
    gen = torch.Generator(device=dev)
    gen.manual_seed(args.seed)
    deck = Deck(dev)
    os.makedirs(args.out, exist_ok=True)
    ck = os.path.join(args.out, f'{name}.pt')
    log(f'{name}: {scen.get("about", "")} · pot {scen["pot"]}BB, {scen["stack"]}BB behind')
    log(f'  dealing {args.pool} boards ({args.runouts} runouts each for the flop strength)')
    pool = Pool(deck, args.pool, args.runouts, gen, args.chunk)
    solver = Solver(scen, deck, pool, dev)
    acts = sum(1 for n in solver.nodes if n.kind == 'act')
    log(f'  tree: {len(solver.nodes)} nodes, {acts} decisions · bucket edges {pool.edges}')
    if args.resume and os.path.exists(ck):
        state = torch.load(ck, map_location=dev)
        solver.R, solver.S, solver.t = state['R'], state['S'], state['t']
        log(f'  resumed at iteration {solver.t}')
    t0, prev, ev_avg = time.time(), None, None
    while solver.t < args.iters:
        ev = solver.step(args.batch, gen)
        ev_avg = ev if ev_avg is None else ev_avg * .98 + ev * .02
        if solver.t % args.report == 0 or solver.t == args.iters:
            avg = solver.average()
            moved = float((avg - prev).abs().sum(-1).mean()) if prev is not None else float('nan')
            prev = avg
            per = (time.time() - t0) / max(1, solver.t)
            log(f'  it {solver.t}/{args.iters} · OOP EV {ev_avg:+.3f}BB · strategy moved {moved:.4f} · {per:.2f}s/it')
        if solver.t % args.save == 0 or solver.t == args.iters:
            torch.save({'R': solver.R, 'S': solver.S, 't': solver.t}, ck)
            n = solver.export(name, scen, os.path.join(args.out, f'{name}.json'), pool.edges)
            log(f'  saved {name}.json ({n} keys)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--scenario', default='srp_ip')
    ap.add_argument('--all', action='store_true', help='every scenario in ranges.json')
    ap.add_argument('--iters', type=int, default=3000)
    ap.add_argument('--batch', type=int, default=1024, help='boards per iteration')
    ap.add_argument('--pool', type=int, default=100000, help='boards dealt up front')
    ap.add_argument('--runouts', type=int, default=48, help='random completions for the flop strength (turn: half)')
    ap.add_argument('--chunk', type=int, default=512, help='boards per step while dealing the pool')
    ap.add_argument('--device', default='cuda' if torch.cuda.is_available() else 'cpu')
    ap.add_argument('--seed', type=int, default=1)
    ap.add_argument('--report', type=int, default=50)
    ap.add_argument('--save', type=int, default=500)
    ap.add_argument('--resume', action='store_true')
    ap.add_argument('--out', default=os.path.join(HERE, 'out'))
    ap.add_argument('--threads', type=int, default=0, help='CPU threads (0: all)')
    args = ap.parse_args()
    if args.threads:
        torch.set_num_threads(args.threads)
    dev = torch.device(args.device)
    if dev.type == 'cuda':
        torch.backends.cuda.matmul.allow_tf32 = True
        log(f'device: {torch.cuda.get_device_name(dev)}')
    scens = json.load(open(os.path.join(HERE, 'ranges.json')))
    for name in (scens if args.all else [args.scenario]):
        run(name, scens[name], args, dev)


if __name__ == '__main__':
    main()
