//! What the opponent does, counted over the match, and bounded shifts of our strategy against it.
//!
//! Every rate starts from what balanced play shows (measured on the blueprint playing itself), worth
//! `cfg.prior` hands, so a handful of hands moves nothing; and rates near the balanced ones move nothing at all (a dead
//! zone), so a balanced opponent is met with the blueprint as it is and only a clear leak is attacked. The shifts move probability between folding, passive play (check / call)
//! and aggression, by how strong our hand is; at most a fixed share of any probability moves, so the strategy
//! never leaves equilibrium play entirely.
use crate::equity::strength;
use crate::game::{AKind, HAct};

/// knobs for experiments; the defaults are what the bot plays with
#[derive(Clone, Copy, Debug)]
pub struct OppCfg {
    pub prior: f64,          // hands' worth of balanced behaviour every rate starts from
    pub bluff_raise: bool,   // raise as a bluff against a player who folds too much
}
impl Default for OppCfg { fn default() -> Self { OppCfg { prior: 10.0, bluff_raise: true } } }
// balanced rates, from the blueprint playing itself at 7 to 35 big blinds
const PRE_RAISE: f64 = 0.27;     // share of preflop decisions that raise
const FOLD_PRE: f64 = 0.58;      // folds when facing our preflop raise
const FOLD_OPEN: f64 = 0.35;     // folds when facing our first preflop raise
const AGGR: f64 = 0.40;          // bets when checked to after the flop
const CALL_HS: f64 = 0.69;       // strength of the hands that call our river bets

/// move a share of every smaller bet into the biggest one (all-in included)
fn size_up(p: &mut [f32], kinds: &[Option<Kind>], share: f64) {
    let ag: Vec<usize> = (0..kinds.len()).filter(|&i| kinds[i] == Some(Kind::Aggro)).collect();
    let Some(&big) = ag.last() else { return };
    let share = share.clamp(0.0, 0.8) as f32;
    for &i in &ag[..ag.len() - 1] {
        let m = p[i] * share;
        p[i] -= m;
        p[big] += m;
    }
}

#[derive(Default, Clone, Debug)]
pub struct OppModel {
    pub cfg: OppCfg,
    pub hands: u32,
    pub faced_bets: u32,     // after the flop, facing our bet or raise
    pub folded_to_bet: u32,
    pub raised_vs_bet: u32,
    pub bet_opps: u32,       // after the flop, nothing to call
    pub bets: u32,
    pub faced_raise_pre: u32, // preflop, facing our raise
    pub folded_to_raise_pre: u32,
    pub pre_acts: u32,       // preflop decisions
    pub pre_raises: u32,
    pub faced_open: u32,     // preflop, facing our first raise
    pub folded_to_open: u32,
    pub sd_calls: u32,       // showdowns where they called our last river bet
    pub sd_call_hs: f64,
}

#[derive(Clone, Copy, Debug)]
pub struct Profile {
    pub fold_vs_bet: f64,
    pub raise_vs_bet: f64,
    pub aggr: f64,
    pub fold_vs_raise_pre: f64,
    pub fold_vs_open: f64,
    pub pre_raise: f64,
    pub call_hs: f64,
}

/// how far a rate is from the balanced one beyond a dead zone, scaled to [-1, 1]
fn dev(x: f64, center: f64, dead: f64, scale: f64) -> f64 {
    let d = x - center;
    (d.signum() * (d.abs() - dead).max(0.0) / scale).clamp(-1.0, 1.0)
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind { Fold, Passive, Aggro }

fn smooth(k: u32, n: u32, rate: f64, prior: f64) -> f64 { (k as f64 + rate * prior) / (n as f64 + prior) }

impl OppModel {
    /// one finished hand: every action (players 0 big blind, 1 small blind), which one we are, and the
    /// opponent's cards and the board when they were shown down
    pub fn observe(&mut self, hist: &[HAct], me: usize, shown: Option<(u8, u8)>, board: &[u8]) {
        let opp = 1 - me;
        let mut cur = [1.0f64, 0.5f64];
        let mut street_start = [0.0f64, 0.0f64];
        let mut street = 0usize;
        let mut last_aggr: Option<usize> = None;
        let mut raises = 0u32;      // this street
        for a in hist {
            if a.street != street {
                street = a.street;
                street_start = cur;
                last_aggr = None;
                raises = 0;
            }
            let bets = [cur[0] - street_start[0], cur[1] - street_start[1]];
            let to_call = bets[1 - a.player] - bets[a.player];
            let aggro = matches!(a.kind, AKind::Raise | AKind::AllIn);
            if a.player == opp {
                if street == 0 {
                    self.pre_acts += 1;
                    self.pre_raises += aggro as u32;
                    if to_call > 1e-9 && last_aggr == Some(me) {
                        self.faced_raise_pre += 1;
                        self.folded_to_raise_pre += (a.kind == AKind::Fold) as u32;
                        if raises == 1 {
                            self.faced_open += 1;
                            self.folded_to_open += (a.kind == AKind::Fold) as u32;
                        }
                    }
                } else if to_call > 1e-9 {
                    self.faced_bets += 1;
                    self.folded_to_bet += (a.kind == AKind::Fold) as u32;
                    self.raised_vs_bet += aggro as u32;
                } else {
                    self.bet_opps += 1;
                    self.bets += aggro as u32;
                }
            }
            cur[a.player] = a.total;
            if aggro { last_aggr = Some(a.player); raises += 1; }
        }
        if let (Some(cards), Some(last)) = (shown, hist.last()) {
            if board.len() == 5 && last.player == opp && last.kind == AKind::Call && last_aggr == Some(me) && last.street == 3 {
                self.sd_calls += 1;
                self.sd_call_hs += strength(cards, board);
            }
        }
        self.hands += 1;
    }

    pub fn profile(&self) -> Profile {
        Profile {
            fold_vs_bet: smooth(self.folded_to_bet, self.faced_bets, 0.45, self.cfg.prior),
            raise_vs_bet: smooth(self.raised_vs_bet, self.faced_bets, 0.08, self.cfg.prior),
            aggr: smooth(self.bets, self.bet_opps, AGGR, self.cfg.prior),
            fold_vs_raise_pre: smooth(self.folded_to_raise_pre, self.faced_raise_pre, FOLD_PRE, self.cfg.prior),
            fold_vs_open: smooth(self.folded_to_open, self.faced_open, FOLD_OPEN, self.cfg.prior),
            pre_raise: smooth(self.pre_raises, self.pre_acts, PRE_RAISE, self.cfg.prior),
            call_hs: (self.sd_call_hs + CALL_HS * 6.0) / (self.sd_calls as f64 + 6.0),
        }
    }

    /// shift probabilities after the flop; kinds: what each action is, None where it is not allowed;
    /// strength of our hand in [0, 1]; facing: a bet to call
    pub fn adjust(&self, p: &mut [f32], kinds: &[Option<Kind>], strength: f64, facing: bool) {
        let pr = self.profile();
        // > 0: they fold too much (bluff more); < 0: they call too much (bluff less, value bet thinner)
        let mut bluff = dev(pr.fold_vs_bet, 0.45, 0.06, 0.20);
        if pr.call_hs < 0.60 { bluff = (bluff - (0.60 - pr.call_hs) * 5.0).max(-1.0); }
        // > 0: they bet a lot (their bets are weaker, call wider); < 0: they rarely bet (their bets are strong)
        let wide = dev(pr.aggr, AGGR, 0.07, 0.25);
        let idx = |k: Kind| kinds.iter().enumerate().filter(move |(_, &x)| x == Some(k)).map(|(i, _)| i);
        let mass = |p: &[f32], k: Kind| idx(k).map(|i| p[i]).sum::<f32>();
        let mv = |p: &mut [f32], from: Kind, to: Kind, share: f64| {
            let share = share.clamp(0.0, 0.8) as f32;
            let m = mass(p, from) * share;
            let tot_to = mass(p, to);
            let Some(first) = idx(to).next() else { return };
            if m <= 0.0 { return; }
            for i in idx(from) { p[i] *= 1.0 - share; }
            // in proportion to what is already there; into the first (smallest) action of the kind when nothing is
            if tot_to > 0.0 { for i in idx(to) { p[i] += m * p[i] / tot_to; } } else { p[first] += m; }
        };
        if !facing {
            if bluff < 0.0 && strength < 0.45 { mv(p, Kind::Aggro, Kind::Passive, -bluff); }       // no bluffs into a station
            if bluff < 0.0 && strength > 0.62 { mv(p, Kind::Passive, Kind::Aggro, -bluff * 0.6); } // thinner value
            if bluff < 0.0 && strength > 0.75 { size_up(p, kinds, -bluff * 0.6); }                 // and bigger
            if bluff > 0.0 && strength < 0.45 { mv(p, Kind::Passive, Kind::Aggro, bluff * 0.5); }  // bluff an over-folder
        } else {
            if wide > 0.0 && strength > 0.30 { mv(p, Kind::Fold, Kind::Passive, wide * 0.7); }      // catch the maniac
            if wide < 0.0 && strength < 0.60 { mv(p, Kind::Passive, Kind::Fold, -wide * 0.5); }     // a rare bet is strong
            if bluff < 0.0 && strength < 0.50 { mv(p, Kind::Aggro, Kind::Passive, -bluff); }       // no bluff raises
            // raise as a bluff against one who bets a lot and folds a lot: their bets are often weak (one who rarely
            // bets has it when they do)
            if bluff > 0.0 && wide > 0.0 && strength < 0.30 && self.cfg.bluff_raise { mv(p, Kind::Fold, Kind::Aggro, bluff.min(wide) * 0.3); }
        }
    }

    /// preflop (fold, call, raise, all-in): steal more from a player who folds to raises, less from one who never
    /// does; against raises, defend wider when they raise nearly everything, tighter when they rarely raise
    pub fn adjust_pre(&self, p: &mut [f32; 4], eq: f64, facing_raise: bool) {
        let pr = self.profile();
        let (fold, limp, raise) = (0usize, 1usize, 2usize);
        if facing_raise {
            let wide = dev(pr.pre_raise, PRE_RAISE, 0.10, 0.25) as f32;
            if wide > 0.0 && eq >= 0.40 {
                let m = p[fold] * wide * 0.6;
                p[fold] -= m;
                p[limp] += m;
            } else if wide < 0.0 && eq < 0.55 {
                let m = p[limp] * -wide * 0.4;
                p[limp] -= m;
                p[fold] += m;
            }
            return;
        }
        let dev = dev(pr.fold_vs_raise_pre, FOLD_PRE, 0.10, 0.20) as f32;
        if dev > 0.0 {
            let m = (p[fold] + p[limp] * 0.5) * dev * 0.6;
            p[fold] *= 1.0 - dev * 0.6;
            p[limp] *= 1.0 - dev * 0.3;
            p[raise] += m;
        } else if dev < 0.0 && eq < 0.45 {
            let m = p[raise] * -dev * 0.6;
            p[raise] -= m;
            p[limp] += m;
        }
    }
}
