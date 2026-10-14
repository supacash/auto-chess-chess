//! The game's pieces: letter, movement (Betza notation) and kind. Must match src/rules/pieces.ts; the
//! WASM test `pieces match the game` checks every fairy piece's Betza string against it.

/// A piece type, an index into [`PIECES`].
pub type PieceType = u8;

pub struct PieceDef {
    pub letter: u8,
    /// Movement in Betza notation. The standard pieces use the same notation for their moves
    /// (the pawn's double step is `ifmnD`: initial, forward, move-only, non-jumping two-step).
    pub betza: &'static str,
    /// Promotes on the last rank and can't stand on its own back rank (the pawn and the Berolina pawn).
    pub pawn: bool,
    /// A king (the King, or the Heir: a second king in the two-kings rules).
    pub king: bool,
}

const fn def(letter: u8, betza: &'static str) -> PieceDef {
    PieceDef { letter, betza, pawn: false, king: false }
}

pub const PIECES: &[PieceDef] = &[
    PieceDef { letter: b'K', betza: "K", pawn: false, king: true },
    PieceDef { letter: b'J', betza: "K", pawn: false, king: true },
    def(b'Q', "Q"),
    def(b'R', "R"),
    def(b'B', "B"),
    def(b'N', "N"),
    PieceDef { letter: b'P', betza: "fmWfcFifmnD", pawn: true, king: false },
    PieceDef { letter: b'E', betza: "mfFcfWifmnF2", pawn: true, king: false },
    def(b'F', "F"),
    def(b'W', "W"),
    def(b'M', "WF"),
    def(b'L', "C"),
    def(b'G', "gQ"),
    def(b'X', "mRcpR"),
    def(b'T', "KN"),
    def(b'A', "BN"),
    def(b'C', "RN"),
    def(b'Z', "QN"),
    def(b'D', "RF"),
    def(b'H', "BW"),
    def(b'U', "NC"),
    def(b'S', "mQcpQ"),
    def(b'Y', "KNAD"),
];

pub const KING: PieceType = 0;
pub const HEIR: PieceType = 1;
pub const QUEEN: PieceType = 2;
pub const ROOK: PieceType = 3;
pub const BISHOP: PieceType = 4;
pub const KNIGHT: PieceType = 5;
pub const PAWN: PieceType = 6;

/// What a pawn promotes to, in the order the moves are listed.
pub const PROMOTIONS: [PieceType; 4] = [QUEEN, ROOK, BISHOP, KNIGHT];

pub const PIECE_COUNT: usize = PIECES.len();

pub fn piece_type(letter: u8) -> Option<PieceType> {
    let upper = letter.to_ascii_uppercase();
    PIECES.iter().position(|p| p.letter == upper).map(|i| i as PieceType)
}
