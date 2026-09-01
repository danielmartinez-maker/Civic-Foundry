#![forbid(unsafe_code)]

pub mod bootstrap;
pub mod diagnostics;
pub mod ecs;
pub mod entity;
pub mod jobs;
pub mod memory;
pub mod profiling;

pub const PRISM_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(test)]
mod tests {
    use super::PRISM_VERSION;

    #[test]
    fn workspace_version_is_exposed() {
        assert_eq!(PRISM_VERSION, "0.1.0");
    }
}
