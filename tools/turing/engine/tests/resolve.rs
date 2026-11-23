//! The river re-solver converges: the exploitability of its strategy falls to a small share of the pot.
use hucore::resolve::{best_response, build, solve_all, Spec};
use hucore::showdown::Board;
use std::time::Duration;

#[test]
fn river_subgame_converges() {
    let board = [12u8, 25, 3, 40, 18]; // As Ah 5s 3c 7h
    let b = Board::new(&board);
    let r = vec![1f32; b.nv];
    let spec = Spec { to_act: 0, c: [100.0, 100.0], bets: [0.0, 0.0], stack: [1000.0, 1000.0], opp_acted: false,
                      min_raise: 10.0, last_inc: 10.0, raises: 0 };
    let nodes = build(&spec);
    let pot = 200.0;
    let mut prev = f64::MAX;
    for iters in [50usize, 300, 1500] {
        let t0 = std::time::Instant::now();
        let (avg, it) = solve_all(&nodes, &b, [&r, &r], iters, Duration::from_secs(60));
        let br = best_response(&nodes, &b, [&r, &r], &avg);
        let expl = (br[0] + br[1]) / pot;
        println!("{} nodes, {} iterations in {:.2}s: best responses {:+.2} {:+.2} chips, exploitability {:.2}% of the pot",
                 nodes.len(), it, t0.elapsed().as_secs_f64(), br[0], br[1], 100.0 * expl);
        assert!(expl < prev * 1.05);
        prev = expl;
    }
    assert!(prev < 0.02, "exploitability {:.3} of the pot", prev);
}
