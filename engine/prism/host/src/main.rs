#![forbid(unsafe_code)]

use std::process::ExitCode;

fn main() -> ExitCode {
    match prism_core::bootstrap::run_bootstrap_probe() {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("PRISM_BOOTSTRAP_ERROR {error:?}");
            ExitCode::FAILURE
        }
    }
}
