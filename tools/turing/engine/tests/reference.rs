//! Against vectors from tools/solver/poker.py (set REF_DIR to the folder holding eval_vectors.bin
//! and strength_vectors.bin); skipped when REF_DIR is not set.
use hucore::equity::strength;
use hucore::eval::eval;

fn read(path: &std::path::Path) -> Vec<u8> { std::fs::read(path).expect("reference file") }

#[test]
fn hand_values_match_poker_py() {
    let Ok(dir) = std::env::var("REF_DIR") else { return };
    let raw = read(&std::path::Path::new(&dir).join("eval_vectors.bin"));
    let v: Vec<i64> = raw.chunks_exact(8).map(|c| i64::from_le_bytes(c.try_into().unwrap())).collect();
    let mut n = 0;
    for row in v.chunks_exact(8) {
        let cards: Vec<u8> = row[..7].iter().filter(|&&c| c != 255).map(|&c| c as u8).collect();
        assert_eq!(eval(&cards) as i64, row[7], "cards {:?}", cards);
        n += 1;
    }
    assert!(n > 100_000);
}

#[test]
fn strength_matches_poker_py() {
    let Ok(dir) = std::env::var("REF_DIR") else { return };
    let raw = read(&std::path::Path::new(&dir).join("strength_vectors.bin"));
    let v: Vec<f64> = raw.chunks_exact(8).map(|c| f64::from_le_bytes(c.try_into().unwrap())).collect();
    for row in v.chunks_exact(7) {
        let board: Vec<u8> = row[..5].iter().filter(|&&c| c != 255.0).map(|&c| c as u8).collect();
        let (a, b) = hucore::cards::hand_cards(row[5] as usize);
        let s = strength((a, b), &board);
        assert!((s - row[6]).abs() < 1e-6, "board {:?} hand {} {}: {} vs {}", board, a, b, s, row[6]);
    }
}
