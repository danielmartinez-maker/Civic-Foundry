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

fn live_world_wire_envelope_json() -> &'static [u8] {
    br#"{
      "schemaVersion": 1,
      "sourceSaveVersion": 9,
      "sourceGameVersion": "0.9.0-urban-fabric",
      "world": {
        "mode": "legacy-explicit",
        "seed": 17,
        "config": { "width": 1, "height": 1, "metersPerCell": 20, "preset": "river_valley" },
        "scenarioId": null,
        "terrain": {
          "width": 1,
          "height": 1,
          "metersPerCell": 20,
          "samples": [{
            "elevationMeters": 3,
            "slope": 0.1,
            "aspectRadians": 0,
            "soilClass": "rock",
            "soilDepthMeters": 1,
            "bearingCapacityKpa": 200,
            "bedrockDepthMeters": 2,
            "groundwaterDepthMeters": 4,
            "vegetationClass": "grass",
            "contaminationIndex": 0,
            "landPreparationMultiplier": 1,
            "surfaceWater": "none",
            "buildable": true
          }]
        },
        "hydrology": {
          "width": 1,
          "height": 1,
          "conditionedElevationMeters": [3],
          "receiver": [null],
          "watersheds": [{
            "id": "watershed-0",
            "outletIndex": 0,
            "memberCount": 1,
            "upstreamAreaCells": 1,
            "primaryChannelId": "channel-0"
          }],
          "channels": [{
            "id": "channel-0",
            "fromIndex": 0,
            "toIndex": 0,
            "accumulation": 1,
            "capacityVolumeM3": 10
          }],
          "flowAccumulation": [1],
          "watershedIds": ["watershed-0"],
          "floodSusceptibility": [0]
        },
        "geography": { "entities": [] },
        "legacyCompatibility": {
          "width": 1,
          "height": 1,
          "cells": [{ "elevation": 0.5, "water": false, "buildable": true, "biome": "grass" }]
        },
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
    let decoded =
        decode_envelope_json(valid_envelope_json()).expect("supported envelope should decode");
    assert_eq!(decoded.world.seed, 17);
    assert!(decoded.cadastre.parcels.is_empty());
}

#[test]
fn preserves_live_typescript_world_wire_literals_and_fields() {
    let decoded = decode_envelope_json(live_world_wire_envelope_json())
        .expect("current TypeScript world wire contract should decode");
    let world = serde_json::to_value(decoded.world).expect("world wire should serialize");

    assert_eq!(world["terrain"]["samples"][0]["soilClass"], "rock");
    assert_eq!(world["terrain"]["samples"][0]["vegetationClass"], "grass");
    assert_eq!(world["terrain"]["samples"][0]["surfaceWater"], "none");
    assert_eq!(world["legacyCompatibility"]["cells"][0]["biome"], "grass");
    assert_eq!(
        world["hydrology"]["watersheds"][0]["primaryChannelId"],
        "channel-0"
    );
    assert_eq!(
        world["hydrology"]["channels"][0]["capacityVolumeM3"],
        10
    );
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
        Err(P2AError::UnsupportedSourceVersion {
            save_version: 8,
            ..
        })
    ));
}

#[test]
fn rejects_wrong_game_version_before_domain_decode() {
    let bytes = br#"{"schemaVersion":1,"sourceSaveVersion":9,"sourceGameVersion":"0.8.0-world-foundation","world":{},"cadastre":{}}"#;
    assert!(matches!(
        decode_envelope_json(bytes),
        Err(P2AError::UnsupportedSourceVersion {
            save_version: 9,
            ..
        })
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
