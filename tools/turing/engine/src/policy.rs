//! Playing a blueprint: map the hand's real actions onto the abstract tree, look up the strategy for our class
//! (preflop) or bucket (after the flop), sample an action and turn it back into chips.
//!
//! Bets are compared as fractions of the pot: a bet's fraction is what it adds over a call, divided by the pot
//! after that call. A real size between two abstract sizes A < x < B maps to A with the pseudo-harmonic
//! probability ((B - x)(1 + A)) / ((B - A)(1 + x)) (Ganzfried & Sandholm 2013), so it cannot be exploited by
//! betting in between. Our own bets use the abstract fraction on the real pot.

use crate::abstraction::{bucket_with, Abs, FlopTable};
use crate::blueprint::{Blueprint, Kid, KID_FOLD, KID_NONE, KID_SHOW};
use crate::cards::{hand_cards, hand_index, preflop_class, NH};
use crate::opponent::{Kind, OppModel};
use crate::resolve::{build, solve, SAct, Spec};
use crate::showdown::{all_buckets, Board};
use crate::eval::texture;
use crate::game::{AKind, Decision, Spot};

/// a probability below this is dropped (noise in rarely visited rows), the rest renormalized
pub const THRESHOLD: f32 = 0.05;

pub struct Policy {
    pub bps: Vec<Blueprint>,
    pub flop: Option<FlopTable>,
    pub resolve: bool,
    pub budget: std::time::Duration,
    pub opp: OppModel,
    pub exploit: bool,
    rng: u64,
    cache: Option<(Vec<u8>, (u8, u8), usize, usize)>, // the last bucket computed: board, hole, abstraction size, bucket
}

#[derive(Clone, Copy, Debug)]
enum Pos { Pre(usize), Post(usize) }

/// size of a raise as a fraction of the pot after calling (contributions in big blinds)
fn frac(c: [f64; 2], p: usize, to: f64) -> f64 {
    let o = 1 - p;
    let call = (c[o] - c[p]).max(0.0);
    let pot_after = c[0] + c[1] + call;
    (to - c[o]) / pot_after.max(1e-9)
}

impl Policy {
    pub fn new(mut bps: Vec<Blueprint>, seed: u64) -> Policy {
        bps.sort_by(|a, b| a.stack.partial_cmp(&b.stack).unwrap());
        Policy { bps, flop: None, resolve: true, budget: std::time::Duration::from_millis(2000), opp: OppModel::default(), exploit: true, rng: seed | 1, cache: None }
    }

    pub fn coin(&mut self) -> f64 {
        self.rng ^= self.rng << 13;
        self.rng ^= self.rng >> 7;
        self.rng ^= self.rng << 17;
        (self.rng >> 11) as f64 / (1u64 << 53) as f64
    }

    /// the blueprint closest to the effective stack (in log terms)
    fn pick(&self, eff_bb: f64) -> Option<usize> {
        let x = eff_bb.max(1.0).ln();
        (0..self.bps.len()).min_by(|&a, &b| {
            let da = (self.bps[a].stack as f64).ln() - x;
            let db = (self.bps[b].stack as f64).ln() - x;
            da.abs().partial_cmp(&db.abs()).unwrap()
        })
    }

    /// choose among abstract sizes (fraction, child) for a real fraction x; u uniform in [0, 1)
    fn map_size(opts: &mut Vec<(f64, usize)>, x: f64, u: f64) -> Option<usize> {
        if opts.is_empty() { return None; }
        opts.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        if x <= opts[0].0 { return Some(opts[0].1); }
        let last = opts[opts.len() - 1];
        if x >= last.0 { return Some(last.1); }
        for w in opts.windows(2) {
            let (a, b) = (w[0].0, w[1].0);
            if x >= a && x <= b {
                let pa = ((b - x) * (1.0 + a)) / ((b - a) * (1.0 + x));
                return Some(if u < pa { w[0].1 } else { w[1].1 });
            }
        }
        Some(last.1)
    }

    /// walk the real actions down the abstract tree; None if the hand left the tree
    fn navigate(&mut self, bi: usize, s: &Spot) -> Option<(Pos, Vec<(Pos, usize)>)> {
        let mut pos = Pos::Pre(0);
        let mut path = Vec::with_capacity(s.hist.len());
        let mut real = [1.0f64, 0.5f64];
        for a in &s.hist {
            let u = self.coin();
            let bp = &self.bps[bi];
            match pos {
                Pos::Pre(n) => {
                    let node = &bp.pre[n];
                    if node.player != a.player { return None; }
                    let mut taken = 1;
                    let kid = match a.kind {
                        AKind::Fold => return None,
                        AKind::Check | AKind::Call => node.kids[1],
                        AKind::Raise | AKind::AllIn => {
                            let stack = bp.stack as f64;
                            let allin_x = frac([node.c[0] as f64, node.c[1] as f64], a.player, stack);
                            let mut opts = Vec::new();
                            if let Kid::Node(k) | Kid::Leaf(k) = node.kids[2] {
                                let to = match node.kids[2] { Kid::Node(_) => bp.pre[k].c[a.player], _ => bp.leaves[k].c[a.player] } as f64;
                                opts.push((frac([node.c[0] as f64, node.c[1] as f64], a.player, to), 2));
                            }
                            if node.kids[3] != Kid::None { opts.push((allin_x, 3)); }
                            let slot = if a.kind == AKind::AllIn && node.kids[3] != Kid::None {
                                3
                            } else {
                                let x = frac(real, a.player, a.total);
                                Self::map_size(&mut opts, x, u)?
                            };
                            taken = slot;
                            node.kids[slot]
                        }
                    };
                    path.push((pos, taken));
                    real[a.player] = a.total;
                    pos = match kid {
                        Kid::Node(k) => Pos::Pre(k),
                        Kid::Leaf(l) => {
                            let lf = &bp.leaves[l];
                            if lf.kind != 2 { return None; }
                            let root = bp.lines[lf.line as usize].root;
                            if root < 0 { return None; }
                            Pos::Post(root as usize)
                        }
                        Kid::None => return None,
                    };
                }
                Pos::Post(n) => {
                    let act = &bp.acts[n];
                    if act.player != a.player { return None; }
                    let slot = match a.kind {
                        AKind::Fold => return None,
                        AKind::Check | AKind::Call => 1,
                        AKind::Raise | AKind::AllIn => {
                            if a.kind == AKind::AllIn && act.kids[5] != KID_NONE {
                                5
                            } else {
                                let c = [act.c[0] as f64, act.c[1] as f64];
                                let mut opts = Vec::new();
                                for slot in 2..6 {
                                    let k = act.kids[slot];
                                    if k < 0 { continue; }
                                    let to = bp.acts[k as usize].c[a.player] as f64;
                                    opts.push((frac(c, a.player, to), slot));
                                }
                                let x = frac(real, a.player, a.total);
                                Self::map_size(&mut opts, x, u)?
                            }
                        }
                    };
                    real[a.player] = a.total;
                    path.push((pos, slot));
                    let k = act.kids[slot];
                    if k == KID_NONE || k == KID_FOLD || k == KID_SHOW { return None; }
                    pos = Pos::Post(k as usize);
                }
            }
        }
        Some((pos, path))
    }

    fn sample<const N: usize>(&mut self, mut p: [f32; N]) -> usize {
        let tot: f32 = p.iter().sum();
        if tot <= 0.0 { return 1; }
        for x in p.iter_mut() { *x /= tot; if *x < THRESHOLD { *x = 0.0; } }
        let tot: f32 = p.iter().sum();
        let mut r = self.coin() as f32 * tot;
        for (i, &x) in p.iter().enumerate() {
            if x > 0.0 { if r < x { return i; } r -= x; }
        }
        p.iter().rposition(|&x| x > 0.0).unwrap_or(1)
    }

    fn bucket_of(&mut self, s: &Spot, abs: &Abs) -> usize {
        if let Some((b, h, n, k)) = &self.cache {
            if *b == s.board && *h == s.hole && *n == abs.nb { return *k; }
        }
        let k = bucket_with(s.hole, &s.board, abs, self.flop.as_ref());
        self.cache = Some((s.board.clone(), s.hole, abs.nb, k));
        k
    }

    /// both players' reach for every hand (by hand number) after the hand's actions, from the blueprint
    fn ranges(&self, bi: usize, s: &Spot, path: &[(Pos, usize)]) -> [Vec<f32>; 2] {
        let bp = &self.bps[bi];
        let mut r = [vec![1f32; NH], vec![1f32; NH]];
        let mut bk: [Option<Vec<u8>>; 3] = [None, None, None];
        for (a, &(pos, slot)) in s.hist.iter().zip(path.iter()) {
            let p = a.player;
            match pos {
                Pos::Pre(n) => {
                    for h in 0..NH {
                        let (c1, c2) = hand_cards(h);
                        r[p][h] *= bp.pre_probs(n, preflop_class(c1, c2))[slot];
                    }
                }
                Pos::Post(n) => {
                    let st = bp.acts[n].street;
                    let board = &s.board[..3 + st];
                    if bk[st].is_none() { bk[st] = Some(all_buckets(board, &bp.abs, self.flop.as_ref())); }
                    let b = bk[st].as_ref().unwrap();
                    let tex = texture(board);
                    for h in 0..NH {
                        r[p][h] *= if b[h] == 255 { 0.0 } else { bp.post_probs(n, tex, b[h] as usize)[slot] };
                    }
                }
            }
        }
        r
    }

    /// re-solve the river from this decision with exact hands; None if anything does not fit
    fn river(&mut self, bi: usize, s: &Spot, path: &[(Pos, usize)]) -> Option<Decision> {
        if s.board.len() != 5 { return None; }
        let rr = self.ranges(bi, s, path);
        let board = Board::new(&s.board);
        let me = s.me;
        let o = 1 - me;
        let mut rv = [vec![0f32; board.nv], vec![0f32; board.nv]];
        for v in 0..board.nv {
            let h = board.hidx[v] as usize;
            rv[0][v] = rr[0][h];
            rv[1][v] = rr[1][h];
        }
        let mine = board.vh_of[hand_index(s.hole.0, s.hole.1)];
        if mine < 0 || rv[o].iter().sum::<f32>() <= 0.0 { return None; }
        if rv[me][mine as usize] <= 0.0 { rv[me][mine as usize] = 1e-3; }   // we got here, whatever the blueprint says
        let bb = s.bb as f64;
        let mut c = [0f64; 2];
        c[me] = s.contrib[me] * bb;
        c[o] = s.contrib[o] * bb;
        let mut bets = [0f64; 2];
        bets[me] = s.my_bet as f64;
        bets[o] = s.opp_bet as f64;
        let mut stack = [0f64; 2];
        stack[me] = c[me] + s.my_stack as f64;
        stack[o] = c[o] + s.opp_stack as f64;
        let spec = Spec {
            to_act: me, c, bets, stack,
            opp_acted: s.hist.iter().any(|a| a.street == 3 && a.player == o),
            min_raise: s.min_raise as f64,
            last_inc: (s.min_raise - s.opp_bet).max(s.bb) as f64,
            raises: s.raises,
        };
        let nodes = build(&spec);
        let (root, _iters) = solve(&nodes, &board, [&rv[0], &rv[1]], 4000, self.budget);
        let mut p = root[mine as usize].clone();
        if self.exploit {
            let kinds: Vec<Option<Kind>> = nodes[0].acts.iter().map(|a| Some(match a {
                SAct::Fold => Kind::Fold,
                SAct::Call | SAct::Check => Kind::Passive,
                SAct::Raise(_) => Kind::Aggro,
            })).collect();
            self.opp.adjust(&mut p, &kinds, crate::equity::strength(s.hole, &s.board), s.to_call > 0);
        }
        let tot: f32 = p.iter().sum();
        for x in p.iter_mut() { *x /= tot.max(1e-9); if *x < THRESHOLD { *x = 0.0; } }
        let tot: f32 = p.iter().sum();
        let mut r = self.coin() as f32 * tot;
        let mut pick = p.len() - 1;
        for (i, &x) in p.iter().enumerate() { if x > 0.0 { if r < x { pick = i; break; } r -= x; } }
        Some(match nodes[0].acts[pick] {
            SAct::Fold => s.legal(Decision::Fold),
            SAct::Call | SAct::Check => s.legal(Decision::Call),
            SAct::Raise(to) => s.legal(Decision::RaiseTo(to.round() as i64)),
        })
    }

    /// raise-to on this street, in chips, for a new hand total of `total_bb`
    fn to_chips(s: &Spot, total_bb: f64) -> i64 {
        let street_start = s.contrib[s.me] * s.bb as f64 - s.my_bet as f64;
        (total_bb * s.bb as f64 - street_start).round() as i64
    }

    /// the blueprint's decision, or None when the hand is outside what it covers
    pub fn decide(&mut self, s: &Spot) -> Option<Decision> {
        if self.bps.is_empty() { return None; }
        let bi = self.pick(s.eff_bb())?;
        let (pos, path) = self.navigate(bi, s)?;
        if s.street == 3 && self.resolve {
            if let Some(d) = self.river(bi, s, &path) { return Some(d); }
        }
        let bp = &self.bps[bi];
        let me = s.me;
        let o = 1 - me;
        match pos {
            Pos::Pre(n) => {
                if bp.pre[n].player != me || s.street != 0 { return None; }
                let node = bp.pre[n].clone();
                let cls = preflop_class(s.hole.0, s.hole.1);
                let mut p = bp.pre_probs(n, cls);
                if self.exploit { self.opp.adjust_pre(&mut p, crate::equity::preflop_equity()[cls], s.to_call > 0 && s.raises > 0); }
                for a in 0..4 { if node.kids[a] == Kid::None { p[a] = 0.0; } }
                let a = self.sample(p);
                Some(match a {
                    0 => s.legal(Decision::Fold),
                    1 => s.legal(Decision::Call),
                    2 => {
                        let k = match node.kids[2] { Kid::Node(k) => self.bps[bi].pre[k].c[me], Kid::Leaf(l) => self.bps[bi].leaves[l].c[me], Kid::None => 0.0 } as f64;
                        let f = frac([node.c[0] as f64, node.c[1] as f64], me, k);
                        let pot_after = s.contrib[0] + s.contrib[1] + (s.contrib[o] - s.contrib[me]).max(0.0);
                        s.legal(Decision::RaiseTo(Self::to_chips(s, s.contrib[o] + f * pot_after)))
                    }
                    _ => s.legal(Decision::RaiseTo(s.max_raise)),
                })
            }
            Pos::Post(n) => {
                let act = bp.acts[n].clone();
                if act.player != me || act.street + 1 != s.street { return None; }
                let abs = bp.abs.clone();
                let tex = texture(&s.board);
                let b = self.bucket_of(s, &abs);
                let mut p = self.bps[bi].post_probs(n, tex, b);
                for slot in 0..6 { if act.kids[slot] == KID_NONE { p[slot] = 0.0; } }
                if self.exploit {
                    // strength from the bucket: where its strength bin stands among all hands
                    let st = abs.strength(s.street, b);
                    const K: [Kind; 6] = [Kind::Fold, Kind::Passive, Kind::Aggro, Kind::Aggro, Kind::Aggro, Kind::Aggro];
                    let kinds: [Option<Kind>; 6] = std::array::from_fn(|i| (act.kids[i] != KID_NONE).then_some(K[i]));
                    self.opp.adjust(&mut p, &kinds, st, s.to_call > 0);
                }
                let slot = self.sample(p);
                Some(match slot {
                    0 => s.legal(Decision::Fold),
                    1 => s.legal(Decision::Call),
                    5 => s.legal(Decision::RaiseTo(s.max_raise)),
                    _ => {
                        let k = act.kids[slot] as usize;
                        let to = self.bps[bi].acts[k].c[me] as f64;
                        let f = frac([act.c[0] as f64, act.c[1] as f64], me, to);
                        let pot_after = s.contrib[0] + s.contrib[1] + (s.contrib[o] - s.contrib[me]).max(0.0);
                        s.legal(Decision::RaiseTo(Self::to_chips(s, s.contrib[o] + f * pot_after)))
                    }
                })
            }
        }
    }
}
