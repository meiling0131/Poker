//! The hand bucket on a street, exactly as the solver's training computed it (precompute.cuh / walk.cuh).
//!
//! Version 1 (solver/cuda, cuda2; 10 buckets): flop and turn 2 * bin(expected river strength) + (expected - now >
//! 0.05), river bin(strength). Version 2 (solver/cuda3; 24 buckets): flop and turn NP * bin(expected strength) +
//! bin(potential inside that strength bin), potential = expected - now (draws gain, vulnerable made hands lose),
//! river bin(strength). Expected strength is the exact average over every runout of the river strength 2L + E
//! against all opponent hands; the arithmetic below repeats the GPU's, so the same edges give the same buckets.
use crate::equity::{ehs_num, strength_num};

pub const POT_T: f64 = 0.05;

/// version 2 strength-bin masses (hu_main.cu ECUT) and the river bins' shape (river_cut), for `Abs::strength`
const ECUT: [f64; 7] = [0.22, 0.42, 0.58, 0.71, 0.81, 0.89, 0.95];
const RIVER_POW: f64 = 1.2;

/// little-endian reader over a byte slice
pub struct Rd<'a> { pub b: &'a [u8], pub o: usize }
impl<'a> Rd<'a> {
    pub fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.o + n > self.b.len() { return Err("file is truncated".into()); }
        let s = &self.b[self.o..self.o + n];
        self.o += n;
        Ok(s)
    }
    pub fn u32(&mut self) -> Result<u32, String> { Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap())) }
    pub fn f64(&mut self) -> Result<f64, String> { Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap())) }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Abs {
    pub version: u32,
    pub nb: usize,
    pub ne: usize,            // flop / turn strength bins
    pub np: usize,            // potential bins inside each
    pub e: [Vec<f64>; 2],     // flop, turn: ne - 1 strength edges
    pub g: [Vec<f64>; 2],     // flop, turn: ne x (np - 1) potential edges
    pub r: Vec<f64>,          // river: nb - 1 strength edges
}

impl Abs {
    pub fn v1(edges: &[f64; 17]) -> Abs {
        Abs { version: 1, nb: 10, ne: 5, np: 2, e: [edges[0..4].to_vec(), edges[4..8].to_vec()],
              g: [vec![POT_T; 5], vec![POT_T; 5]], r: edges[8..17].to_vec() }
    }

    /// (ne, np, nb) and the edge arrays, as the bucket file and blueprint version 2 store them
    pub fn read_v2(c: &mut Rd) -> Result<Abs, String> {
        let (ne, np, nb) = (c.u32()? as usize, c.u32()? as usize, c.u32()? as usize);
        if ne == 0 || np == 0 || ne * np != nb || nb > 64 { return Err(format!("bad abstraction {} x {} / {}", ne, np, nb)); }
        let mut take = |n: usize| -> Result<Vec<f64>, String> { (0..n).map(|_| c.f64()).collect() };
        let (ef, gf, et, gt, r) = (take(ne - 1)?, take(ne * (np - 1))?, take(ne - 1)?, take(ne * (np - 1))?, take(nb - 1)?);
        Ok(Abs { version: 2, nb, ne, np, e: [ef, et], g: [gf, gt], r })
    }

    /// flop (street 1) or turn (2) bucket from expected and current strength
    pub fn ft(&self, street: usize, ehs: f64, now: f64) -> usize {
        let i = street - 1;
        let eb = self.e[i].iter().filter(|&&x| ehs > x).count();
        let gain = ehs - now;
        let w = self.np - 1;
        let pb = self.g[i][eb * w..(eb + 1) * w].iter().filter(|&&x| gain > x).count();
        eb * self.np + pb
    }

    pub fn river(&self, hs: f64) -> usize { self.r.iter().filter(|&&x| hs > x).count() }

    /// where a bucket's hands stand among all hands, in [0, 1] (the middle of its strength bin by share of hands);
    /// the exploitation layer compares it with fixed shares
    pub fn strength(&self, street: usize, b: usize) -> f64 {
        if street == 3 {
            let n = self.nb as f64;
            let cut = |i: usize| -> f64 {
                if self.version == 1 { i as f64 / n } else { 1.0 - (1.0 - i as f64 / n).powf(RIVER_POW) }
            };
            return (cut(b) + cut(b + 1)) / 2.0;
        }
        let eb = b / self.np;
        if self.version == 1 || self.ne != ECUT.len() + 1 {
            return (eb as f64 + 0.5) / self.ne as f64;
        }
        let lo = if eb == 0 { 0.0 } else { ECUT[eb - 1] };
        let hi = if eb + 1 >= self.ne { 1.0 } else { ECUT[eb] };
        (lo + hi) / 2.0
    }
}

/// the training's own flop buckets: [colex index of the sorted flop][hand number], 255 for hands that hit it;
/// version 2 files ("HUF2") carry the abstraction they were made with, version 1 ("HUFB") is the 10-bucket one
pub struct FlopTable {
    pub abs: Option<Abs>,
    pub table: Vec<u8>,
}

impl FlopTable {
    pub fn load(bytes: Vec<u8>) -> Option<FlopTable> {
        const N: usize = 22100 * 1326;
        if bytes.len() == 4 + N && &bytes[..4] == b"HUFB" {
            return Some(FlopTable { abs: None, table: bytes[4..].to_vec() });
        }
        if bytes.len() < 4 + N || &bytes[..4] != b"HUF2" { return None; }
        let mut c = Rd { b: &bytes, o: 4 };
        let abs = Abs::read_v2(&mut c).ok()?;
        if bytes.len() != c.o + N { return None; }
        Some(FlopTable { abs: Some(abs), table: bytes[c.o..].to_vec() })
    }

    /// does this table hold the buckets of abstraction `a`
    pub fn fits(&self, a: &Abs) -> bool {
        match &self.abs { None => a.version == 1, Some(t) => t == a }
    }

    pub fn get(&self, hole: (u8, u8), flop: &[u8]) -> Option<usize> {
        let mut c = [flop[0] as u32, flop[1] as u32, flop[2] as u32];
        c.sort_unstable();
        let idx = c[0] + c[1] * (c[1] - 1) / 2 + c[2] * (c[2] - 1) * (c[2] - 2) / 6;
        let b = self.table[idx as usize * 1326 + crate::cards::hand_index(hole.0, hole.1)];
        (b != 255).then_some(b as usize)
    }
}

/// the bucket, from the flop table when it is there and fits
pub fn bucket_with(hole: (u8, u8), board: &[u8], abs: &Abs, flop: Option<&FlopTable>) -> usize {
    if board.len() == 3 {
        if let Some(b) = flop.filter(|t| t.fits(abs)).and_then(|t| t.get(hole, board)) { return b; }
    }
    bucket(hole, board, abs)
}

/// the bucket, computed exactly (on the flop this enumerates all 1081 runouts: slow, the table is the fast way)
pub fn bucket(hole: (u8, u8), board: &[u8], abs: &Abs) -> usize {
    match board.len() {
        5 => {
            let (k, _) = strength_num(hole, board);
            abs.river(k as f64 / 1980.0)
        }
        3 | 4 => {
            let (sum, n) = ehs_num(hole, board);
            let ehs = sum as f64 / (n as f64 * 1980.0);
            let (k, t) = strength_num(hole, board);
            let now = k as f64 / (2.0 * t as f64);
            abs.ft(board.len() - 2, ehs, now)
        }
        _ => 0,
    }
}
