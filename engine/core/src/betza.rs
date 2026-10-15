//! A Betza notation parser for the subset the game's pieces use.
//!
//! Atoms: W F D A N C (leapers), K = WF, R B Q (riders, Q = RB). A number after an atom makes it a
//! rider limited to that many steps (`F2`). Modifiers apply to the next atom: `m` move only,
//! `c` capture only, `f` forward only, `i` only from the double-step region (a pawn's first move),
//! `n` non-jumping (the squares in between must be empty), `p` hop over a screen first (cannon),
//! `g` land just past the first piece in line (grasshopper).

/// How a component may land on its target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Both,
    Move,
    Capture,
}

impl Mode {
    pub fn moves(self) -> bool {
        self != Mode::Capture
    }
    pub fn captures(self) -> bool {
        self != Mode::Move
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Jumps straight to (dx, dy).
    Leap,
    /// Slides along (dx, dy) up to `max` steps (0 = unlimited) until blocked.
    Ride,
    /// Cannon: slides to a screen, hops it, then lands beyond.
    Hop,
    /// Grasshopper: lands on the square just past the first piece in line.
    Grass,
}

/// One direction of one atom, in white's orientation (dy > 0 is forward).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Component {
    pub kind: Kind,
    pub dx: i8,
    pub dy: i8,
    pub max: u8,
    pub mode: Mode,
    pub initial: bool,
    pub lame: bool,
}

fn leaper(atom: u8) -> Option<(i8, i8)> {
    Some(match atom {
        b'W' => (1, 0),
        b'F' => (1, 1),
        b'D' => (2, 0),
        b'A' => (2, 2),
        b'N' => (2, 1),
        b'C' => (3, 1),
        _ => return None,
    })
}

/// All distinct (dx, dy) symmetric images of a leap.
fn symmetries(dx: i8, dy: i8) -> Vec<(i8, i8)> {
    let mut out: Vec<(i8, i8)> = Vec::new();
    for (a, b) in [(dx, dy), (dy, dx)] {
        for (sx, sy) in [(1, 1), (1, -1), (-1, 1), (-1, -1)] {
            let v = (a * sx, b * sy);
            if !out.contains(&v) {
                out.push(v);
            }
        }
    }
    out
}

/// Parses `betza` into components. Panics on notation outside the supported subset, so a new piece
/// with unsupported movement fails its unit test instead of moving wrongly.
pub fn parse(betza: &str) -> Vec<Component> {
    let bytes = betza.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        let (mut mode, mut forward, mut initial, mut lame, mut kind_mod) = (Mode::Both, false, false, false, None);
        while i < bytes.len() && bytes[i].is_ascii_lowercase() {
            match bytes[i] {
                b'm' => mode = Mode::Move,
                b'c' => mode = Mode::Capture,
                b'f' => forward = true,
                b'i' => initial = true,
                b'n' => lame = true,
                b'p' => kind_mod = Some(Kind::Hop),
                b'g' => kind_mod = Some(Kind::Grass),
                other => panic!("unsupported Betza modifier '{}' in {betza}", other as char),
            }
            i += 1;
        }
        let atom = *bytes.get(i).unwrap_or_else(|| panic!("Betza {betza} ends without an atom"));
        i += 1;
        let mut range = 0u8;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            range = range * 10 + (bytes[i] - b'0');
            i += 1;
        }
        // (base step, rider?) pairs for this atom.
        let steps: Vec<((i8, i8), bool)> = match atom {
            b'K' => vec![((1, 0), false), ((1, 1), false)],
            b'R' => vec![((1, 0), true)],
            b'B' => vec![((1, 1), true)],
            b'Q' => vec![((1, 0), true), ((1, 1), true)],
            _ => {
                let step =
                    leaper(atom).unwrap_or_else(|| panic!("unsupported Betza atom '{}' in {betza}", atom as char));
                vec![(step, range > 0)]
            }
        };
        for ((dx, dy), rider) in steps {
            let kind = match (kind_mod, rider) {
                (Some(k), _) => k,
                (None, true) => Kind::Ride,
                (None, false) => Kind::Leap,
            };
            if kind != Kind::Leap && (dx.abs() > 1 || dy.abs() > 1) {
                panic!("only W and F lines can slide or hop in {betza}");
            }
            for (x, y) in symmetries(dx, dy) {
                if forward && y <= 0 {
                    continue;
                }
                out.push(Component {
                    kind,
                    dx: x,
                    dy: y,
                    max: if kind == Kind::Leap { 1 } else { range },
                    mode,
                    initial,
                    lame,
                });
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pieces::PIECES;

    #[test]
    fn every_piece_parses() {
        for p in PIECES {
            assert!(!parse(p.betza).is_empty(), "{}", p.letter as char);
        }
    }

    #[test]
    fn knight_has_eight_leaps() {
        let n = parse("N");
        assert_eq!(n.len(), 8);
        assert!(n.iter().all(|c| c.kind == Kind::Leap && c.mode == Mode::Both));
    }

    #[test]
    fn berolina_pawn() {
        let e = parse("mfFcfWifmnF2");
        let moves: Vec<_> = e.iter().filter(|c| c.mode == Mode::Move && !c.initial).collect();
        assert_eq!(moves.len(), 2); // forward diagonals
        let captures: Vec<_> = e.iter().filter(|c| c.mode == Mode::Capture).collect();
        assert_eq!(captures.len(), 1);
        assert_eq!((captures[0].dx, captures[0].dy), (0, 1));
        let double: Vec<_> = e.iter().filter(|c| c.initial).collect();
        assert_eq!(double.len(), 2);
        assert!(double.iter().all(|c| c.kind == Kind::Ride && c.max == 2 && c.lame));
    }

    #[test]
    fn cannon_moves_like_a_rook_and_captures_by_hopping() {
        let x = parse("mRcpR");
        assert_eq!(x.iter().filter(|c| c.kind == Kind::Ride && c.mode == Mode::Move).count(), 4);
        assert_eq!(x.iter().filter(|c| c.kind == Kind::Hop && c.mode == Mode::Capture).count(), 4);
    }

    #[test]
    #[should_panic]
    fn unsupported_notation_panics() {
        parse("bW");
    }
}
