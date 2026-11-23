//! The runtime bucket computation (exact expected strength + the training's edges) against the training's own
//! tables. Set BUCKETS to a bucket file (solver/cuda/data/buckets.bin, version 1, or solver/cuda3/data/buckets2.bin,
//! version 2); skipped otherwise. With FLOP_TABLE (the bot's flop.bkt) that file is checked against it too.
use hucore::abstraction::{bucket, Abs, FlopTable, Rd};
use hucore::cards::hand_index;
use hucore::showdown::all_buckets;

fn binom(n: usize, k: usize) -> usize {
    if k > n { return 0; }
    let mut r = 1usize;
    for i in 1..=k { r = r * (n - k + i) / i; }
    r
}
fn colex(cs: &[u8]) -> usize {
    let mut v: Vec<usize> = cs.iter().map(|&x| x as usize).collect();
    v.sort_unstable();
    v.iter().enumerate().map(|(i, &x)| binom(x, i + 1)).sum()
}

#[test]
fn runtime_buckets_match_training() {
    let Ok(bk) = std::env::var("BUCKETS") else { return };
    let raw = std::fs::read(bk).unwrap();
    assert_eq!(&raw[..4], b"PBKT");
    let mut c = Rd { b: &raw, o: 4 };
    let abs = if c.u32().unwrap() == 1 {
        let mut e = [0f64; 17];
        for x in e.iter_mut() { *x = c.f64().unwrap(); }
        Abs::v1(&e)
    } else {
        Abs::read_v2(&mut c).unwrap()
    };
    const NF: usize = 22100 * 1326;
    let (flop_t, turn_t) = (&raw[c.o..c.o + NF], &raw[c.o + NF..c.o + NF + 270725 * 1326]);
    let mut rng = 0x1234_5678_9abc_def1u64;
    let mut next = move || { rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; rng };
    let mut deal = |n: usize| -> Vec<u8> {
        let mut used = 0u64;
        let mut out = vec![];
        while out.len() < n { let c = (next() % 52) as u8; if used >> c & 1 == 0 { used |= 1 << c; out.push(c); } }
        out
    };
    for _ in 0..200 {                                    // single hands, exact, flop and turn
        let d = deal(6);
        let hole = (d[0], d[1]);
        for k in [3usize, 4] {
            let board = &d[2..2 + k];
            let t = if k == 3 { flop_t } else { turn_t };
            let want = t[colex(board) * 1326 + hand_index(hole.0, hole.1)] as usize;
            assert_eq!(bucket(hole, board, &abs), want, "board {:?} hole {:?}", board, hole);
        }
    }
    for _ in 0..30 {                                     // whole turn boards, the vectorized way the policy uses
        let board = deal(4);
        let got = all_buckets(&board, &abs, None);
        let row = &turn_t[colex(&board) * 1326..colex(&board) * 1326 + 1326];
        assert_eq!(&got[..], row, "turn {:?}", board);
    }
    for _ in 0..20 {                                     // river: vectorized against single hands
        let d = deal(7);
        let board = &d[2..7];
        let all = all_buckets(board, &abs, None);
        let hole = (d[0], d[1]);
        assert_eq!(all[hand_index(hole.0, hole.1)] as usize, bucket(hole, board, &abs));
    }
    if let Ok(ft) = std::env::var("FLOP_TABLE") {
        let table = FlopTable::load(std::fs::read(ft).unwrap()).expect("flop table");
        assert!(table.fits(&abs), "flop table made for another abstraction");
        assert_eq!(&table.table[..], flop_t);
    }
}
