//! A simple rule-based strategy: the fallback until the solver's blueprint is in, and a sparring
//! partner in the simulator. Preflop by equity against a random hand (push/fold when short),
//! postflop by exact (expected) strength against the pot odds, with some semi-bluffs and bluffs.

use crate::cards::preflop_class;
use crate::equity::{ehs, preflop_equity, strength};
use crate::game::{Decision, Spot};

fn raise_to(s: &Spot, total: f64) -> Decision { s.legal(Decision::RaiseTo(total.round() as i64)) }

pub fn decide(s: &Spot, coin: &mut dyn FnMut() -> f64) -> Decision {
    if s.street == 0 { preflop(s, coin) } else { postflop(s, coin) }
}

fn preflop(s: &Spot, coin: &mut dyn FnMut() -> f64) -> Decision {
    let eq = preflop_equity()[preflop_class(s.hole.0, s.hole.1)];
    let bb = s.bb as f64;
    let eff = s.eff_bb();
    let odds = s.to_call as f64 / (s.pot + s.to_call) as f64;
    let opened = s.raises > 0;
    if eff <= 12.0 {
        if !opened && s.button {
            return if eq >= 0.38 + 0.009 * eff { raise_to(s, s.max_raise as f64) } else { s.legal(Decision::Fold) };
        }
        if !opened {
            return if eq >= 0.55 { raise_to(s, s.max_raise as f64) } else { s.legal(Decision::Check) };
        }
        return if eq - 0.04 >= odds { s.legal(Decision::Call) } else { s.legal(Decision::Fold) };
    }
    if !opened && s.button {
        return if eq >= 0.45 { raise_to(s, 2.5 * bb) } else if eq >= 0.38 { s.legal(Decision::Call) } else { s.legal(Decision::Fold) };
    }
    if !opened {
        return if eq >= 0.56 || (eq >= 0.50 && coin() < 0.15) { raise_to(s, 4.0 * bb) } else { s.legal(Decision::Check) };
    }
    let commit = (s.opp_bet as f64) / (s.start_eff as f64);
    if s.raises == 1 {
        if eq >= 0.66 || (eq >= 0.52 && eq < 0.55 && coin() < 0.2) {
            let to = 3.0 * s.opp_bet as f64;
            return raise_to(s, if to > 0.4 * s.start_eff as f64 { s.max_raise as f64 } else { to });
        }
        return if eq >= (odds + 0.10).max(0.42) { s.legal(Decision::Call) } else { s.legal(Decision::Fold) };
    }
    if eq >= 0.72 { return raise_to(s, s.max_raise as f64); }
    if eq >= 0.60 + 0.1 * commit.min(1.0) && eq >= odds + 0.12 { return s.legal(Decision::Call); }
    s.legal(Decision::Fold)
}

fn postflop(s: &Spot, coin: &mut dyn FnMut() -> f64) -> Decision {
    let now = strength(s.hole, &s.board);
    let later = if s.street < 3 { ehs(s.hole, &s.board) } else { now };
    let pot = s.pot as f64;
    if s.to_call == 0 {
        if later >= 0.80 { return raise_to(s, if s.street == 3 { 0.75 } else { 0.66 } * pot); }
        if s.street < 3 && later - now >= 0.07 && coin() < 0.5 { return raise_to(s, 0.5 * pot); }
        if s.street == 3 && now <= 0.15 && coin() < 0.25 { return raise_to(s, 0.66 * pot); }
        if s.my_aggr_last && later >= 0.55 && coin() < 0.6 { return raise_to(s, 0.4 * pot); }
        return Decision::Check;
    }
    let before = (pot - s.to_call as f64).max(1.0);
    let odds = s.to_call as f64 / (pot + s.to_call as f64);
    let adj = later - 0.06 - 0.06 * (s.to_call as f64 / before).min(2.0) - 0.03 * s.opp_aggr.min(3) as f64;
    if adj >= 0.85 && s.can_raise { return raise_to(s, s.opp_bet as f64 + pot + s.to_call as f64); }
    if adj >= odds + 0.03 { s.legal(Decision::Call) } else { s.legal(Decision::Fold) }
}
