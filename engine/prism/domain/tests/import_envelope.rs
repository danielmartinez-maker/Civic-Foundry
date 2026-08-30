use prism_domain::compat::envelope::decode_envelope_json;
use prism_domain::error::P2AError;

fn valid_envelope_json() -> &'static [u8] {
    br#"{
      "schemaVersion": 1,
      "sourceSaveVersion": 9,
      "sourceGameVersion": "0.9.0-urban-fabric",
      "world": {
        "mode": "legacy-flat",
        "seed": 17,
        "config": { "width": 1, "height": 1, "metersPerCell": 20, "preset": "plain" },
        "scenarioId": null,
        "terrain": { "width": 1, "height": 1, "metersPerCell": 20, "samples": [] },
        "hydrology": {
          "width": 1,
          "height": 1,
          "conditionedElevationMeters": [],
          "receiver": [],
          "watersheds": [],
          "channels": [],
          "flowAccumulation": [],
          "watershedIds": [],
          "floodSusceptibility": []
        },
        "geography": { "entities": [] },
        "legacyCompatibility": null,
        "lastFloodResult": null
      },
      "cadastre": {
        "nodes": [],
        "edges": [],
        "blocks": [],
        "parcels": [],
        "easements": [],
        "lineage": []
      }
    }"#
}

#[test]
fn decodes_supported_envelope_without_semantic_validation() {
    let decoded = decode_envelope_json(valid_envelope_json()).expect("supported envelope should decode");
    assert_eq!(decoded.world.seed, 17);
    assert!(decoded.cadastre.parcels.is_empty());
}

#[test]
fn rejects_invalid_json() {
    assert!(matches!(
        decode_envelope_json(br#"{"schemaVersion":1"#),
        Err(P2AError::Decode { .. })
    ));
}

#[test]
fn rejects_wrong_schema_before_domain_decode() {
    let bytes = br#"{"schemaVersion":2,"sourceSaveVersion":9,"sourceGameVersion":"0.9.0-urban-fabric","world":{},"cadastre":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::UnsupportedSchema { found: 2 })
    ));
}

#[test]
fn rejects_wrong_save_version_before_domain_decode() {
    let bytes = br#"{"schemaVersion":1,"sourceSaveVersion":8,"sourceGameVersion":"0.9.0-urban-fabric","world":{},"cadastre":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::UnsupportedSourceVersion { save_version: 8, .. })
    ));
}

#[test]
fn rejects_wrong_game_version_before_domain_decode() {
    let bytes = br#"{"schemaVersion":1,"sourceSaveVersion":9,"sourceGameVersion":"0.8.0-world-foundation","world":{},"cadastre":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::UnsupportedSourceVersion { save_version: 9, .. })
    ));
}

#[test]
fn rejects_missing_world() {
    let bytes = br#"{"schemaVersion":1,"sourceSaveVersion":9,"sourceGameVersion":"0.9.0-urban-fabric","cadastre":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::Decode { .. })
    ));
}

#[test]
fn rejects_missing_cadastre() {
    let bytes = br#"{"schemaVersion":1,"sourceSaveVersion":9,"sourceGameVersion":"0.9.0-urban-fabric","world":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::Decode { .. })
    ));
}
