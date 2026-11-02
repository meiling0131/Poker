"""Exact flop strategies for the bots: solve representative flops with postflop-solver, condense them, pack them.

  cargo build --release --manifest-path solver/Cargo.toml   # once: builds solver/target/release/flop-solve
  python3 batch.py run --flops 320 --threads 8               # solve every line on ~320 flops (resumes)
  python3 batch.py table                                     # condense the solves into out/flop-table.json
  python3 batch.py show srp_ip                               # a look at one line's table
  python3 batch.py pack                                      # out/flop-table.json -> js/flop-table.js
  python3 batch.py pack --to /tmp/flops.json                 # plain JSON, to try it first (FLOP_TABLE=...)
  python3 batch.py pack --clear                              # no flop table: the bots go back to the GPU table

`run` solves each preflop line of ../solver/ranges.json on each picked flop (classes.py pick_flops), one
flop-solve process per `--threads` cores, and keeps every solve in out/solves/<line>/<flop>.json, so an
interrupted run picks up where it stopped. `table` turns every hand's strategy at each flop decision into
its board class x decision point x hand category (classes.py), weighted by how many combos of the hand
reach the decision and how often the flop comes.
"""
import argparse
import base64
import json
import math
import os
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from classes import CAT_NAMES, CATS, board_class, hand_category, pick_flops

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
RANGES = os.path.join(HERE, '..', 'solver', 'ranges.json')
TARGET = os.path.join(HERE, '..', '..', 'js', 'flop-table.js')
SOLVER = os.path.join(HERE, 'solver', 'target', 'release', 'flop-solve')
CHIPS = 20                       # chips per big blind in the solves (the solver counts in whole chips)
SIZES = {'flop_sizes': ['33%, 75%', '3x'], 'turn_sizes': ['66%', '3x'], 'river_sizes': ['50%, 100%', '3x']}
HEAD = ("// The bots' exact flop strategies, condensed from open-source solver runs by tools/flops/batch.py (see its README).\n"
        "// Generated; do not edit by hand. null: no flop table, the bots use the GPU table (gto.js) or their own rules.\n")


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def size_key(amount, pot):
    """A bet as the game sees it (js/flops.js sizeKey): a third or three quarters of the pot, or all in."""
    frac = amount / pot
    if frac >= 1.2:
        return 'a'
    return '33' if abs(math.log(frac / .33)) < abs(math.log(frac / .75)) else '75'


def node_key(path, pot):
    """The flop decision a path of actions leads to (js/flops.js flopNode), or None for deeper ones."""
    bet = lambda a: a[0] in 'BA'
    if not path:
        return ''
    if path == ['X']:
        return 'x'
    if len(path) == 1 and bet(path[0]):
        return 'b' + size_key(int(path[0][1:]), pot)
    if len(path) == 2 and path[0] == 'X' and bet(path[1]):
        return 'xb' + size_key(int(path[1][1:]), pot)
    if len(path) == 2 and bet(path[0]) and path[1][0] in 'RA':
        return 'b' + size_key(int(path[0][1:]), pot) + 'r'
    if len(path) == 3 and path[0] == 'X' and bet(path[1]) and path[2][0] in 'RA':
        return 'xb' + size_key(int(path[1][1:]), pot) + 'r'
    return None


def slot(action, key, pot):
    """Where an action goes in the table's four slots: check, 1/3, 3/4, all in -- or fold, call, raise, all in."""
    facing = key.startswith('b') or key.startswith('xb')
    kind = action[0]
    if facing:
        return {'F': 0, 'C': 1, 'R': 2, 'A': 3}.get(kind)
    if kind == 'X':
        return 0
    if kind == 'A':
        return 3
    if kind == 'B':
        return {'33': 1, '75': 2, 'a': 3}[size_key(int(action[1:]), pot)]
    return None


def flop_text(flop):
    return ''.join(flop)


def jobs(lines, flops, accuracy, max_iters):
    scen = json.load(open(RANGES))
    for flop, _, _ in flops:              # round robin over the lines: a cut-short run still covers each one
        for line in lines:
            s = scen[line]
            yield line, flop, dict(flop=flop_text(flop), pot=round(s['pot'] * CHIPS), stack=round(s['stack'] * CHIPS),
                                   oop=s['oopText'], ip=s['ipText'], allin_threshold=1.5, accuracy=accuracy,
                                   max_iters=max_iters, depth=3, compress=False, **SIZES)


def run(args):
    if not os.path.exists(args.solver):
        sys.exit(f'{args.solver} not found: cargo build --release --manifest-path {os.path.join(HERE, "solver", "Cargo.toml")}')
    scen = json.load(open(RANGES))
    lines = list(scen) if args.lines == 'all' else args.lines.split(',')
    flops = pick_flops(args.flops)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'flops.json'), 'w') as f:
        json.dump([{'flop': flop_text(fl), 'weight': w, 'class': c} for fl, w, c in flops], f)
    todo = [(line, fl, job) for line, fl, job in jobs(lines, flops, args.accuracy, args.max_iters)
            if not os.path.exists(os.path.join(OUT, 'solves', line, flop_text(fl) + '.json'))]
    total = len(flops) * len(lines)
    workers = args.jobs or max(1, (os.cpu_count() or 1) // args.threads)
    log(f'{len(flops)} flops x {len(lines)} lines = {total} solves, {total - len(todo)} done already; '
        f'{workers} at a time, {args.threads} threads each')
    env = dict(os.environ, RAYON_NUM_THREADS=str(args.threads))

    def one(line, flop, job):
        dest = os.path.join(OUT, 'solves', line, flop_text(flop) + '.json')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
            json.dump(job, f)
            jpath = f.name
        t0 = time.time()
        p = subprocess.run([args.solver, jpath, dest + '.part'], env=env, capture_output=True, text=True)
        os.unlink(jpath)
        if p.returncode != 0:
            return line, flop, None, p.stderr.strip()[-500:]
        os.replace(dest + '.part', dest)
        with open(dest) as f:
            expl = json.load(f)['exploitability'] / job['pot'] * 100
        return line, flop, time.time() - t0, f'{expl:.2f}% pot'

    t0, done, failed = time.time(), 0, 0
    with ThreadPoolExecutor(workers) as ex:
        futs = [ex.submit(one, *t) for t in todo]
        for fu in as_completed(futs):
            line, flop, secs, note = fu.result()
            done += 1
            if secs is None:
                failed += 1
                log(f'  FAILED {line} {flop_text(flop)}: {note}')
                continue
            if done % args.report == 0 or done == len(todo):
                rate = (time.time() - t0) / done
                log(f'  {done}/{len(todo)} · {line} {flop_text(flop)} {secs:.0f}s, exploitability {note} · '
                    f'about {rate * (len(todo) - done) / 3600:.1f}h to go')
    log(f'done: {done - failed} solved, {failed} failed')


def table(args):
    flops = {f['flop']: f for f in json.load(open(os.path.join(OUT, 'flops.json')))}
    acc, out, counts = {}, {'v': 1, 'cats': CAT_NAMES, 'lines': {}, 'flops': {}}, {}
    for line in sorted(os.listdir(os.path.join(OUT, 'solves'))):
        d = os.path.join(OUT, 'solves', line)
        for name in sorted(os.listdir(d)):
            if not name.endswith('.json'):
                continue
            res = json.load(open(os.path.join(d, name)))
            meta = flops.get(res['flop'])
            if not meta:
                continue
            counts[line] = counts.get(line, 0) + 1
            board = [res['flop'][i:i + 2] for i in (0, 2, 4)]
            cls, pot, w_flop = board_class(board), res['pot'], meta['weight']
            cat_of = [[hand_category([h[:2], h[2:]], board) for h in res['hands'][p]] for p in (0, 1)]
            for node in res['nodes']:
                key = node_key(node['path'], pot)
                if key is None:
                    continue
                slots = [slot(a, key, pot) for a in node['actions']]
                hands, strat, weights = cat_of[node['player']], node['strategy'], node['weights']
                nh = len(hands)
                cell = acc.setdefault((line, f'{cls}:{key}'), [[0.0] * 5 for _ in range(CATS)])
                for h in range(nh):
                    wt = weights[h] * w_flop
                    if wt <= 0:
                        continue
                    row = cell[hands[h]]
                    row[4] += wt
                    for a, s in enumerate(slots):
                        if s is not None:
                            row[s] += wt * strat[a * nh + h]
    for (line, k), cell in acc.items():
        out['lines'].setdefault(line, {})[k] = [[round(x / r[4], 4) for x in r[:4]] if r[4] > 1e-6 else [] for r in cell]
    out['flops'] = counts
    with open(os.path.join(OUT, 'flop-table.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    for line in sorted(out['lines']):
        log(f'{line}: {counts.get(line, 0)} flops, {len(out["lines"][line])} board class x decision cells')


def show(args):
    t = json.load(open(os.path.join(OUT, 'flop-table.json')))
    cells = t['lines'][args.line]
    for k in sorted(cells, key=lambda k: (int(k.split(':')[0]), k)):
        if args.cls is not None and int(k.split(':')[0]) != args.cls:
            continue
        cls, node = k.split(':')
        facing = node.startswith('b') or node.startswith('xb')
        names = ('fold', 'call', 'raise', 'all-in') if facing else ('check', '1/3', '3/4', 'all-in')
        print(f'\nclass {cls}, decision "{node}"')
        for c, row in enumerate(cells[k]):
            if row:
                print(f'  {CAT_NAMES[c]:<30}' + '  '.join(f'{n} {p:4.0%}' for n, p in zip(names, row)))


def pack(args):
    if args.clear:
        table_obj = None
    else:
        t = json.load(open(os.path.join(OUT, 'flop-table.json')))
        lines = {}
        for line, cells in t['lines'].items():
            lines[line] = {}
            for k, rows in cells.items():
                data = bytearray()
                for row in rows:
                    tot = sum(row) if row else 0
                    data += bytes(min(255, round(x / tot * 255)) for x in row) if tot > 0 else bytes(4)
                lines[line][k] = base64.b64encode(bytes(data)).decode()
        table_obj = {'v': 1, 'cats': CATS, 'flops': t.get('flops', {}), 'lines': lines}
    text = json.dumps(table_obj, separators=(',', ':'))
    target = args.to or TARGET
    with open(target, 'w') as f:
        f.write(text if target.endswith('.json') else HEAD + 'export default ' + text + ';\n')
    log(f'wrote {os.path.normpath(target)} ({os.path.getsize(target) // 1024} KB)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--flops', type=int, default=320, help='about how many flops (spread over every board class)')
    r.add_argument('--lines', default='all', help='preflop lines, comma separated (default: all in ranges.json)')
    r.add_argument('--threads', type=int, default=8, help='threads per solve')
    r.add_argument('--jobs', type=int, default=0, help='solves at a time (0: cores / threads)')
    r.add_argument('--accuracy', type=float, default=0.005, help='target exploitability, share of the pot')
    r.add_argument('--max-iters', type=int, default=1000)
    r.add_argument('--report', type=int, default=10)
    r.add_argument('--solver', default=SOLVER)
    sub.add_parser('table')
    s = sub.add_parser('show')
    s.add_argument('line')
    s.add_argument('--cls', type=int)
    p = sub.add_parser('pack')
    p.add_argument('--to')
    p.add_argument('--clear', action='store_true')
    args = ap.parse_args()
    {'run': run, 'table': table, 'show': show, 'pack': pack}[args.cmd](args)


if __name__ == '__main__':
    main()
