# turing

turing is the game's heads-up bot. Its strategy was trained offline by counterfactual regret minimisation on one GPU,
and in the browser it plays that strategy from a WebAssembly module at the **单挑** (heads-up) practice table
(`js/turing.js`, files in `js/turing/`). At the 7-handed tables it sits in 奶龙's old seat and plays the bots' common
core (`js/bots.js`), because its trained strategy is for two players only.

```
engine/     the bot (Rust): cards, hand values, exact equity, the card abstraction, blueprint lookup, action
            mapping, the opponent model, a river re-solver (not used in the browser)
web/        the engine as a WebAssembly module with a plain C interface (what js/turing.js calls)
trainer/    the trainer: the abstract game (Python), the GPU solver (CUDA), checkpoint -> blueprint
build.sh    rebuilds js/turing/turing.wasm, and js/turing/blueprints.bin from a folder of blueprints
pack.py     packs bp*.bin into js/turing/blueprints.bin
```

## The game it was trained on

Heads-up no-limit hold'em, blinds ½ and 1 big blind, the same effective stack for both players. One blueprint per
stack depth: 7, 12, 20, 35, 60 and 100 big blinds. At the table turing uses the depth nearest the hand's effective
stack.

- **Before the flop** the small blind can fold, limp, raise to 2.5 BB or go all in; the big blind raises a limp to
  4 BB. Up to three sized raises, then only all in. This part is solved on the host with every hand on its own
  (169 classes, no card abstraction).
- **After the flop** bets are 33%, 75% and 125% of the pot on the flop and turn, and 50% and 100% on the river; a raise
  is a call plus a share of the pot, and a bet that would put in 60% or more of what is left is all in.
- **Card abstraction.** Hands are grouped into buckets by their exact expected river strength (2 × wins + ties against
  every opponent hand, averaged over every runout: no sampling) and the board's texture (paired, three of a suit,
  three to a straight, dry). The blueprints in `js/turing/` use 10 buckets per street: on the flop and turn 5 bins
  of expected strength × a draw flag (expected minus current strength above 0.05), on the river 10 bins of strength.
  The trainer here makes 24: 8 bins of expected strength, narrower among the strong hands, × 3 bins of potential
  (expected minus current strength) inside each; 24 bins on the river. The engine reads both kinds.

## How it was trained

Discounted CFR (α = 1.5, β = 0, γ = 2) in vector form: both players' 1,081 hands at once, 8,192 boards dealt at random
per iteration (public chance sampling), exact card removal. Each board is one CUDA thread block walking the
postflop trees as a compiled program; strategy work is done per bucket, per-hand work only at folds, showdowns and
street changes. `trainer/test_hu.py` checks a walk against the reference solver in `tools/solver/solve.py`
(agreement to about 1e-7).

The blueprints in `js/turing/` came from one H100: 20 minutes for 7 BB (15,444 iterations), 20 for 12 BB (6,998),
30 for 20 BB (5,358), 45 for 35 BB (4,411), 60 for 60 BB (3,626) and 120 for 100 BB (4,838).

## Playing

For each decision the engine replays the hand on the abstract tree. Real bets are compared with the abstract ones as
fractions of the pot; a size between two abstract sizes is mapped to one of them with the pseudo-harmonic
probability (Ganzfried & Sandholm 2013), so betting in between gains nothing. It looks up the strategy of its bucket,
drops actions under 5% and samples one.

It also keeps count of how you play: how often you fold to a bet, raise a bet, bet when checked to, fold to a raise
before the flop and raise before the flop, and how strong the hands are that call its river bets. Every count starts
from what balanced play shows, worth ten hands, and a rate near the balanced one changes nothing. A clear leak moves
probability between folding, calling and raising, at most 80% of any action: no bluffs and bigger value bets against
a player who calls too much, more bluffs against one who folds too much, wider calls against one who bets too much.
In simulation against itself it loses nothing to this (−0.5 ± 2.6 bb/100), and against simple opponents it wins
far more: against a player who always calls +459 instead of +131 bb/100, against one who always raises the pot +351
instead of +171 (60 BB).

The browser build leaves out two things the stand-alone bot has: re-solving the river, and the 29 MB flop table (the
flop bucket is computed exactly instead, about 60 ms).

## Rebuilding

```
rustup target add wasm32-unknown-unknown
tools/turing/build.sh                         # the engine only: js/turing/turing.wasm
tools/turing/build.sh <folder with bp*.bin>   # and the blueprints: js/turing/blueprints.bin
```

Then bump `VER` in `js/turing.js` and run `npm run stamp`. `cargo test` in this folder runs the engine's tests; set
`BUCKETS` to a bucket file (and `FLOP_TABLE` to a flop table) to check the runtime buckets against the training's.

## Training

```
tools/turing/trainer/train.sh "7:20 12:25 20:35 35:50 60:80 100:180"
tools/turing/build.sh tools/turing/trainer/out/blueprints
```

`train.sh` builds the CUDA solver (`trainer/cuda`, for an H100), makes the bucket tables once (every flop and turn
with every runout, a few seconds), checks the kernel against `tools/solver/solve.py`, then trains each stack depth for
its minutes. Run again, it resumes each depth from its checkpoint.
