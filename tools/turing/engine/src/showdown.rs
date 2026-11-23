//! One board for all hands at once (the CPU twin of the solver's board.cuh): the hands that miss the board, their
//! values sorted with equal-value groups, and for every card the hands holding it, ranked the same way. From it:
//! every hand's strength numerator 2L+E, and for any opponent reach vector the mass each hand beats (L), ties (E)
//! and faces (T), with exact card removal.
use crate::cards::hand_index;
use crate::eval::eval;

pub struct Board {
    pub m: usize,             // cards left
    pub nv: usize,            // hands that miss the board ("vh" 0..nv)
    pub cards: Vec<(u8, u8)>, // vh -> the hand's real cards
    pub cc: Vec<(u8, u8)>,    // vh -> compact card indices i < j (into `rem`)
    pub hidx: Vec<u16>,       // vh -> poker.py hand number
    pub vh_of: Vec<i16>,      // hand number -> vh, -1 if it hits the board
    pub val: Vec<u32>,
    pub order: Vec<u16>,      // sorted position -> vh
    pub gs: Vec<u16>,         // vh -> first sorted position of its value
    pub ge: Vec<u16>,         // vh -> one past its value's last position
    pub lord: Vec<Vec<u16>>,  // per compact card: member vh in value order
    pub lgs: Vec<Vec<u8>>,    // per compact card, per member index: group start inside the list
    pub lge: Vec<Vec<u8>>,
}

impl Board {
    pub fn new(board: &[u8]) -> Board {
        let used = crate::cards::mask(board);
        let rem: Vec<u8> = (0..52u8).filter(|&c| used >> c & 1 == 0).collect();
        let m = rem.len();
        let nv = m * (m - 1) / 2;
        let (mut cards, mut cc, mut hidx, mut val) = (Vec::with_capacity(nv), Vec::with_capacity(nv), Vec::with_capacity(nv), Vec::with_capacity(nv));
        let mut vh_of = vec![-1i16; crate::cards::NH];
        let mut cs = [0u8; 7];
        cs[2..2 + board.len()].copy_from_slice(board);
        for i in 0..m {
            for j in i + 1..m {
                let (a, b) = (rem[i], rem[j]);
                cs[0] = a;
                cs[1] = b;
                vh_of[hand_index(a, b)] = cards.len() as i16;
                cards.push((a, b));
                cc.push((i as u8, j as u8));
                hidx.push(hand_index(a, b) as u16);
                val.push(eval(&cs[..2 + board.len()]));
            }
        }
        let mut order: Vec<u16> = (0..nv as u16).collect();
        order.sort_by_key(|&v| val[v as usize]);
        let (mut gs, mut ge) = (vec![0u16; nv], vec![0u16; nv]);
        let mut p = 0;
        while p < nv {
            let mut q = p;
            while q < nv && val[order[q] as usize] == val[order[p] as usize] { q += 1; }
            for k in p..q { gs[order[k] as usize] = p as u16; ge[order[k] as usize] = q as u16; }
            p = q;
        }
        // card lists: member m of list i is the hand (i, m < i ? m : m + 1)
        let pair = |i: usize, j: usize| { let (i, j) = if i < j { (i, j) } else { (j, i) }; i * (2 * m - i - 1) / 2 + (j - i - 1) };
        let mut lord = vec![vec![0u16; m - 1]; m];
        let mut lgs = vec![vec![0u8; m - 1]; m];
        let mut lge = vec![vec![0u8; m - 1]; m];
        for i in 0..m {
            let members: Vec<usize> = (0..m - 1).map(|mm| pair(i, if mm < i { mm } else { mm + 1 })).collect();
            let mut idx: Vec<usize> = (0..m - 1).collect();
            idx.sort_by_key(|&mm| (val[members[mm]], mm));
            for (pos, &mm) in idx.iter().enumerate() { lord[i][pos] = members[mm] as u16; }
            let mut p = 0;
            while p < m - 1 {
                let mut q = p;
                while q < m - 1 && val[members[idx[q]]] == val[members[idx[p]]] { q += 1; }
                for k in p..q { lgs[i][idx[k]] = p as u8; lge[i][idx[k]] = q as u8; }
                p = q;
            }
        }
        Board { m, nv, cards, cc, hidx, vh_of, val, order, gs, ge, lord, lgs, lge }
    }

    #[inline]
    fn list_pos(&self, v: usize) -> (usize, usize, usize, usize) {
        let (i, j) = (self.cc[v].0 as usize, self.cc[v].1 as usize);
        (i, j - 1, j, i)     // (list a, member in a, list b, member in b)
    }

    /// 2L + E against every valid opponent hand (reach 1), for all hands
    pub fn strength_nums(&self) -> Vec<u32> {
        (0..self.nv).map(|v| {
            let (a, ma, b, mb) = self.list_pos(v);
            let (la, ea, lb, eb) = (self.lgs[a][ma] as i64, self.lge[a][ma] as i64, self.lgs[b][mb] as i64, self.lge[b][mb] as i64);
            let l = self.gs[v] as i64 - la - lb;
            let e = (self.ge[v] as i64 - self.gs[v] as i64) - (ea - la) - (eb - lb) + 1;
            (2 * l + e) as u32
        }).collect()
    }

    /// for opponent reach r (by vh): every hand's T (the opponent mass it can face), from per-card sums
    pub fn totals(&self, r: &[f32], t: &mut [f32]) {
        let mut cs = [0f32; 52];
        let mut tot = 0f32;
        for v in 0..self.nv { tot += r[v]; cs[self.cc[v].0 as usize] += r[v]; cs[self.cc[v].1 as usize] += r[v]; }
        for v in 0..self.nv { t[v] = tot - cs[self.cc[v].0 as usize] - cs[self.cc[v].1 as usize] + r[v]; }
    }

    /// for opponent reach r (by vh): every hand's L (beats), E (ties), T (faces), card removal exact
    pub fn lte(&self, r: &[f32], l: &mut [f32], e: &mut [f32], t: &mut [f32]) {
        let n = self.nv;
        let mut cum = vec![0f32; n + 1];
        for p in 0..n { cum[p + 1] = cum[p] + r[self.order[p] as usize]; }
        let k = self.m - 1;
        let mut ccum = vec![0f32; self.m * (k + 1)];
        for i in 0..self.m {
            let base = i * (k + 1);
            for p in 0..k { ccum[base + p + 1] = ccum[base + p] + r[self.lord[i][p] as usize]; }
        }
        let tot = cum[n];
        for v in 0..n {
            let (a, ma, b, mb) = self.list_pos(v);
            let (ba, bb) = (a * (k + 1), b * (k + 1));
            let (la, ea, lb, eb) = (self.lgs[a][ma] as usize, self.lge[a][ma] as usize, self.lgs[b][mb] as usize, self.lge[b][mb] as usize);
            let lall = cum[self.gs[v] as usize];
            let eall = cum[self.ge[v] as usize] - lall;
            let (lca, lcb) = (ccum[ba + la], ccum[bb + lb]);
            l[v] = lall - lca - lcb;
            e[v] = eall - (ccum[ba + ea] - lca) - (ccum[bb + eb] - lcb) + r[v];
            t[v] = tot - ccum[ba + k] - ccum[bb + k] + r[v];
        }
    }
}

/// all hands' buckets on a street (flop: the training table when given; turn and river: exact), by hand number
pub fn all_buckets(board: &[u8], abs: &crate::abstraction::Abs, flop: Option<&crate::abstraction::FlopTable>) -> Vec<u8> {
    let mut out = vec![255u8; crate::cards::NH];
    match board.len() {
        3 => {
            let b = Board::new(board);
            for v in 0..b.nv {
                let h = b.cards[v];
                out[b.hidx[v] as usize] = crate::abstraction::bucket_with(h, board, abs, flop) as u8;
            }
        }
        4 => {
            let now = Board::new(board);
            let k_now = now.strength_nums();
            let t_now = ((now.m - 2) * (now.m - 3) / 2) as f64;
            let mut sum = vec![0u64; crate::cards::NH];
            let used = crate::cards::mask(board);
            let mut full = [0u8; 5];
            full[..4].copy_from_slice(board);
            for r in 0..52u8 {
                if used >> r & 1 == 1 { continue; }
                full[4] = r;
                let rb = Board::new(&full);
                for (v, k) in rb.strength_nums().into_iter().enumerate() { sum[rb.hidx[v] as usize] += k as u64; }
            }
            for v in 0..now.nv {
                let h = now.hidx[v] as usize;
                let ehs = sum[h] as f64 / (46.0 * 1980.0);
                let cur = k_now[v] as f64 / (2.0 * t_now);
                out[h] = abs.ft(2, ehs, cur) as u8;
            }
        }
        5 => {
            let b = Board::new(board);
            for (v, k) in b.strength_nums().into_iter().enumerate() {
                let hs = k as f64 / 1980.0;
                out[b.hidx[v] as usize] = abs.river(hs) as u8;
            }
        }
        _ => {}
    }
    out
}
