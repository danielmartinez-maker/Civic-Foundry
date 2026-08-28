use prism_core::bootstrap::run_bootstrap_probe;

#[test]
fn bootstrap_probe_exercises_p0_contracts_and_formats_stably() {
    let report = run_bootstrap_probe().expect("bootstrap probe");
    assert_eq!(report.entity_generation, 1);
    assert_eq!(report.alignment_bytes, 64);
    assert_eq!(report.compiled_jobs, 2);
    assert_eq!(
        report.to_string(),
        "PRISM_BOOTSTRAP version=0.1.0 entity_generation=1 alignment=64 compiled_jobs=2"
    );
}
