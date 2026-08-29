#[cfg(windows)]
#[test]
fn native_host_emits_stable_bootstrap_report() {
    use std::process::Command;

    let output = Command::new(env!("CARGO_BIN_EXE_prism-host"))
        .output()
        .expect("run prism-host");

    assert!(output.status.success());
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2\n"
    );
    assert!(output.stderr.is_empty());
}
