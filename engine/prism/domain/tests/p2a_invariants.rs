use prism_domain::cadastre::types::WorldPoint;
use prism_domain::canonical::hash::{PRISM_CANONICAL_HASH_VERSION, prism_canonical_hash_v1};
use prism_domain::compat::envelope::{
    P2A_IMPORT_SCHEMA_VERSION, P2A_SOURCE_GAME_VERSION, P2A_SOURCE_SAVE_VERSION,
    import_envelope_json,
};
use prism_domain::error::P2AError;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
struct HashFixture {
    vectors: Vec<HashVector>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashVector {
    name: String,
    expected_hash: String,
    envelope: Value,
}

fn load_fixture() -> HashFixture {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/prism-p2a/hash-vectors.json"
    ))
    .expect("P2A hash fixture should decode")
}

fn minimal_valid() -> HashVector {
    load_fixture()
        .vectors
        .into_iter()
        .find(|vector| vector.name == "minimal-valid")
        .expect("minimal-valid P2A vector must exist")
}

fn import_value(value: &Value) -> prism_domain::compat::envelope::P2AMirror {
    let bytes = serde_json::to_vec(value).expect("fixture envelope should encode");
    import_envelope_json(&bytes).expect("fixture envelope should import")
}

fn reverse_array(value: &mut Value, pointer: &str) {
    value
        .pointer_mut(pointer)
        .and_then(Value::as_array_mut)
        .unwrap_or_else(|| panic!("fixture path {pointer} must be an array"))
        .reverse();
}

#[test]
fn p2a_release_contract_versions_are_frozen() {
    assert_eq!(env!("CARGO_PKG_NAME"), "prism-domain");
    assert_eq!(P2A_IMPORT_SCHEMA_VERSION, 1);
    assert_eq!(P2A_SOURCE_SAVE_VERSION, 9);
    assert_eq!(P2A_SOURCE_GAME_VERSION, "0.9.0-urban-fabric");
    assert_eq!(PRISM_CANONICAL_HASH_VERSION, "PrismCanonicalHashV1");
}

#[test]
fn known_typescript_fixture_hash_is_locked() {
    let vector = minimal_valid();
    assert_eq!(vector.expected_hash, "30fa36aa712fd2b1");
    let mirror = import_value(&vector.envelope);
    assert_eq!(prism_canonical_hash_v1(&mirror), vector.expected_hash);
}

#[test]
fn set_like_top_level_reordering_preserves_canonical_hash() {
    let vector = minimal_valid();
    let expected = prism_canonical_hash_v1(&import_value(&vector.envelope));
    let mut shuffled = vector.envelope.clone();

    for pointer in [
        "/world/geography/entities",
        "/cadastre/nodes",
        "/cadastre/edges",
        "/cadastre/blocks",
        "/cadastre/parcels",
        "/cadastre/easements",
        "/cadastre/lineage",
    ] {
        reverse_array(&mut shuffled, pointer);
    }

    assert_eq!(prism_canonical_hash_v1(&import_value(&shuffled)), expected);
}

#[test]
fn unsupported_source_fixture_is_rejected_before_import() {
    let mut invalid = minimal_valid().envelope;
    invalid["sourceSaveVersion"] = json!(8);
    let bytes = serde_json::to_vec(&invalid).expect("invalid fixture should encode");

    assert!(matches!(
        import_envelope_json(&bytes),
        Err(P2AError::UnsupportedSourceVersion {
            save_version: 8,
            ref game_version,
        }) if game_version == "0.9.0-urban-fabric"
    ));
}

#[test]
fn rejected_mutation_preserves_full_p2a_hash() {
    let vector = minimal_valid();
    let mut mirror = import_value(&vector.envelope);
    let before = prism_canonical_hash_v1(&mirror);

    let result = mirror.cadastre.split_parcel(
        "p0",
        &[
            WorldPoint { x: 0.0, y: 0.0 },
            WorldPoint { x: 0.01, y: 0.01 },
        ],
    );

    assert!(!result.committed);
    assert_eq!(prism_canonical_hash_v1(&mirror), before);
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
