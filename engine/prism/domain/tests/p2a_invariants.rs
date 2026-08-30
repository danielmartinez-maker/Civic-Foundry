use prism_domain::error::P2AError;

#[test]
fn p2a_domain_is_non_authoritative_bootstrap() {
    assert_eq!(env!("CARGO_PKG_NAME"), "prism-domain");
}

#[test]
fn world_validation_error_contract_uses_field_payload() {
    let error = P2AError::WorldValidation {
        code: "invalid-meter-scale",
        field: "terrain.metersPerCell".to_owned(),
    };

    assert!(matches!(
        error,
        P2AError::WorldValidation {
            code: "invalid-meter-scale",
            ref field,
        } if field == "terrain.metersPerCell"
    ));
}
