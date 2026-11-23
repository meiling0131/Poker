//! River re-solving: from the current decision, with both players' ranges (from the blueprint and the hand's
//! actions), the real pot and stacks and real bet sizes, solve the rest of the river with every hand separate
//! (no buckets) by vector-form Discounted CFR, then play our hand's average strategy.
use crate::showdown::Board;

/// what a subgame node is
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SKind { Act, Fold(usize), Show }

#[derive(Clone, Debug)]
pub struct SNode {
    pub kind: SKind,
    pub player: usize,
    pub c: [f64; 2],          // chips in the pot this hand (totals)
    pub bets: [f64; 2],       // this street
    pub kids: Vec<usize>,     // node indices; for an act node, actions in this order
    pub acts: Vec<SAct>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SAct { Fold, Call, Check, Raise(f64) }   // Raise: street raise-to in chips

pub struct Spec {
    pub to_act: usize,
    pub c: [f64; 2],
    pub bets: [f64; 2],
    pub stack: [f64; 2],       // chips each player started the hand with
    pub opp_acted: bool,       // the other player has acted on this street already
    pub min_raise: f64,        // our current minimum raise-to (street)
    pub last_inc: f64,         // last raise increment on the street (big blind before any)
    pub raises: u32,           // bets and raises on the street so far
}

const BET_FRACS: [f64; 3] = [0.33, 0.75, 1.25];
const RAISE_FRACS: [f64; 1] = [0.8];          // the first raise; after that only all in
const MAX_RAISES: u32 = 3;

pub fn build(spec: &Spec) -> Vec<SNode> {
    let mut nodes = Vec::new();
    fn rec(nodes: &mut Vec<SNode>, p: usize, c: [f64; 2], bets: [f64; 2], stack: [f64; 2], opp_acted: bool,
           min_raise: f64, last_inc: f64, raises: u32) -> usize {
        let id = nodes.len();
        nodes.push(SNode { kind: SKind::Act, player: p, c, bets, kids: vec![], acts: vec![] });
        let o = 1 - p;
        let to_call = (bets[o] - bets[p]).max(0.0);
        let behind = stack[p] - c[p];
        let mut kids = vec![];
        let mut acts = vec![];
        let terminal = |nodes: &mut Vec<SNode>, kind: SKind, c: [f64; 2], bets: [f64; 2]| {
            nodes.push(SNode { kind, player: p, c, bets, kids: vec![], acts: vec![] });
            nodes.len() - 1
        };
        if to_call > 0.0 {
            kids.push(terminal(nodes, SKind::Fold(p), c, bets));
            acts.push(SAct::Fold);
            let call = to_call.min(behind);
            let (mut c2, mut b2) = (c, bets);
            c2[p] += call;
            b2[p] += call;
            kids.push(terminal(nodes, SKind::Show, c2, b2));
            acts.push(SAct::Call);
        } else if opp_acted {
            kids.push(terminal(nodes, SKind::Show, c, bets));
            acts.push(SAct::Check);
        } else {
            let k = rec(nodes, o, c, bets, stack, true, bets[p].max(0.0) + last_inc, last_inc, raises);
            kids.push(k);
            acts.push(SAct::Check);
        }
        let opp_all_in = c[o] >= stack[o] - 1e-9;
        if !opp_all_in && behind > to_call && raises < MAX_RAISES {
            let pot = c[0] + c[1];
            let max_to = bets[p] + behind;
            let mut tos: Vec<f64> = if to_call == 0.0 {
                BET_FRACS.iter().map(|f| bets[p] + f * pot).collect()
            } else if raises <= 1 {
                RAISE_FRACS.iter().map(|f| bets[o] + f * (pot + to_call)).collect()
            } else {
                vec![]
            };
            tos.retain(|&x| x >= min_raise - 1e-9 && x < 0.8 * max_to);
            tos.push(max_to);
            tos.dedup_by(|a, b| (*a - *b).abs() < 0.5);
            for to in tos {
                let (mut c2, mut b2) = (c, bets);
                c2[p] += to - bets[p];
                b2[p] = to;
                let inc = (to - bets[o]).max(last_inc);
                let k = rec(nodes, o, c2, b2, stack, true, to + inc, inc, raises + 1);
                kids.push(k);
                acts.push(SAct::Raise(to));
            }
        }
        nodes[id].kids = kids;
        nodes[id].acts = acts;
        id
    }
    rec(&mut nodes, spec.to_act, spec.c, spec.bets, spec.stack, spec.opp_acted, spec.min_raise, spec.last_inc, spec.raises);
    nodes
}

/// solve; ranges by vh of `board`; returns the root's average strategy for every vh: [vh][action]
pub fn solve(nodes: &[SNode], board: &Board, ranges: [&[f32]; 2], max_iters: usize, budget: std::time::Duration) -> (Vec<Vec<f32>>, usize) {
    let (avg, it) = solve_all(nodes, board, ranges, max_iters, budget);
    let k = nodes[0].kids.len();
    let n = board.nv;
    ((0..n).map(|h| avg[0][h * k..h * k + k].to_vec()).collect(), it)
}

/// every node's average strategy [node][vh * actions + a]
pub fn solve_all(nodes: &[SNode], board: &Board, ranges: [&[f32]; 2], max_iters: usize, budget: std::time::Duration) -> (Vec<Vec<f32>>, usize) {
    let n = board.nv;
    let nn = nodes.len();
    let nact: Vec<usize> = nodes.iter().map(|x| x.kids.len()).collect();
    let mut regret: Vec<Vec<f32>> = (0..nn).map(|i| vec![0f32; n * nact[i]]).collect();
    let mut ssum: Vec<Vec<f32>> = (0..nn).map(|i| vec![0f32; n * nact[i]]).collect();
    let mut reach = vec![[vec![0f32; n], vec![0f32; n]]; nn];
    let mut val = vec![[vec![0f32; n], vec![0f32; n]]; nn];
    let mut sig: Vec<Vec<f32>> = (0..nn).map(|i| vec![0f32; n * nact[i]]).collect();
    let (mut l, mut e, mut t) = (vec![0f32; n], vec![0f32; n], vec![0f32; n]);
    let start = std::time::Instant::now();
    let mut it = 0;
    while it < max_iters && (it < 20 || start.elapsed() < budget) {
        it += 1;
        // strategies by regret matching
        for i in 0..nn {
            let k = nact[i];
            if k == 0 { continue; }
            let (r, s) = (&regret[i], &mut sig[i]);
            for h in 0..n {
                let row = &r[h * k..h * k + k];
                let tot: f32 = row.iter().map(|&x| x.max(0.0)).sum();
                for a in 0..k { s[h * k + a] = if tot > 0.0 { row[a].max(0.0) / tot } else { 1.0 / k as f32 }; }
            }
        }
        // reach, top down (children come after their parent)
        reach[0][0].copy_from_slice(ranges[0]);
        reach[0][1].copy_from_slice(ranges[1]);
        for i in 0..nn {
            if nodes[i].kind != SKind::Act { continue; }
            let p = nodes[i].player;
            let k = nact[i];
            for (a, &kid) in nodes[i].kids.iter().enumerate() {
                let (src, dst) = if i < kid { let (x, y) = reach.split_at_mut(kid); (&x[i], &mut y[0]) } else { unreachable!() };
                dst[1 - p].copy_from_slice(&src[1 - p]);
                for h in 0..n { dst[p][h] = src[p][h] * sig[i][h * k + a]; }
            }
        }
        // values, bottom up
        for i in (0..nn).rev() {
            match nodes[i].kind {
                SKind::Fold(f) => {
                    let loss = nodes[i].c[f] as f32;
                    for x in 0..2 {
                        board.totals(&reach[i][1 - x], &mut t);
                        let sgn = if x == f { -loss } else { loss };
                        for h in 0..n { val[i][x][h] = sgn * t[h]; }
                    }
                }
                SKind::Show => {
                    let c = nodes[i].c[0].min(nodes[i].c[1]) as f32;
                    for x in 0..2 {
                        board.lte(&reach[i][1 - x], &mut l, &mut e, &mut t);
                        for h in 0..n { val[i][x][h] = c * (2.0 * l[h] + e[h] - t[h]); }
                    }
                }
                SKind::Act => {
                    let p = nodes[i].player;
                    let k = nact[i];
                    let mut vp = vec![0f32; n];
                    let mut vo = vec![0f32; n];
                    for (a, &kid) in nodes[i].kids.iter().enumerate() {
                        let cv = &val[kid];
                        for h in 0..n {
                            vp[h] += sig[i][h * k + a] * cv[p][h];
                            vo[h] += cv[1 - p][h];
                        }
                    }
                    // DCFR: positive regrets times t^1.5/(t^1.5+1), negative ones halved, sums weighted (t/(t+1))^2
                    let tt = it as f32;
                    let pos = tt.powf(1.5) / (tt.powf(1.5) + 1.0);
                    let sw = (tt / (tt + 1.0)).powi(2);
                    for (a, &kid) in nodes[i].kids.iter().enumerate() {
                        let cvp = &val[kid][p];
                        for h in 0..n {
                            let r = &mut regret[i][h * k + a];
                            *r = if *r > 0.0 { *r * pos } else { *r * 0.5 } + (cvp[h] - vp[h]);
                            let s = &mut ssum[i][h * k + a];
                            *s = *s * sw + reach[i][p][h] * sig[i][h * k + a];
                        }
                    }
                    val[i][p] = vp;
                    val[i][1 - p] = vo;
                }
            }
        }
    }
    let avg: Vec<Vec<f32>> = (0..nn).map(|i| {
        let k = nact[i];
        let mut out = vec![0f32; n * k];
        for h in 0..n {
            let row = &ssum[i][h * k..h * k + k];
            let tot: f32 = row.iter().sum();
            for a in 0..k { out[h * k + a] = if tot > 0.0 { row[a] / tot } else { 1.0 / k as f32 }; }
        }
        out
    }).collect();
    (avg, it)
}

/// what each player gains by best-responding to the other's strategy `strat` (from solve_all), in chips per
/// unit of joint range; their sum is the profile's exploitability
pub fn best_response(nodes: &[SNode], board: &Board, ranges: [&[f32]; 2], strat: &[Vec<f32>]) -> [f64; 2] {
    let n = board.nv;
    let nn = nodes.len();
    let (mut l, mut e, mut t) = (vec![0f32; n], vec![0f32; n], vec![0f32; n]);
    let mut out = [0f64; 2];
    for x in 0..2 {
        let o = 1 - x;
        // the opponent's reach at every node from its strategy
        let mut ro = vec![vec![0f32; n]; nn];
        ro[0].copy_from_slice(ranges[o]);
        for i in 0..nn {
            if nodes[i].kind != SKind::Act { continue; }
            let k = nodes[i].kids.len();
            for (a, &kid) in nodes[i].kids.iter().enumerate() {
                for h in 0..n { ro[kid][h] = ro[i][h] * if nodes[i].player == o { strat[i][h * k + a] } else { 1.0 }; }
            }
        }
        let mut v = vec![vec![0f32; n]; nn];
        for i in (0..nn).rev() {
            match nodes[i].kind {
                SKind::Fold(f) => {
                    board.totals(&ro[i], &mut t);
                    let loss = nodes[i].c[f] as f32;
                    for h in 0..n { v[i][h] = if x == f { -loss } else { loss } * t[h]; }
                }
                SKind::Show => {
                    board.lte(&ro[i], &mut l, &mut e, &mut t);
                    let c = nodes[i].c[0].min(nodes[i].c[1]) as f32;
                    for h in 0..n { v[i][h] = c * (2.0 * l[h] + e[h] - t[h]); }
                }
                SKind::Act => {
                    let mine = nodes[i].player == x;
                    for h in 0..n {
                        let mut acc = if mine { f32::MIN } else { 0.0 };
                        for &kid in &nodes[i].kids { if mine { acc = acc.max(v[kid][h]); } else { acc += v[kid][h]; } }
                        v[i][h] = acc;
                    }
                }
            }
        }
        board.lte(ranges[o], &mut l, &mut e, &mut t);
        let joint: f64 = (0..n).map(|h| ranges[x][h] as f64 * t[h] as f64).sum();
        out[x] = (0..n).map(|h| ranges[x][h] as f64 * v[0][h] as f64).sum::<f64>() / joint.max(1e-12);
    }
    out
}
