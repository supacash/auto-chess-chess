//! `acc`: the native engine. Commands are added as the engine grows (perft, self-play, tuning).

use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("version") => {
            println!("{}", acc_core::ENGINE_VERSION);
            ExitCode::SUCCESS
        }
        _ => {
            eprintln!("usage: acc version");
            ExitCode::FAILURE
        }
    }
}
