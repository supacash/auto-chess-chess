//! `acc`: the native engine.
//!
//!   acc version
//!   acc perft <variant> <depth> <fen>    e.g. acc perft acc8 5 "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"
//!   acc uci                              the UCI subset the game's scripts use (scripts/sim/nodeEngine.ts)

use acc_core::position::{Position, perft};
use acc_core::search::{Limits, Searcher, uci_score};
use std::io::{BufRead, Write};
use std::process::ExitCode;
use std::time::Instant;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("version") => {
            println!("{}", acc_core::ENGINE_VERSION);
            ExitCode::SUCCESS
        }
        Some("perft") if args.len() >= 4 => perft_command(&args),
        Some("uci") => {
            uci();
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: acc version | acc perft <variant> <depth> <fen> | acc uci");
            ExitCode::FAILURE
        }
    }
}

fn perft_command(args: &[String]) -> ExitCode {
    let Some((size, two_kings)) = acc_core::parse_variant(&args[1]) else {
        eprintln!("unknown variant {}", args[1]);
        return ExitCode::FAILURE;
    };
    let depth: u32 = args[2].parse().expect("depth");
    let mut pos = match Position::from_fen(size, &args[3..].join(" "), two_kings) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("bad FEN: {e:?}");
            return ExitCode::FAILURE;
        }
    };
    // Divide: each first move's count, then the total.
    let t0 = Instant::now();
    let mut total = 0;
    for m in pos.legal_moves() {
        let name = pos.move_name(m);
        pos.make(m);
        let n = perft(&mut pos, depth.saturating_sub(1));
        pos.unmake();
        println!("{name}: {n}");
        total += n;
    }
    let secs = t0.elapsed().as_secs_f64();
    println!("\n{total} nodes in {secs:.2}s ({:.1} M/s)", total as f64 / secs / 1e6);
    ExitCode::SUCCESS
}

/// A UCI loop: uci, isready, setoption (UCI_Variant, MultiPV, Nodes), ucinewgame,
/// position fen ... [moves ...], go depth N [nodes N], quit. Searches run to completion (no stop).
fn uci() {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    let mut searcher = Searcher::default();
    let mut variant = String::from("acc8");
    let mut multipv = 1usize;
    let mut node_limit = 0u64;
    let mut pos: Option<Position> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let words: Vec<&str> = line.split_whitespace().collect();
        match words.first().copied() {
            Some("uci") => {
                writeln!(out, "id name acc {}\nid author Auto Chess²\nuciok", acc_core::ENGINE_VERSION).ok();
            }
            Some("isready") => {
                writeln!(out, "readyok").ok();
            }
            Some("setoption") => {
                // setoption name <Name> value <v>
                let name = words.get(2).copied().unwrap_or("");
                let value = words.get(4).copied().unwrap_or("");
                match name {
                    "UCI_Variant" => variant = value.to_string(),
                    "MultiPV" => multipv = value.parse().unwrap_or(1),
                    "Nodes" => node_limit = value.parse().unwrap_or(0),
                    _ => {}
                }
            }
            Some("ucinewgame") => searcher.new_game(),
            Some("position") => pos = parse_position(&variant, &words[1..]),
            Some("go") => {
                let mut depth = 8u32;
                let mut nodes = node_limit;
                let mut i = 1;
                while i + 1 < words.len() {
                    match words[i] {
                        "depth" => depth = words[i + 1].parse().unwrap_or(depth),
                        "nodes" => nodes = words[i + 1].parse().unwrap_or(nodes),
                        _ => {}
                    }
                    i += 2;
                }
                let Some(p) = pos.as_mut() else {
                    writeln!(out, "bestmove (none)").ok();
                    continue;
                };
                let lines = searcher.search(p, Limits { depth, nodes }, multipv);
                for (k, l) in lines.iter().enumerate() {
                    writeln!(
                        out,
                        "info depth {depth} multipv {} score {} nodes {} pv {}",
                        k + 1,
                        uci_score(l.score),
                        searcher.nodes(),
                        p.move_name(l.mv)
                    )
                    .ok();
                }
                let best = lines.first().map_or("(none)".to_string(), |l| p.move_name(l.mv));
                writeln!(out, "bestmove {best}").ok();
            }
            Some("quit") => break,
            _ => {}
        }
        out.flush().ok();
    }
}

/// `fen <fen...> [moves m1 m2 ...]` (or `startpos`, the 8×8 start).
fn parse_position(variant: &str, words: &[&str]) -> Option<Position> {
    let (size, two_kings) = acc_core::parse_variant(variant)?;
    let moves_at = words.iter().position(|&w| w == "moves").unwrap_or(words.len());
    let fen = match words.first().copied() {
        Some("fen") => words[1..moves_at].join(" "),
        Some("startpos") => "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1".to_string(),
        _ => return None,
    };
    let mut pos = Position::from_fen(size, &fen, two_kings).ok()?;
    for uci in words.iter().skip(moves_at + 1) {
        let m = pos.parse_move(uci)?;
        pos.make(m);
    }
    Some(pos)
}
