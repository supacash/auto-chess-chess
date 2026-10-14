//! `acc`: the native engine. Commands are added as the engine grows (self-play, tuning).
//!
//!   acc version
//!   acc perft <variant> <depth> <fen>    e.g. acc perft acc8 5 "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1"

use acc_core::position::{Position, perft};
use std::process::ExitCode;
use std::time::Instant;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("version") => {
            println!("{}", acc_core::ENGINE_VERSION);
            ExitCode::SUCCESS
        }
        Some("perft") if args.len() >= 4 => {
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
        _ => {
            eprintln!("usage: acc version | acc perft <variant> <depth> <fen>");
            ExitCode::FAILURE
        }
    }
}
