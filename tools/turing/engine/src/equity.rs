//! Exact hand strength, the same definitions and integer numerators as the CUDA solver:
//!   strength now  = (2L + E) / (2T) against every valid opponent hand (exact card removal);
//!   expected river strength (EHS) = the exact average of the river strength over every runout.
//! Keeping the integers lets the bot bucket a hand exactly as training did.

use crate::cards::mask;
use crate::eval::eval;
use std::sync::OnceLock;

/// cards not in `used`, ascending
pub fn rest(used: u64) -> Vec<u8> { (0..52u8).filter(|&c| used >> c & 1 == 0).collect() }

/// 2L + E against all opponent hands that miss board and hand, and their count T
pub fn strength_num(h: (u8, u8), board: &[u8]) -> (u32, u32) {
    let mut cs = [0u8; 7];
    cs[0] = h.0;
    cs[1] = h.1;
    cs[2..2 + board.len()].copy_from_slice(board);
    let n = 2 + board.len();
    let me = eval(&cs[..n]);
    let r = rest(mask(board) | mask(&[h.0, h.1]));
    let (mut k, mut t) = (0u32, 0u32);
    for i in 0..r.len() {
        for j in i + 1..r.len() {
            cs[0] = r[i];
            cs[1] = r[j];
            let v = eval(&cs[..n]);
            k += if me > v { 2 } else if me == v { 1 } else { 0 };
            t += 1;
        }
    }
    (k, t)
}

pub fn strength(h: (u8, u8), board: &[u8]) -> f64 {
    let (k, t) = strength_num(h, board);
    k as f64 / (2.0 * t as f64)
}

/// sum over runouts of the river 2L+E, and the number of runouts (1081 on the flop, 46 on the turn)
pub fn ehs_num(h: (u8, u8), board: &[u8]) -> (u64, u32) {
    let r = rest(mask(board) | mask(&[h.0, h.1]));
    let mut full = [0u8; 5];
    full[..board.len()].copy_from_slice(board);
    let (mut sum, mut n) = (0u64, 0u32);
    match board.len() {
        3 => {
            for i in 0..r.len() {
                for j in i + 1..r.len() {
                    full[3] = r[i];
                    full[4] = r[j];
                    sum += strength_num(h, &full).0 as u64;
                    n += 1;
                }
            }
        }
        4 => {
            for &c in &r {
                full[4] = c;
                sum += strength_num(h, &full).0 as u64;
                n += 1;
            }
        }
        _ => {
            let (k, _) = strength_num(h, board);
            return (k as u64, 1);
        }
    }
    (sum, n)
}

/// expected river strength in [0, 1]
pub fn ehs(h: (u8, u8), board: &[u8]) -> f64 {
    let (s, n) = ehs_num(h, board);
    s as f64 / (n as f64 * 1980.0)
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

/// equity of each of the 169 preflop classes against a random hand (Monte Carlo, fixed seed)
pub fn preflop_equity() -> &'static [f64; 169] {
    static T: OnceLock<[f64; 169]> = OnceLock::new();
    T.get_or_init(|| {
        let mut eq = [0f64; 169];
        let mut rng = Rng(0x9E3779B97F4A7C15);
        let samples = 6000;
        // one representative hand per class
        let mut rep = [(0u8, 0u8); 169];
        for a in 0..52u8 { for b in a + 1..52 { rep[crate::cards::preflop_class(a, b)] = (a, b); } }
        for (cls, &(a, b)) in rep.iter().enumerate() {
            let used0 = mask(&[a, b]);
            let mut w = 0f64;
            for _ in 0..samples {
                let mut used = used0;
                let mut draw = || loop {
                    let c = (rng.next() % 52) as u8;
                    if used >> c & 1 == 0 { used |= 1 << c; return c; }
                };
                let (o1, o2) = (draw(), draw());
                let bd = [draw(), draw(), draw(), draw(), draw()];
                let me = eval(&[a, b, bd[0], bd[1], bd[2], bd[3], bd[4]]);
                let op = eval(&[o1, o2, bd[0], bd[1], bd[2], bd[3], bd[4]]);
                w += if me > op { 1.0 } else if me == op { 0.5 } else { 0.0 };
            }
            eq[cls] = w / samples as f64;
        }
        eq
    })
}
