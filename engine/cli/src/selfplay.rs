//! `acc selfplay`: plays battles engine against itself from a file of starts (scripts/sim/starts.ts),
//! in parallel, and writes every position with the battle's result, for tuning the evaluation.
//!
//!   acc selfplay <starts.txt> <out.txt> [--nodes N] [--depth D] [--threads T]
//!
//! Output lines: `variant;white's score (1, 0.5, 0);fen`. Moves are picked as the game picks them:
//! at random among the lines within 50 centipawns of the best (src/engine/pick.ts).

use acc_core::battle;
use acc_core::position::Position;
use acc_core::search::{Limits, Searcher};
use std::fs;
use std::io::Write;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

const PICK_MARGIN: i32 = 50;
const MULTI_PV: usize = 3;

struct Start {
    variant: String,
    limit: usize,
    fen: String,
}

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^ (z >> 31)
}

pub fn run(args: &[String]) -> Result<(), String> {
    let starts_path = args.first().ok_or("starts file")?;
    let out_path = args.get(1).ok_or("output file")?;
    let mut limits = Limits { depth: 8, nodes: 20_000 };
    let mut threads = std::thread::available_parallelism().map_or(4, |n| n.get().saturating_sub(2).max(1));
    let mut i = 2;
    while i + 1 < args.len() {
        let v = &args[i + 1];
        match args[i].as_str() {
            "--nodes" => limits.nodes = v.parse().map_err(|_| "--nodes")?,
            "--depth" => limits.depth = v.parse().map_err(|_| "--depth")?,
            "--threads" => threads = v.parse().map_err(|_| "--threads")?,
            other => return Err(format!("unknown option {other}")),
        }
        i += 2;
    }
    let text = fs::read_to_string(starts_path).map_err(|e| format!("{starts_path}: {e}"))?;
    let starts: Vec<Start> = text
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            let mut p = l.splitn(3, ';');
            Start {
                variant: p.next().unwrap_or("").to_string(),
                limit: p.next().and_then(|n| n.parse().ok()).unwrap_or(90),
                fen: p.next().unwrap_or("").to_string(),
            }
        })
        .collect();
    let out = Mutex::new(fs::File::create(out_path).map_err(|e| format!("{out_path}: {e}"))?);
    let next = AtomicUsize::new(0);
    let done = AtomicUsize::new(0);
    let positions = AtomicUsize::new(0);
    std::thread::scope(|scope| {
        for _ in 0..threads {
            scope.spawn(|| {
                let mut searcher = Searcher::new(17);
                loop {
                    let i = next.fetch_add(1, Ordering::Relaxed);
                    let Some(start) = starts.get(i) else { break };
                    let Some(lines) = play(&mut searcher, start, limits, i as u64) else { continue };
                    positions.fetch_add(lines.len(), Ordering::Relaxed);
                    out.lock().unwrap().write_all(lines.concat().as_bytes()).ok();
                    let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                    if n.is_multiple_of(100) {
                        eprint!("\r{n}/{} battles, {} positions  ", starts.len(), positions.load(Ordering::Relaxed));
                    }
                }
            });
        }
    });
    eprintln!(
        "\r{} battles, {} positions written to {out_path}",
        done.load(Ordering::Relaxed),
        positions.load(Ordering::Relaxed)
    );
    Ok(())
}

/// Plays one battle; returns its positions as output lines (None if the start can't be read).
fn play(searcher: &mut Searcher, start: &Start, limits: Limits, seed: u64) -> Option<Vec<String>> {
    let (size, two_kings) = acc_core::parse_variant(&start.variant)?;
    let mut pos = Position::from_fen(size, &start.fen, two_kings).ok()?;
    searcher.new_game();
    searcher.set_ply_limit(Some(start.limit));
    let mut rng = seed.wrapping_mul(0x2545_f491_4f6c_dd1d) ^ 0x5eed;
    let mut fens = Vec::new();
    let mut plies = 0;
    let winner = loop {
        if let Some(w) = battle::result(&mut pos, plies, Some(start.limit)) {
            break w;
        }
        fens.push(pos.fen());
        let lines = searcher.search_picks(&mut pos, limits, MULTI_PV, PICK_MARGIN);
        let best = lines.iter().map(|l| l.score).max()?;
        let pool: Vec<_> = lines.iter().filter(|l| l.score >= best - PICK_MARGIN).collect();
        let pick = pool[(splitmix(&mut rng) % pool.len() as u64) as usize];
        pos.make(pick.mv);
        plies += 1;
    };
    let score = winner.white_score();
    Some(fens.into_iter().map(|f| format!("{};{};{}\n", start.variant, score, f)).collect())
}
