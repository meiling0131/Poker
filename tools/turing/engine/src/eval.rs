//! Hand values, bit for bit the same numbers as the CUDA solver (common.cuh eval_hand) and the
//! game's best7: category << 20 plus up to five rank values (2..14) in base 16.

#[inline]
fn straight_high(m: u32) -> u32 {
    let e = (m << 1) | ((m >> 12) & 1);
    let mut j = 9i32;
    while j >= 0 {
        if (e >> j) & 0x1F == 0x1F { return j as u32 + 5; }
        j -= 1;
    }
    0
}

#[inline]
fn topk(mask: u32, k: usize, out: &mut [u32]) {
    let mut n = 0;
    let mut r = 12i32;
    while r >= 0 && n < k {
        if (mask >> r) & 1 == 1 { out[n] = r as u32 + 2; n += 1; }
        r -= 1;
    }
    while n < k { out[n] = 0; n += 1; }
}

#[inline]
fn enc(cat: u32, k: &[u32]) -> u32 {
    let mut v = cat << 20;
    for (i, &x) in k.iter().enumerate() { v += x << (4 * (4 - i)); }
    v
}

/// value of 5..7 cards (cards 0..51)
pub fn eval(cs: &[u8]) -> u32 {
    let mut cnt = [0u8; 13];
    let mut sc = [0u8; 4];
    let mut pres = 0u32;
    let mut sm = [0u32; 4];
    for &c in cs {
        let (r, s) = ((c % 13) as usize, (c / 13) as usize);
        cnt[r] += 1;
        sc[s] += 1;
        pres |= 1 << r;
        sm[s] |= 1 << r;
    }
    let mut fs = 0;
    for s in 1..4 { if sc[s] > sc[fs] { fs = s; } }
    let flush = sc[fs] >= 5;
    let (mut g0, mut g1, mut k0, mut k1) = (usize::MAX, usize::MAX, -1i32, -1i32);
    for r in 0..13 {
        if cnt[r] == 0 { continue; }
        let k = cnt[r] as i32 * 16 + r as i32 + 2;
        if k > k0 { g1 = g0; k1 = k0; g0 = r; k0 = k; } else if k > k1 { g1 = r; k1 = k; }
    }
    let c0 = cnt[g0];
    let c1 = if g1 != usize::MAX { cnt[g1] } else { 0 };
    let (v0, v1) = (g0 as u32 + 2, if g1 != usize::MAX { g1 as u32 + 2 } else { 0 });
    let mut t = [0u32; 5];
    let sf = if flush { straight_high(sm[fs]) } else { 0 };
    if sf > 0 { return enc(8, &[sf, 0, 0, 0, 0]); }
    if c0 == 4 {
        let mut k = [0u32; 1];
        topk(pres & !(1 << g0), 1, &mut k);
        return enc(7, &[v0, k[0], 0, 0, 0]);
    }
    if c0 == 3 && c1 >= 2 { return enc(6, &[v0, v1, 0, 0, 0]); }
    if flush { topk(sm[fs], 5, &mut t); return enc(5, &t); }
    let st = straight_high(pres);
    if st > 0 { return enc(4, &[st, 0, 0, 0, 0]); }
    if c0 == 3 {
        let mut k = [0u32; 2];
        topk(pres & !(1 << g0), 2, &mut k);
        return enc(3, &[v0, k[0], k[1]]);
    }
    if c0 == 2 && c1 == 2 {
        let mut k = [0u32; 1];
        topk(pres & !(1 << g0) & !(1 << g1), 1, &mut k);
        return enc(2, &[v0, v1, k[0]]);
    }
    if c0 == 2 {
        let mut k = [0u32; 3];
        topk(pres & !(1 << g0), 3, &mut k);
        return enc(1, &[v0, k[0], k[1], k[2]]);
    }
    topk(pres, 5, &mut t);
    enc(0, &t)
}

/// 0 paired, 1 three or more of a suit, 2 three ranks within a straight's reach, 3 dry (poker.py texture_class)
pub fn texture(b: &[u8]) -> usize {
    let mut cnt = [0u8; 13];
    let mut sc = [0u8; 4];
    for &c in b { cnt[(c % 13) as usize] += 1; sc[(c / 13) as usize] += 1; }
    let paired = cnt.iter().any(|&x| x >= 2);
    let flushy = *sc.iter().max().unwrap() >= 3;
    let mut p = [0u8; 14];
    p[0] = (cnt[12] > 0) as u8;
    for r in 0..13 { p[r + 1] = (cnt[r] > 0) as u8; }
    let run = (0..10).map(|j| p[j..j + 5].iter().sum::<u8>()).max().unwrap();
    if paired { 0 } else if flushy { 1 } else if run >= 3 { 2 } else { 3 }
}
