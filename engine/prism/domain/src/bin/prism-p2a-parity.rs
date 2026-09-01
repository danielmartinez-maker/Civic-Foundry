use std::env;
use std::fs;
use std::process::ExitCode;

use prism_domain::parity::report::{P2AParityCase, run_parity_case};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let path = args
        .next()
        .ok_or_else(|| "usage: prism-p2a-parity <case.json>".to_owned())?;
    if args.next().is_some() {
        return Err("usage: prism-p2a-parity <case.json>".to_owned());
    }

    let bytes = fs::read(&path).map_err(|error| format!("failed to read {path}: {error}"))?;
    let case: P2AParityCase =
        serde_json::from_slice(&bytes).map_err(|error| format!("invalid parity case: {error}"))?;
    let report = run_parity_case(case).map_err(|error| format!("P2A parity import failed: {error}"))?;
    let json = serde_json::to_string(&report)
        .map_err(|error| format!("failed to encode parity report: {error}"))?;
    println!("{json}");
    Ok(())
}
