use prism_core::diagnostics::{DiagnosticBuffer, Severity};

#[test]
fn diagnostic_sequence_is_monotonic_and_snapshot_order_is_stable() {
    let mut diagnostics = DiagnosticBuffer::new();
    assert_eq!(
        diagnostics
            .push(Severity::Info, "bootstrap", "start")
            .unwrap(),
        0
    );
    assert_eq!(
        diagnostics
            .push(Severity::Warn, "memory", "pressure")
            .unwrap(),
        1
    );

    let snapshot = diagnostics.snapshot();
    assert_eq!(snapshot.len(), 2);
    assert_eq!(snapshot[0].sequence, 0);
    assert_eq!(snapshot[0].subsystem, "bootstrap");
    assert_eq!(snapshot[1].sequence, 1);
    assert_eq!(snapshot[1].severity, Severity::Warn);
}
