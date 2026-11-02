// One exact flop solve (b-inary/postflop-solver, Discounted CFR, no abstraction), written out for tools/flops/batch.py.
//
//   flop-solve job.json out.json          threads: RAYON_NUM_THREADS (default: all cores)
//
// job.json: {"flop": "Td9d6h", "pot": 110, "stack": 1950, "oop": "<range>", "ip": "<range>",
//            "flop_sizes": ["33%, 75%", "3x"], "turn_sizes": ["66%", "3x"], "river_sizes": ["50%, 100%", "3x"],
//            "allin_threshold": 1.5, "accuracy": 0.005, "max_iters": 1000, "depth": 4, "compress": false}
//   pot and stack in chips (integers); ranges as PioSOLVER strings ("AA,AKs:0.5,..."); accuracy: the target
//   exploitability as a share of the pot.
// out.json: {"flop", "pot", "exploitability", "hands": [[oop hands], [ip hands]],
//            "nodes": [{"path": ["X", "B36"], "player": 1, "actions": ["F", "C", "R108", "A1950"],
//                       "weights": [per hand of the acting player], "strategy": [action-major, per hand]}]}
//   actions: F fold, X check, C call, B<n> bet, R<n> raise to, A<n> all in (amounts this street, in chips).
//   Only the flop's decisions are written (the walk stops at the turn card), up to `depth` actions deep.
use postflop_solver::*;
use serde_json::{json, Value};
use std::{env, fs, process};

fn name(a: &Action) -> String {
    match a {
        Action::Fold => "F".into(),
        Action::Check => "X".into(),
        Action::Call => "C".into(),
        Action::Bet(x) => format!("B{x}"),
        Action::Raise(x) => format!("R{x}"),
        Action::AllIn(x) => format!("A{x}"),
        _ => "?".into(),
    }
}

fn round4(x: f32) -> f64 {
    ((x as f64) * 10000.0).round() / 10000.0
}

fn walk(game: &mut PostFlopGame, history: &mut Vec<usize>, path: &mut Vec<String>, depth: usize, out: &mut Vec<Value>) {
    game.apply_history(history);
    if game.is_terminal_node() || game.is_chance_node() {
        return;
    }
    game.cache_normalized_weights();
    let player = game.current_player();
    let actions = game.available_actions();
    let strategy = game.strategy();
    let weights: Vec<f64> = game.normalized_weights(player).iter().map(|&w| round4(w)).collect();
    out.push(json!({
        "path": path.clone(),
        "player": player,
        "actions": actions.iter().map(name).collect::<Vec<_>>(),
        "weights": weights,
        "strategy": strategy.iter().map(|&s| round4(s)).collect::<Vec<_>>(),
    }));
    if depth == 0 {
        return;
    }
    for (i, a) in actions.iter().enumerate() {
        history.push(i);
        path.push(name(a));
        walk(game, history, path, depth - 1, out);
        history.pop();
        path.pop();
    }
}

fn fail(msg: String) -> ! {
    eprintln!("flop-solve: {msg}");
    process::exit(1);
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        fail("usage: flop-solve job.json out.json".into());
    }
    let text = fs::read_to_string(&args[1]).unwrap_or_else(|e| fail(format!("{}: {e}", args[1])));
    let job: Value = serde_json::from_str(&text).unwrap_or_else(|e| fail(format!("job: {e}")));
    let s = |k: &str| job[k].as_str().unwrap_or_else(|| fail(format!("job.{k} missing"))).to_string();
    let sizes = |k: &str| -> BetSizeOptions {
        let v = &job[k];
        let (bet, raise) = (v[0].as_str().unwrap_or(""), v[1].as_str().unwrap_or(""));
        BetSizeOptions::try_from((bet, raise)).unwrap_or_else(|e| fail(format!("{k}: {e}")))
    };
    let oop: Range = s("oop").parse().unwrap_or_else(|e| fail(format!("oop range: {e}")));
    let ip: Range = s("ip").parse().unwrap_or_else(|e| fail(format!("ip range: {e}")));
    let card_config = CardConfig {
        range: [oop, ip],
        flop: flop_from_str(&s("flop")).unwrap_or_else(|e| fail(format!("flop: {e}"))),
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };
    let (f, t, r) = (sizes("flop_sizes"), sizes("turn_sizes"), sizes("river_sizes"));
    let pot = job["pot"].as_i64().unwrap_or_else(|| fail("job.pot missing".into())) as i32;
    let tree_config = TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: pot,
        effective_stack: job["stack"].as_i64().unwrap_or_else(|| fail("job.stack missing".into())) as i32,
        rake_rate: 0.0,
        rake_cap: 0.0,
        flop_bet_sizes: [f.clone(), f],
        turn_bet_sizes: [t.clone(), t],
        river_bet_sizes: [r.clone(), r],
        turn_donk_sizes: None,
        river_donk_sizes: None,
        add_allin_threshold: job["allin_threshold"].as_f64().unwrap_or(1.5),
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
    };
    let tree = ActionTree::new(tree_config).unwrap_or_else(|e| fail(format!("tree: {e}")));
    let mut game = PostFlopGame::with_config(card_config, tree).unwrap_or_else(|e| fail(format!("game: {e}")));
    game.allocate_memory(job["compress"].as_bool().unwrap_or(false));
    let target = pot as f32 * job["accuracy"].as_f64().unwrap_or(0.005) as f32;
    let exploitability = solve(&mut game, job["max_iters"].as_u64().unwrap_or(1000) as u32, target, false);
    let mut nodes = Vec::new();
    walk(&mut game, &mut Vec::new(), &mut Vec::new(), job["depth"].as_u64().unwrap_or(4) as usize, &mut nodes);
    let hands: Vec<Vec<String>> = (0..2)
        .map(|p| holes_to_strings(game.private_cards(p)).unwrap_or_else(|e| fail(format!("hands: {e}"))))
        .collect();
    let result = json!({"flop": s("flop"), "pot": pot, "exploitability": exploitability, "hands": hands, "nodes": nodes});
    fs::write(&args[2], serde_json::to_string(&result).unwrap()).unwrap_or_else(|e| fail(format!("{}: {e}", args[2])));
}
