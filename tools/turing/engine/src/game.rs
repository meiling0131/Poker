//! One decision, in chips, independent of where it came from (Chipzen's GameState or the local simulator).

/// one real action of the hand; players as in the blueprint: 0 big blind, 1 small blind / button
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AKind { Fold, Check, Call, Raise, AllIn }

#[derive(Clone, Copy, Debug)]
pub struct HAct {
    pub street: usize,
    pub player: usize,
    pub kind: AKind,
    pub total: f64,   // the player's chips in the pot this hand after the action, in big blinds
}

#[derive(Clone, Debug)]
pub struct Spot {
    pub hole: (u8, u8),
    pub board: Vec<u8>,
    pub street: usize,      // 0 preflop, 1 flop, 2 turn, 3 river
    pub pot: i64,           // all chips in the pot, this street's bets included
    pub to_call: i64,
    pub my_stack: i64,      // chips behind
    pub opp_stack: i64,
    pub my_bet: i64,        // put in on this street
    pub opp_bet: i64,
    pub min_raise: i64,     // raise-to bounds
    pub max_raise: i64,
    pub bb: i64,
    pub button: bool,       // small blind / button
    pub can_raise: bool,
    pub raises: u32,        // bets and raises so far on this street (the big blind not counted)
    pub opp_aggr: u32,      // the opponent's bets and raises this hand
    pub my_aggr_last: bool, // I was the last aggressor on the previous street (or preflop raiser on the flop)
    pub start_eff: i64,     // effective stack at the start of the hand
    pub me: usize,          // 0 big blind, 1 small blind / button
    pub hist: Vec<HAct>,    // every action this hand (blinds not included)
    pub contrib: [f64; 2],  // chips in the pot this hand by player, big blinds
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    Fold,
    Check,
    Call,
    RaiseTo(i64),
}

impl Spot {
    pub fn eff_bb(&self) -> f64 { self.start_eff as f64 / self.bb as f64 }
    /// a legal action closest to the wish
    pub fn legal(&self, d: Decision) -> Decision {
        match d {
            Decision::RaiseTo(x) if self.can_raise && self.max_raise > 0 => {
                let lo = self.min_raise.max(1).min(self.max_raise);   // min > max: only the all-in is left
                let mut a = x.clamp(lo, self.max_raise);
                if a as f64 >= 0.85 * self.max_raise as f64 { a = self.max_raise; }
                Decision::RaiseTo(a)
            }
            Decision::RaiseTo(_) | Decision::Call if self.to_call == 0 => Decision::Check,
            Decision::RaiseTo(_) => Decision::Call,
            Decision::Fold if self.to_call == 0 => Decision::Check,
            Decision::Check if self.to_call > 0 => Decision::Fold,
            other => other,
        }
    }
}
