"""Print a trained table's common spots, to see that the strategy makes sense before shipping it.

  python3 show.py out/srp_ip.json [--tex 3]

For each spot, one line per hand bucket (weakest first): how often the hand checks or bets each size, or
folds, calls and raises. Flop and turn buckets come in pairs: made hand, then drawing hand of that strength.
Textures: 0 paired, 1 three of a suit, 2 straight-ish, 3 dry.
"""
import argparse
import json

from tree import key_of

NAMES = ('fold', 'call', 'small', 'medium', 'large', 'allin')


def row(probs, facing):
    if not probs:
        return '   (never reached)'
    if facing:
        f, c, r, ai = probs[0], probs[1], probs[2] + probs[3] + probs[4], probs[5]
        return f'   fold {f:4.0%}  call {c:4.0%}  raise {r:4.0%}  all-in {ai:4.0%}'
    return (f'   check {probs[1]:4.0%}  1/3 {probs[2]:4.0%}  3/4 {probs[3]:4.0%}  '
            f'1.25x {probs[4]:4.0%}  all-in {probs[5]:4.0%}')


def label(street, b):
    if street == 2:
        return f'river strength {b + 1:>2}/10'
    return f'strength {b // 2 + 1}/5 {"draw" if b % 2 else "made"}'


def show(d, title, street, player, tex, face, nb, init, sprs=(3, 2, 1, 0)):
    for spr in sprs:
        rows = d['keys'].get(str(key_of(street, player, tex, spr, face, nb, init)))
        if rows:
            print(f'\n{title}  (SPR class {spr})')
            for b, probs in enumerate(rows):
                print(f'  {label(street, b):<22}{row(probs, face > 0)}')
            return
    print(f'\n{title}: not in the table')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('table')
    ap.add_argument('--tex', type=int, default=3)
    a = ap.parse_args()
    d = json.load(open(a.table))
    agg = d['init']                    # the preflop raiser: 0 out of position, 1 in position
    caller = 1 - agg
    print(f'{d["scenario"]}: {d.get("about", "")} · {d["iters"]} iterations · texture {a.tex}')
    show(d, 'Flop, first to act (out of position)', 0, 0, a.tex, 0, 0, 1 if agg == 0 else 0)
    show(d, 'Flop, checked to the player in position', 0, 1, a.tex, 0, 0, 1 if agg == 1 else 0)
    show(d, 'Flop, the caller facing a 1/3-pot c-bet', 0, caller, a.tex, 1, 1, 0)
    show(d, 'Flop, the caller facing a 3/4-pot c-bet', 0, caller, a.tex, 2, 1, 0)
    show(d, 'Turn, the flop caller facing a 3/4-pot barrel', 1, caller, a.tex, 2, 1, 0, sprs=(2, 3, 1, 0))
    show(d, 'River, facing a 3/4-pot bet', 2, caller, a.tex, 2, 1, 0, sprs=(1, 2, 0, 3))
    show(d, 'River, facing a 1.25x-pot bet', 2, caller, a.tex, 3, 1, 0, sprs=(1, 2, 0, 3))


if __name__ == '__main__':
    main()
