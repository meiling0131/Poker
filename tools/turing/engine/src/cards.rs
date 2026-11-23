//! Cards and hands, numbered exactly like the CUDA solver (tools/solver/poker.py):
//! card = suit * 13 + (rank - 2), suits s h d c = 0..3, ranks 2..A = 0..12;
//! the 1326 two-card hands are (0,1), (0,2) .. (0,51), (1,2) ..

pub const NH: usize = 1326;
const RANKS: &[u8] = b"23456789TJQKA";
const SUITS: &[u8] = b"shdc";

#[inline]
pub fn rank(c: u8) -> u8 { c % 13 }
#[inline]
pub fn suit(c: u8) -> u8 { c / 13 }

/// "Ah", "Tc", "2d" (also accepts "10h" and lowercase ranks)
pub fn parse_card(s: &str) -> Option<u8> {
    let b = s.trim().as_bytes();
    if b.len() < 2 { return None; }
    let (rk, st) = if b.len() == 3 && &b[..2] == b"10" { (b'T', b[2]) } else { (b[0].to_ascii_uppercase(), b[b.len() - 1].to_ascii_lowercase()) };
    let r = RANKS.iter().position(|&x| x == rk)?;
    let su = SUITS.iter().position(|&x| x == st)?;
    Some((su * 13 + r) as u8)
}

pub fn card_str(c: u8) -> String {
    format!("{}{}", RANKS[rank(c) as usize] as char, SUITS[suit(c) as usize] as char)
}

/// poker.py hand number of two cards (any order)
#[inline]
pub fn hand_index(a: u8, b: u8) -> usize {
    let (a, b) = if a < b { (a as usize, b as usize) } else { (b as usize, a as usize) };
    a * 51 - a * a.saturating_sub(1) / 2 + b - a - 1
}

/// the two cards of hand number h
pub fn hand_cards(mut h: usize) -> (u8, u8) {
    let mut a = 0usize;
    while h >= 51 - a { h -= 51 - a; a += 1; }
    (a as u8, (a + 1 + h) as u8)
}

/// 169 preflop classes: pairs 0..12 (22..AA), then suited and offsuit by (high, low)
pub fn preflop_class(a: u8, b: u8) -> usize {
    let (ra, rb) = (rank(a) as usize, rank(b) as usize);
    let (hi, lo) = if ra >= rb { (ra, rb) } else { (rb, ra) };
    if hi == lo { return hi; }
    let idx = hi * (hi - 1) / 2 + lo; // 0..77 over hi > lo
    if suit(a) == suit(b) { 13 + idx } else { 13 + 78 + idx }
}

pub fn class_name(cls: usize) -> String {
    let r = |i: usize| RANKS[i] as char;
    if cls < 13 { return format!("{}{}", r(cls), r(cls)); }
    let (s, mut i) = if cls < 91 { ('s', cls - 13) } else { ('o', cls - 91) };
    let mut hi = 1;
    while i >= hi { i -= hi; hi += 1; }
    format!("{}{}{}", r(hi), r(i), s)
}

/// bitmask of cards
#[inline]
pub fn mask(cards: &[u8]) -> u64 { cards.iter().fold(0u64, |m, &c| m | 1u64 << c) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hand_numbers_round_trip() {
        let mut n = 0;
        for a in 0..52u8 {
            for b in a + 1..52 {
                assert_eq!(hand_index(a, b), n);
                assert_eq!(hand_cards(n), (a, b));
                n += 1;
            }
        }
        assert_eq!(n, NH);
    }
    #[test]
    fn parsing() {
        assert_eq!(parse_card("2s"), Some(0));
        assert_eq!(parse_card("As"), Some(12));
        assert_eq!(parse_card("Ah"), Some(25));
        assert_eq!(parse_card("Tc"), Some(3 * 13 + 8));
        assert_eq!(card_str(parse_card("Kd").unwrap()), "Kd");
    }
    #[test]
    fn classes() {
        let mut seen = [0u32; 169];
        for a in 0..52u8 { for b in a + 1..52 { seen[preflop_class(a, b)] += 1; } }
        assert!(seen[..13].iter().all(|&x| x == 6));
        assert!(seen[13..91].iter().all(|&x| x == 4));
        assert!(seen[91..].iter().all(|&x| x == 12));
        assert_eq!(class_name(12), "AA");
        assert_eq!(class_name(preflop_class(parse_card("Ah").unwrap(), parse_card("Kh").unwrap())), "AKs");
        assert_eq!(class_name(preflop_class(parse_card("7c").unwrap(), parse_card("2d").unwrap())), "72o");
    }
}
