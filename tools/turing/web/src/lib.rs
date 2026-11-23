//! The heads-up bot for the browser game (Verve Poker's 单挑 practice table), as a WebAssembly module.
//!
//! Plain C ABI over the module's memory, no bindings crate: JavaScript copies an Int32Array in with `alloc`, calls
//! `decide` or `observe`, and frees it. One bot per module instance (the page has one heads-up table).
//!
//!   load(ptr, len, seed) -> blueprints loaded (-1: bad data)   the packed blueprints ("TBP1", u32 count, then
//!                                                               u32 length + bytes for each)
//!   decide(ptr, len) -> 0 fold, 1 check / call, 2 raise (to `amount()`), -1 no answer (the caller decides)
//!   observe(ptr, len) -> 0, or -1                                one finished hand for the opponent model
//!   new_match()                                                  forget the opponent (a new table)
//!
//! decide's input (Int32Array, chips): 1 (format), hole 0, hole 1, five board slots (-1 empty), big blind, am I the
//! small blind (1/0), my stack and the opponent's at the start of the hand, to call, my stack now, the opponent's,
//! my bet this street, theirs, min raise-to, max raise-to, can raise (1/0), the pot, the number of actions, then
//! for each action this hand (blinds not included): mine (1/0), street 0-3, type (0 fold, 1 check, 2 call,
//! 3 raise), that player's chips in the pot this hand after it.
//! observe's input: 1 (format), was I the small blind (1/0), big blind, the opponent's hole cards (-1 -1: not
//! shown), five board slots, my stack and theirs at the start, the number of actions, then the actions as above.
//! Cards are 0-51: rank (2..A) = c % 13, suit = c / 13 in the order s h d c, as in the game's js/cards.js.
use hucore::blueprint::Blueprint;
use hucore::game::{AKind, Decision, HAct, Spot};
use hucore::policy::Policy;
use std::cell::RefCell;

struct Bot { policy: Policy, rng: u64, amount: i64 }

thread_local! {
    static BOT: RefCell<Option<Bot>> = const { RefCell::new(None) };
}

#[no_mangle]
pub extern "C" fn alloc(n: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(n.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p` and `n` must come from one `alloc(n)` call.
#[no_mangle]
pub unsafe extern "C" fn dealloc(p: *mut u8, n: usize) { drop(Vec::from_raw_parts(p, 0, n.max(1))); }

fn bytes<'a>(p: *const u8, n: usize) -> &'a [u8] { if n == 0 { &[] } else { unsafe { std::slice::from_raw_parts(p, n) } } }
fn ints<'a>(p: *const u8, n: usize) -> Vec<i64> {
    bytes(p, n).chunks_exact(4).map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]]) as i64).collect()
}

#[no_mangle]
pub extern "C" fn load(p: *const u8, n: usize, seed: u32) -> i32 {
    let b = bytes(p, n);
    if b.len() < 8 || &b[..4] != b"TBP1" { return -1; }
    let count = u32::from_le_bytes(b[4..8].try_into().unwrap()) as usize;
    let (mut o, mut bps) = (8usize, vec![]);
    for _ in 0..count {
        if o + 4 > b.len() { return -1; }
        let len = u32::from_le_bytes(b[o..o + 4].try_into().unwrap()) as usize;
        o += 4;
        if o + len > b.len() { return -1; }
        match Blueprint::load(&b[o..o + len]) { Ok(bp) => bps.push(bp), Err(_) => return -1 }
        o += len;
    }
    let k = bps.len() as i32;
    let mut policy = Policy::new(bps, seed as u64 ^ 0x5DEE_CE66D);
    policy.resolve = false;          // no river re-solving in the browser: the blueprint alone, at once
    policy.exploit = true;
    hucore::equity::preflop_equity(); // the table the opponent model reads, filled now rather than mid-hand
    BOT.with(|c| *c.borrow_mut() = Some(Bot { policy, rng: (seed as u64) | 1, amount: 0 }));
    k
}

#[no_mangle]
pub extern "C" fn new_match() {
    BOT.with(|c| if let Some(b) = c.borrow_mut().as_mut() { b.policy.opp = Default::default(); });
}

#[no_mangle]
pub extern "C" fn amount() -> i32 { BOT.with(|c| c.borrow().as_ref().map_or(0, |b| b.amount as i32)) }

fn card(x: i64) -> Option<u8> { (0..52).contains(&x).then_some(x as u8) }
fn kind_of(t: i64, total: i64, start: i64) -> Option<AKind> {
    Some(match t { 0 => AKind::Fold, 1 => AKind::Check, 2 => AKind::Call,
                   3 => if total >= start { AKind::AllIn } else { AKind::Raise }, _ => return None })
}

/// the hand's actions in the blueprint's terms (players 0 big blind, 1 small blind), from (mine, street, type, total)
fn history(acts: &[i64], me: usize, start: [i64; 2], bb: i64) -> Option<Vec<HAct>> {
    acts.chunks_exact(4).map(|a| {
        let player = if a[0] == 1 { me } else { 1 - me };
        let st = if a[0] == 1 { start[0] } else { start[1] };
        Some(HAct { street: usize::try_from(a[1]).ok().filter(|&s| s < 4)?, player, kind: kind_of(a[2], a[3], st)?,
                    total: a[3] as f64 / bb as f64 })
    }).collect()
}

fn spot(v: &[i64]) -> Option<Spot> {
    if v.len() < 22 || v[0] != 1 { return None; }
    let hole = (card(v[1])?, card(v[2])?);
    let board: Vec<u8> = v[3..8].iter().filter(|&&x| x >= 0).map(|&x| card(x)).collect::<Option<_>>()?;
    let street = match board.len() { 0 => 0, 3 => 1, 4 => 2, 5 => 3, _ => return None };
    let bb = v[8].max(1);
    let me = (v[9] == 1) as usize;
    let start = [v[10], v[11]];
    let (to_call, my_stack, opp_stack, my_bet, opp_bet, min_raise, max_raise) = (v[12], v[13], v[14], v[15], v[16], v[17], v[18]);
    let can_raise = v[19] == 1;
    let pot = v[20];
    let n = usize::try_from(v[21]).ok()?;
    let acts = v.get(22..22 + 4 * n)?;
    let hist = history(acts, me, start, bb)?;
    let aggro = |a: &HAct| matches!(a.kind, AKind::Raise | AKind::AllIn);
    let raises = hist.iter().filter(|a| a.street == street && aggro(a)).count() as u32;
    let opp_aggr = hist.iter().filter(|a| a.player != me && aggro(a)).count() as u32;
    let my_aggr_last = street > 0 && hist.iter().filter(|a| a.street == street - 1 && aggro(a)).last().is_some_and(|a| a.player == me);
    // chips in the pot by player (0 big blind, 1 small blind): the latest total of each, else the blind
    let mut contrib = [1.0f64, 0.5f64];
    for a in &hist { contrib[a.player] = a.total; }
    let total_now = |mine: bool| if mine { start[0] - my_stack } else { start[1] - opp_stack };
    contrib[me] = total_now(true) as f64 / bb as f64;
    contrib[1 - me] = total_now(false) as f64 / bb as f64;
    Some(Spot { hole, board, street, pot, to_call, my_stack, opp_stack, my_bet, opp_bet, min_raise, max_raise, bb,
                button: me == 1, can_raise, raises, opp_aggr, my_aggr_last, start_eff: start[0].min(start[1]), me, hist, contrib })
}

#[no_mangle]
pub extern "C" fn decide(p: *const u8, n: usize) -> i32 {
    let v = ints(p, n);
    let Some(s) = spot(&v) else { return -1 };
    BOT.with(|c| {
        let mut g = c.borrow_mut();
        let Some(b) = g.as_mut() else { return -1 };
        let d = match b.policy.decide(&s) {
            Some(d) => d,
            None => {
                let r = &mut b.rng;
                hucore::heuristic::decide(&s, &mut || { *r ^= *r << 13; *r ^= *r >> 7; *r ^= *r << 17; (*r >> 11) as f64 / (1u64 << 53) as f64 })
            }
        };
        match s.legal(d) {
            Decision::Fold => 0,
            Decision::Check | Decision::Call => 1,
            Decision::RaiseTo(x) => { b.amount = x; 2 }
        }
    })
}

#[no_mangle]
pub extern "C" fn observe(p: *const u8, n: usize) -> i32 {
    let v = ints(p, n);
    if v.len() < 13 || v[0] != 1 { return -1; }
    let me = (v[1] == 1) as usize;
    let bb = v[2].max(1);
    let shown = match (card(v[3]), card(v[4])) { (Some(a), Some(b)) => Some((a, b)), _ => None };
    let board: Vec<u8> = v[5..10].iter().filter_map(|&x| card(x)).collect();
    let start = [v[10], v[11]];
    let Ok(k) = usize::try_from(v[12]) else { return -1 };
    let Some(acts) = v.get(13..13 + 4 * k) else { return -1 };
    let Some(hist) = history(acts, me, start, bb) else { return -1 };
    BOT.with(|c| if let Some(b) = c.borrow_mut().as_mut() { b.policy.opp.observe(&hist, me, shown, &board); });
    0
}
