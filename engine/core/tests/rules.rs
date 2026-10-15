use acc_core::parse_variant;
use acc_core::position::{Position, perft};

fn pos(variant: &str, fen: &str) -> Position {
    let (size, two_kings) = parse_variant(variant).unwrap();
    Position::from_fen(size, fen, two_kings).unwrap()
}

fn moves(variant: &str, fen: &str) -> Vec<String> {
    let mut p = pos(variant, fen);
    let mut names: Vec<String> = p.legal_moves().into_iter().map(|m| p.move_name(m)).collect();
    names.sort();
    names
}

fn sorted(list: &str) -> Vec<String> {
    let mut v: Vec<String> = list.split_whitespace().map(String::from).collect();
    v.sort();
    v
}

const START: &str = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1";

#[test]
fn standard_chess_perft() {
    // The standard start position has no castling or en passant captures before depth 5.
    let mut p = pos("acc8", START);
    assert_eq!([1, 2, 3, 4].map(|d| perft(&mut p, d)), [20, 400, 8902, 197_281]);
}

#[test]
fn fen_round_trips() {
    for (v, fen) in
        [("acc8", START), ("acc5", "r1k2/ppep1/5/1PXP1/1NK2 w - - 0 1"), ("acc9", "4k4/2p6/9/9/9/9/9/9/4K4 b - - 3 7")]
    {
        assert_eq!(pos(v, fen).fen(), fen);
    }
}

// Expected moves below were read from ffish (Fairy-Stockfish) on the same positions.

#[test]
fn promotion_is_to_queen_rook_bishop_or_knight() {
    assert_eq!(moves("acc5", "4k/P4/5/5/K4 w - - 0 1"), sorted("a4a5q a4a5r a4a5b a4a5n a1b1 a1a2 a1b2"));
}

#[test]
fn berolina_pawn() {
    assert_eq!(moves("acc8", "4k3/8/8/8/8/8/3E4/4K3 w - - 0 1"), sorted("d2c3 d2e3 d2b4 d2f4 e1d1 e1f1 e1e2 e1f2"));
    assert_eq!(moves("acc8", "4k3/8/8/8/8/3E4/8/4K3 w - - 0 1"), sorted("d3c4 d3e4 e1d1 e1f1 e1d2 e1e2 e1f2"));
    assert_eq!(moves("acc8", "4k3/8/8/8/8/4p3/3E4/4K3 w - - 0 1"), sorted("d2c3 d2b4 e1d1 e1f1 e1e2"));
    assert_eq!(moves("acc5", "2k2/1e3/5/5/2K2 b - - 0 1"), sorted("b4d2 b4a3 b4c3 c5c4 c5d4 c5b5 c5d5"));
}

#[test]
fn double_steps_only_from_the_second_rank() {
    assert_eq!(moves("acc9", "4k4/9/9/9/9/9/9/2P6/4K4 w - - 0 1"), sorted("c2c3 c2c4 e1d1 e1f1 e1d2 e1e2 e1f2"));
    assert_eq!(moves("acc9", "4k4/2p6/9/9/9/9/9/9/4K4 b - - 0 1"), sorted("c8c7 c8c6 e9d8 e9e8 e9f8 e9d9 e9f9"));
}

#[test]
fn en_passant() {
    let mut p = pos("acc8", "4k3/3p4/8/4P3/8/8/8/4K3 b - - 0 1");
    let m = p.parse_move("d7d5").unwrap();
    p.make(m);
    assert_eq!(p.fen(), "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
    assert!(p.legal_moves().into_iter().any(|m| p.move_name(m) == "e5d6"));
    // No pawn to take it: no en passant square.
    let mut q = pos("acc8", "4k3/8/8/8/8/8/3P4/4K3 w - - 0 1");
    let m = q.parse_move("d2d4").unwrap();
    q.make(m);
    assert_eq!(q.fen(), "4k3/8/8/8/3P4/8/8/4K3 b - - 0 1");
    // A pawn takes a Berolina pawn's diagonal double step on the square it passed.
    let mut r = pos("acc8", "4k3/8/8/8/3p4/8/3E4/4K3 w - - 0 1");
    let m = r.parse_move("d2b4").unwrap();
    r.make(m);
    assert_eq!(r.fen(), "4k3/8/8/8/1E1p4/8/8/4K3 b - c3b4 1 1");
    let names: Vec<String> = r.legal_moves().into_iter().map(|m| r.move_name(m)).collect();
    assert!(names.contains(&"d4c3".to_string()));
    let m = r.parse_move("d4c3").unwrap();
    r.make(m);
    assert_eq!(r.fen(), "4k3/8/8/8/8/2p5/8/4K3 w - - 0 2");
}

#[test]
fn two_kings() {
    // With two kings neither is royal: either may be left attacked.
    assert_eq!(moves("acc8k2", "4k3/8/8/8/8/8/r7/K3K3 w - - 0 1"), sorted("a1b1 a1a2 a1b2 e1d1 e1f1 e1d2 e1e2 e1f2"));
    assert!(!pos("acc8k2", "4k3/8/8/8/8/8/8/K3K2r w - - 0 1").in_check());
    // The last king is royal.
    let p = pos("acc8k2", "4k3/8/8/8/8/8/8/r3K3 w - - 0 1");
    assert!(p.in_check());
    assert_eq!(moves("acc8k2", "4k3/8/8/8/8/8/8/r3K3 w - - 0 1"), sorted("e1f2 e1e2 e1d2"));
}

#[test]
fn cannon_and_grasshopper() {
    assert_eq!(
        moves("acc8", "4k3/8/3n4/8/3P4/8/3X4/4K3 w - - 0 1"),
        sorted("d4d5 d2d1 d2a2 d2b2 d2c2 d2e2 d2f2 d2g2 d2h2 d2d3 d2d6 e1d1 e1f1 e1e2 e1f2")
    );
    assert_eq!(moves("acc8", "4k3/8/8/8/3P4/8/3G4/4K3 w - - 0 1"), sorted("d4d5 d2d5 e1d1 e1f1 e1e2 e1f2"));
    assert!(pos("acc8", "4k3/8/8/4p3/8/8/8/K3X3 b - - 0 1").in_check());
    assert!(pos("acc8", "4k3/4p3/8/8/8/8/8/K3G3 b - - 0 1").in_check());
}

#[test]
fn insufficient_material() {
    let ins = |v: &str, f: &str| pos(v, &format!("{f} w - - 0 1")).insufficient_material();
    for (f, want) in [
        ("4k3/8/8/8/8/8/8/4K3", true),
        ("4k3/8/8/8/8/8/8/3BK3", true),
        ("4k3/8/8/8/8/8/8/3NK3", true),
        ("3nk3/8/8/8/8/8/8/3NK3", false),
        ("3bk3/8/8/8/8/8/8/2B1K3", true),
        ("2b1k3/8/8/8/8/8/8/2B1K3", false),
        ("4k3/8/8/8/8/8/8/1B1BK3", true),
        ("4k3/8/8/8/8/8/8/1BB1K3", false),
        ("4k3/8/8/8/8/8/8/3FK3", false),
        ("4k3/8/8/8/8/8/8/3PK3", false),
    ] {
        assert_eq!(ins("acc8", f), want, "{f}");
    }
    assert!(!ins("acc8k2", "4k3/8/8/8/8/8/8/4K3"));
}

#[test]
fn threefold_repetition() {
    let mut p = pos("acc8", "4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    let cycle = ["a1a2", "e8d8", "a2a1", "d8e8"];
    for ply in 0..8 {
        assert!(!p.is_threefold(), "ply {ply}");
        let m = p.parse_move(cycle[ply % 4]).unwrap();
        p.make(m);
    }
    assert!(p.is_threefold());
}

#[test]
fn make_unmake_restores_everything() {
    let mut p = pos("acc8", "r3k2r/pPpp1ppp/1n3n2/2bPp3/1pB1P3/2N2N2/PPPP1PPP/R3K2R w - e6 0 3");
    let before = (p.fen(), p.hash());
    for m in p.legal_moves() {
        p.make(m);
        p.unmake();
        assert_eq!((p.fen(), p.hash()), before);
    }
}
