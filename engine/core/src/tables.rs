//! Per-board-size movement tables: every piece's targets from every square, compiled once from its
//! Betza notation. Square index = rank * files + file, rank 0 at white's side.

use crate::betza::{self, Kind, Mode};
use crate::pieces::{PIECE_COUNT, PIECES};
use std::sync::OnceLock;

pub type Square = u8;
pub const NO_SQUARE: Square = u8::MAX;
pub const MAX_SIZE: usize = 9;
pub const MAX_SQUARES: usize = MAX_SIZE * MAX_SIZE;

/// The eight line directions: orthogonal first, then diagonal. Forward is +dy for white.
pub const DIRS: [(i8, i8); 8] = [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (1, -1), (-1, -1), (-1, 1)];

/// OPPOSITE[d] is the direction opposite DIRS[d].
pub const OPPOSITE: [usize; 8] = [2, 3, 0, 1, 6, 7, 4, 5];

fn dir_index(dx: i8, dy: i8) -> usize {
    DIRS.iter().position(|&d| d == (dx, dy)).expect("line direction")
}

/// A leap target from one square.
#[derive(Clone, Copy, Debug)]
pub struct Leap {
    pub to: Square,
    pub mode: Mode,
    pub initial: bool,
    /// The square that must be empty for a non-jumping leap, or NO_SQUARE.
    pub via: Square,
}

/// A line move from one square: slide, hop or grasshopper along `dir` (an index into DIRS).
#[derive(Clone, Copy, Debug)]
pub struct Line {
    pub kind: Kind,
    pub dir: u8,
    /// Most steps (0 = to the edge).
    pub max: u8,
    pub mode: Mode,
    pub initial: bool,
}

/// One piece's movement for one colour.
pub struct PieceMoves {
    /// Leap targets per square.
    pub leaps: Vec<Vec<Leap>>,
    /// Line moves (the same from every square; the rays end at the edge).
    pub lines: Vec<Line>,
    /// Two components can reach the same square (the Berolina pawn's one- and two-step), so its
    /// moves need deduplicating.
    pub overlaps: bool,
}

/// Capture patterns used to test whether a square is attacked, as bitmasks of piece types.
pub struct Attacks {
    /// (dx, dy, piece types that capture with that leap), for a piece of the colour the table is for.
    pub leaps: Vec<(i8, i8, u32)>,
    /// Per direction: piece types that capture by sliding / hopping a screen / grasshopping along it.
    pub ride: [u32; 8],
    pub hop: [u32; 8],
    pub grass: [u32; 8],
}

pub struct Tables {
    pub files: u8,
    pub ranks: u8,
    pub squares: usize,
    /// (file, rank) of every square, so file() and rank() don't divide.
    coords: [(i8, i8); MAX_SQUARES],
    /// rays[sq][dir]: the squares from sq towards the edge.
    pub rays: Vec<[Vec<Square>; 8]>,
    /// moves[color][piece type]
    pub moves: [Vec<PieceMoves>; 2],
    /// attacks[color]: how pieces of that colour capture.
    pub attacks: [Attacks; 2],
}

impl Tables {
    pub fn square(&self, file: i32, rank: i32) -> Option<Square> {
        if file < 0 || rank < 0 || file >= self.files as i32 || rank >= self.ranks as i32 {
            None
        } else {
            Some((rank * self.files as i32 + file) as Square)
        }
    }

    pub fn file(&self, sq: Square) -> i32 {
        self.coords[sq as usize].0 as i32
    }

    pub fn rank(&self, sq: Square) -> i32 {
        self.coords[sq as usize].1 as i32
    }

    fn build(files: u8, ranks: u8) -> Tables {
        let squares = files as usize * ranks as usize;
        let mut t = Tables {
            files,
            ranks,
            squares,
            coords: std::array::from_fn(|sq| ((sq % files as usize) as i8, (sq / files as usize) as i8)),
            rays: Vec::new(),
            moves: [Vec::new(), Vec::new()],
            attacks: [empty_attacks(), empty_attacks()],
        };
        t.rays = (0..squares)
            .map(|sq| {
                std::array::from_fn(|d| {
                    let (dx, dy) = DIRS[d];
                    let (mut f, mut r) = (t.file(sq as Square), t.rank(sq as Square));
                    let mut ray = Vec::new();
                    while let Some(s) = t.square(f + dx as i32, r + dy as i32) {
                        ray.push(s);
                        f += dx as i32;
                        r += dy as i32;
                    }
                    ray
                })
            })
            .collect();
        for color in 0..2 {
            let flip: i8 = if color == 0 { 1 } else { -1 };
            for (ty, def) in PIECES.iter().enumerate() {
                let mut leaps = vec![Vec::new(); squares];
                let mut lines = Vec::new();
                for c in betza::parse(def.betza) {
                    let (dx, dy) = (c.dx, c.dy * flip);
                    match c.kind {
                        Kind::Leap => {
                            for (sq, list) in leaps.iter_mut().enumerate() {
                                let (f, r) = (t.file(sq as Square), t.rank(sq as Square));
                                let Some(to) = t.square(f + dx as i32, r + dy as i32) else {
                                    continue;
                                };
                                let via = if c.lame {
                                    if dx.abs() == dy.abs() || dx == 0 || dy == 0 {
                                        t.square(f + dx.signum() as i32, r + dy.signum() as i32).unwrap()
                                    } else {
                                        panic!("non-jumping {} leap isn't supported", def.letter as char);
                                    }
                                } else {
                                    NO_SQUARE
                                };
                                list.push(Leap { to, mode: c.mode, initial: c.initial, via });
                            }
                            if c.mode.captures() {
                                add_leap_attack(&mut t.attacks[color], dx, dy, ty);
                            }
                        }
                        kind => {
                            let dir = dir_index(dx, dy);
                            lines.push(Line { kind, dir: dir as u8, max: c.max, mode: c.mode, initial: c.initial });
                            if c.mode.captures() {
                                assert!(c.max == 0, "a limited-range line capture isn't supported");
                                let a = &mut t.attacks[color];
                                let mask = match kind {
                                    Kind::Ride => &mut a.ride,
                                    Kind::Hop => &mut a.hop,
                                    _ => &mut a.grass,
                                };
                                mask[dir] |= 1 << ty;
                            }
                        }
                    }
                }
                let reach = |sq: usize| {
                    let mut targets: Vec<(Square, bool)> = leaps[sq].iter().map(|l| (l.to, l.initial)).collect();
                    for l in &lines {
                        let ray = &t.rays[sq][l.dir as usize];
                        let n = if l.max == 0 { ray.len() } else { ray.len().min(l.max as usize) };
                        targets.extend(ray[..n].iter().map(|&s| (s, l.initial)));
                    }
                    let mut sorted: Vec<Square> = targets.iter().map(|x| x.0).collect();
                    sorted.sort_unstable();
                    sorted.windows(2).any(|w| w[0] == w[1])
                };
                let overlaps = (0..squares).any(reach);
                t.moves[color].push(PieceMoves { leaps, lines, overlaps });
            }
        }
        assert_eq!(t.moves[0].len(), PIECE_COUNT);
        t
    }
}

fn empty_attacks() -> Attacks {
    Attacks { leaps: Vec::new(), ride: [0; 8], hop: [0; 8], grass: [0; 8] }
}

fn add_leap_attack(a: &mut Attacks, dx: i8, dy: i8, ty: usize) {
    match a.leaps.iter_mut().find(|l| l.0 == dx && l.1 == dy) {
        Some(l) => l.2 |= 1 << ty,
        None => a.leaps.push((dx, dy, 1 << ty)),
    }
}

static TABLES: [OnceLock<Tables>; MAX_SIZE + 1] = [const { OnceLock::new() }; MAX_SIZE + 1];

/// The tables for an n×n board (5 ≤ n ≤ 9), built on first use.
pub fn tables(size: u8) -> &'static Tables {
    assert!((2..=MAX_SIZE as u8).contains(&size), "unsupported board size {size}");
    TABLES[size as usize].get_or_init(|| Tables::build(size, size))
}
