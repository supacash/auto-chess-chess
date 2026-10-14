//! `acc tune`: fits the evaluation's weights to self-play results (Texel tuning).
//!
//!   acc tune <selfplay.txt> [--epochs N] [--max M] [--out core/src/params.rs]
//!
//! Keeps quiet positions (not in check, and the quiescence search agrees with the static
//! evaluation), then minimises the squared error between each battle's result (white's score) and a
//! sigmoid of the evaluation, by gradient descent (Adam) on all weights at once. The evaluation is
//! linear in its weights (eval::features), so the gradient is exact. A small pull towards the
//! starting weights keeps rarely seen pieces from drifting.

use acc_core::eval::{self, TEMPO, TERMS, WEIGHT_COUNT};
use acc_core::position::{Position, WHITE};
use acc_core::search::Searcher;
use std::fs;
use std::io::Write;

struct Sample {
    x: Vec<(u16, i16)>,
    /// Middlegame share of the blend, 0..1.
    mg: f32,
    /// +1 when white is to move (tempo), else -1.
    side: f32,
    result: f32,
}

pub fn run(args: &[String]) -> Result<(), String> {
    let path = args.first().ok_or("self-play data file")?;
    let (mut epochs, mut max, mut out) = (400usize, 4_000_000usize, "core/src/params.rs".to_string());
    let mut i = 1;
    while i + 1 < args.len() {
        let v = &args[i + 1];
        match args[i].as_str() {
            "--epochs" => epochs = v.parse().map_err(|_| "--epochs")?,
            "--max" => max = v.parse().map_err(|_| "--max")?,
            "--out" => out = v.clone(),
            other => return Err(format!("unknown option {other}")),
        }
        i += 2;
    }
    let text = fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let mut searcher = Searcher::new(10);
    let mut samples = Vec::new();
    let (mut read, mut noisy) = (0usize, 0usize);
    for line in text.lines() {
        if samples.len() >= max {
            break;
        }
        let mut p = line.splitn(3, ';');
        let (Some(variant), Some(result), Some(fen)) = (p.next(), p.next(), p.next()) else { continue };
        let Some((size, two_kings)) = acc_core::parse_variant(variant) else { continue };
        let Ok(mut pos) = Position::from_fen(size, fen, two_kings) else { continue };
        read += 1;
        if read.is_multiple_of(50_000) {
            eprint!("\r{read} positions read, {} quiet  ", samples.len());
        }
        if pos.in_check() || searcher.qsearch_score(&mut pos, 5_000) != Some(eval::evaluate(&pos)) {
            noisy += 1;
            continue;
        }
        let (x, ph, phmax) = eval::features(&pos);
        samples.push(Sample {
            x: x.into_iter().map(|(k, v)| (k as u16, v as i16)).collect(),
            mg: ph as f32 / phmax as f32,
            side: if pos.side() == WHITE { 1.0 } else { -1.0 },
            result: result.parse().map_err(|_| format!("bad result in {line}"))?,
        });
    }
    eprintln!("{read} positions read, {noisy} not quiet, {} used", samples.len());
    if samples.is_empty() {
        return Err("no quiet positions".into());
    }

    let start: Vec<f64> = eval::weights().iter().map(|&w| w as f64).collect();
    let mut w = start.clone();
    let k = fit_k(&samples, &w);
    eprintln!("K = {k:.3}, starting error {:.6}", error(&samples, &w, k));

    // Adam.
    let (lr, b1, b2, eps, pull) = (2.0, 0.9, 0.999, 1e-8, 1e-7);
    let mut m = vec![0.0; WEIGHT_COUNT];
    let mut v = vec![0.0; WEIGHT_COUNT];
    for epoch in 1..=epochs {
        let mut g = vec![0.0f64; WEIGHT_COUNT];
        for s in &samples {
            let e = predict(s, &w);
            let p = sigmoid(k * e);
            let d = 2.0 * (p - s.result as f64) * p * (1.0 - p) * k;
            let (mg, eg) = (s.mg as f64, 1.0 - s.mg as f64);
            for &(t, x) in &s.x {
                let x = x as f64;
                g[2 * t as usize] += d * x * mg;
                g[2 * t as usize + 1] += d * x * eg;
            }
            g[TEMPO] += d * s.side as f64;
        }
        let n = samples.len() as f64;
        for j in 0..WEIGHT_COUNT {
            let grad = g[j] / n + pull * (w[j] - start[j]);
            m[j] = b1 * m[j] + (1.0 - b1) * grad;
            v[j] = b2 * v[j] + (1.0 - b2) * grad * grad;
            let mh = m[j] / (1.0 - b1.powi(epoch as i32));
            let vh = v[j] / (1.0 - b2.powi(epoch as i32));
            w[j] -= lr * mh / (vh.sqrt() + eps);
        }
        if epoch % 50 == 0 || epoch == epochs {
            eprintln!("epoch {epoch}: error {:.6}", error(&samples, &w, k));
        }
    }

    let tuned: Vec<i32> = w.iter().map(|x| x.round() as i32).collect();
    write_params(&out, &tuned)?;
    eprintln!("weights written to {out}");
    for (t, def) in acc_core::pieces::PIECES.iter().enumerate() {
        let j = 2 * eval::value_term(t);
        eprintln!("  {}: value {} / {}", def.letter as char, tuned[j], tuned[j + 1]);
    }
    Ok(())
}

fn sigmoid(x: f64) -> f64 {
    1.0 / (1.0 + (-x).exp())
}

/// White's evaluation in centipawns with weights `w` (as eval::evaluate, in floating point).
fn predict(s: &Sample, w: &[f64]) -> f64 {
    let (mut mg, mut eg) = (0.0, 0.0);
    for &(t, x) in &s.x {
        mg += w[2 * t as usize] * x as f64;
        eg += w[2 * t as usize + 1] * x as f64;
    }
    mg * s.mg as f64 + eg * (1.0 - s.mg as f64) + w[TEMPO] * s.side as f64
}

fn error(samples: &[Sample], w: &[f64], k: f64) -> f64 {
    samples.iter().map(|s| (s.result as f64 - sigmoid(k * predict(s, w))).powi(2)).sum::<f64>() / samples.len() as f64
}

/// The sigmoid scale that best fits the starting weights (golden-section search).
fn fit_k(samples: &[Sample], w: &[f64]) -> f64 {
    let (mut a, mut b) = (0.0001f64, 0.02f64);
    let r = (5f64.sqrt() - 1.0) / 2.0;
    for _ in 0..40 {
        let c = b - r * (b - a);
        let d = a + r * (b - a);
        if error(samples, w, c) < error(samples, w, d) {
            b = d;
        } else {
            a = c;
        }
    }
    (a + b) / 2.0
}

fn write_params(path: &str, w: &[i32]) -> Result<(), String> {
    let mut f = fs::File::create(path).map_err(|e| format!("{path}: {e}"))?;
    let body: Vec<String> = w
        .chunks(16)
        .map(|c| format!("    {},", c.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(", ")))
        .collect();
    writeln!(
        f,
        "//! Tuned evaluation weights, written by `acc tune` (see eval.rs for their layout: {TERMS} terms ×\n\
         //! (middlegame, endgame), then tempo). None uses eval::default_weights().\n\n\
         #[rustfmt::skip]\n\
         pub const TUNED: Option<&[i32]> = Some(&[\n{}\n]);",
        body.join("\n")
    )
    .map_err(|e| e.to_string())
}
