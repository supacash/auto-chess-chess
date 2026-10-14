//! WebAssembly bindings for the engine. Single-threaded on purpose: no SharedArrayBuffer, so the
//! page needs no cross-origin isolation.

use acc_core::position::{self, Position};
use wasm_bindgen::prelude::*;

/// The engine's version (acc_core::ENGINE_VERSION).
#[wasm_bindgen(js_name = engineVersion)]
pub fn engine_version() -> u32 {
    acc_core::ENGINE_VERSION
}

/// The Betza movement the engine uses for a piece letter (to check it against src/rules/pieces.ts).
#[wasm_bindgen(js_name = pieceBetza)]
pub fn piece_betza(letter: char) -> Option<String> {
    let ty = acc_core::pieces::piece_type(letter as u8)?;
    Some(acc_core::pieces::PIECES[ty as usize].betza.to_string())
}

/// A position being played, with the same methods as ffish's Board (src/chess/rules.ts uses them).
#[wasm_bindgen]
pub struct Board {
    pos: Position,
}

#[wasm_bindgen]
impl Board {
    /// `variant` is `accN` or `accNk2` (the two-kings rules). Heirs may be written 'J'.
    #[wasm_bindgen(constructor)]
    pub fn new(variant: &str, fen: &str) -> Result<Board, JsError> {
        let (size, two_kings) =
            acc_core::parse_variant(variant).ok_or_else(|| JsError::new(&format!("unknown variant {variant}")))?;
        let pos =
            Position::from_fen(size, fen, two_kings).map_err(|e| JsError::new(&format!("bad FEN {fen}: {e:?}")))?;
        Ok(Board { pos })
    }

    pub fn fen(&self) -> String {
        self.pos.fen()
    }

    /// True when white is to move.
    pub fn turn(&self) -> bool {
        self.pos.side() == position::WHITE
    }

    #[wasm_bindgen(js_name = isCheck)]
    pub fn is_check(&self) -> bool {
        self.pos.in_check()
    }

    /// Legal moves in UCI notation, separated by spaces.
    #[wasm_bindgen(js_name = legalMoves)]
    pub fn legal_moves(&mut self) -> String {
        let moves = self.pos.legal_moves();
        moves.iter().map(|&m| self.pos.move_name(m)).collect::<Vec<_>>().join(" ")
    }

    #[wasm_bindgen(js_name = numberLegalMoves)]
    pub fn number_legal_moves(&mut self) -> u32 {
        self.pos.legal_moves().len() as u32
    }

    /// Plays a UCI move; false (and nothing changes) if it isn't legal.
    pub fn push(&mut self, uci: &str) -> bool {
        match self.pos.parse_move(uci) {
            Some(m) => {
                self.pos.make(m);
                true
            }
            None => false,
        }
    }

    /// Takes back the last move pushed.
    pub fn pop(&mut self) {
        if self.pos.ply() > 0 {
            self.pos.unmake();
        }
    }

    #[wasm_bindgen(js_name = isInsufficientMaterial)]
    pub fn is_insufficient_material(&self) -> bool {
        self.pos.insufficient_material()
    }

    #[wasm_bindgen(js_name = halfmoveClock)]
    pub fn halfmove_clock(&self) -> u32 {
        self.pos.halfmove() as u32
    }

    /// The position has occurred three times since the last pawn move or capture.
    #[wasm_bindgen(js_name = isThreefold)]
    pub fn is_threefold(&self) -> bool {
        self.pos.is_threefold()
    }

    pub fn perft(&mut self, depth: u32) -> f64 {
        position::perft(&mut self.pos, depth) as f64
    }

    /// Same as free(), under ffish's name.
    pub fn delete(self) {}
}

/// The engine's search, with its transposition table kept between moves of a battle.
#[wasm_bindgen]
pub struct Searcher {
    inner: acc_core::search::Searcher,
    limits: acc_core::search::Limits,
    multipv: usize,
    margin: i32,
}

impl Default for Searcher {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl Searcher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Searcher {
        Searcher {
            inner: acc_core::search::Searcher::default(),
            limits: acc_core::search::Limits { depth: 8, nodes: 0 },
            multipv: 1,
            margin: 0,
        }
    }

    /// Forgets everything learned (at the start of each battle, so battles replay exactly).
    #[wasm_bindgen(js_name = newGame)]
    pub fn new_game(&mut self) {
        self.inner.new_game();
    }

    /// Searches the position reached from `fen` by `moves` (UCI, space-separated) and returns up to
    /// `multipv` lines as "move score move score …", best first. Scores are for the side to move, in
    /// centipawns, with mates encoded as src/engine/pick.ts reads them. With a `margin`, the lines after
    /// the first are moves within it of the best, scored at best - margin (Searcher::search_picks).
    pub fn candidates(&mut self, variant: &str, fen: &str, moves: &str) -> Result<String, JsError> {
        let mut board = Board::new(variant, fen)?;
        for m in moves.split_whitespace() {
            if !board.push(m) {
                return Err(JsError::new(&format!("illegal move {m} in {fen}")));
            }
        }
        let lines = if self.margin > 0 {
            self.inner.search_picks(&mut board.pos, self.limits, self.multipv, self.margin)
        } else {
            self.inner.search(&mut board.pos, self.limits, self.multipv)
        };
        Ok(lines
            .iter()
            .map(|l| format!("{} {}", board.pos.move_name(l.mv), acc_core::search::game_score(l.score)))
            .collect::<Vec<_>>()
            .join(" "))
    }

    /// How candidates() searches: plies, a node budget (0 = none), how many lines, and the pick margin
    /// (0 = exact MultiPV; see candidates).
    pub fn configure(&mut self, depth: u32, nodes: f64, multipv: u32, margin: i32) {
        self.limits = acc_core::search::Limits { depth, nodes: nodes as u64 };
        self.multipv = multipv.max(1) as usize;
        self.margin = margin;
    }

    /// The battle ends on points this many plies after the `fen` passed to candidates (0: no limit).
    #[wasm_bindgen(js_name = setPlyLimit)]
    pub fn set_ply_limit(&mut self, plies: u32) {
        self.inner.set_ply_limit((plies > 0).then_some(plies as usize));
    }

    /// Nodes searched by the last call.
    pub fn nodes(&self) -> f64 {
        self.inner.nodes() as f64
    }
}
