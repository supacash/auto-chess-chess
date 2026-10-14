use acc_core::parse_variant;
use acc_core::position::Position;
use acc_core::search::{Limits, MATE, Searcher, game_score};

fn pos(variant: &str, fen: &str) -> Position {
    let (size, two_kings) = parse_variant(variant).unwrap();
    Position::from_fen(size, fen, two_kings).unwrap()
}

fn best(variant: &str, fen: &str, depth: u32) -> (String, i32) {
    let mut p = pos(variant, fen);
    let mut s = Searcher::new(16);
    let lines = s.search(&mut p, Limits { depth, nodes: 0 }, 1);
    (p.move_name(lines[0].mv), lines[0].score)
}

#[test]
fn finds_mate_in_one() {
    // Back-rank mate.
    let (m, score) = best("acc8", "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 3);
    assert_eq!(m, "a1a8");
    assert_eq!(score, MATE - 1);
    assert_eq!(game_score(score), 100_000 - 100); // pick.ts: mate in 1
}

#[test]
fn finds_mate_in_two() {
    // Two rooks: a ladder mate in two.
    let (_, score) = best("acc8", "7k/8/8/8/8/8/R7/1R4K1 w - - 0 1", 5);
    assert_eq!(score, MATE - 3);
}

#[test]
fn sees_being_mated() {
    // White can only push the h-pawn; then Qb2 is mate.
    let (_, score) = best("acc8", "8/8/8/8/8/1q6/2k4P/K7 w - - 0 1", 4);
    assert_eq!(score, -MATE + 2);
    assert_eq!(game_score(-MATE + 2), -100_000 + 100); // pick.ts: mated in 1
}

#[test]
fn takes_a_hanging_queen() {
    let (m, _) = best("acc8", "4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", 4);
    assert_eq!(m, "d2d5");
}

#[test]
fn fairy_pieces_search() {
    // A cannon capture behind a screen wins the queen.
    let (m, _) = best("acc8", "4k3/8/3q4/8/3P4/8/3X4/4K3 w - - 0 1", 4);
    assert_eq!(m, "d2d6");
}

#[test]
fn multipv_lines_are_distinct_and_sorted() {
    let mut p = pos("acc8", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1");
    let mut s = Searcher::new(16);
    let lines = s.search(&mut p, Limits { depth: 4, nodes: 0 }, 3);
    assert_eq!(lines.len(), 3);
    assert!(lines[0].mv != lines[1].mv && lines[1].mv != lines[2].mv && lines[0].mv != lines[2].mv);
    assert!(lines[0].score >= lines[1].score && lines[1].score >= lines[2].score);
}

#[test]
fn deterministic() {
    let fen = "r1bqk1nr/pppp1ppp/8/8/8/8/PPPPPPPP/RNBQKBJR w - - 0 1";
    let run = || {
        let mut p = pos("acc8k2", fen);
        let mut s = Searcher::new(16);
        let mut out = Vec::new();
        for _ in 0..6 {
            let lines = s.search(&mut p, Limits { depth: 5, nodes: 20_000 }, 3);
            out.push((lines.clone(), s.nodes()));
            p.make(lines[0].mv);
        }
        out
    };
    assert_eq!(run(), run());
}
