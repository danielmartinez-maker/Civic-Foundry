use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, Easement, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind,
    ParcelLineageEvent, ParcelLineageKind, ParcelNode, UrbanBlock, WorldPoint,
};
use prism_domain::compat::envelope::import_envelope_json;
use prism_domain::error::P2AError;
use prism_domain::world::types::*;

fn point(x: f64, y: f64) -> WorldPoint {
    WorldPoint { x, y }
}

fn shared_snapshot_shuffled() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            ParcelNode {
                id: "n5".into(),
                point: point(0.0, 20.0),
            },
            ParcelNode {
                id: "n1".into(),
                point: point(20.0, 0.0),
            },
            ParcelNode {
                id: "n4".into(),
                point: point(20.0, 20.0),
            },
            ParcelNode {
                id: "n0".into(),
                point: point(0.0, 0.0),
            },
            ParcelNode {
                id: "n3".into(),
                point: point(40.0, 20.0),
            },
            ParcelNode {
                id: "n2".into(),
                point: point(40.0, 0.0),
            },
        ],
        edges: vec![
            ParcelEdge {
                id: "b2".into(),
                from_node_id: "n3".into(),
                to_node_id: "n4".into(),
                left_parcel_id: Some("pb".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a1".into(),
                from_node_id: "n1".into(),
                to_node_id: "n4".into(),
                left_parcel_id: Some("pa".into()),
                right_parcel_id: Some("pb".into()),
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a3".into(),
                from_node_id: "n5".into(),
                to_node_id: "n0".into(),
                left_parcel_id: Some("pa".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "b0".into(),
                from_node_id: "n1".into(),
                to_node_id: "n2".into(),
                left_parcel_id: Some("pb".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::StreetFrontage,
                road_ref: Some("south-b".into()),
            },
            ParcelEdge {
                id: "a0".into(),
                from_node_id: "n0".into(),
                to_node_id: "n1".into(),
                left_parcel_id: Some("pa".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::StreetFrontage,
                road_ref: Some("south-a".into()),
            },
            ParcelEdge {
                id: "b1".into(),
                from_node_id: "n2".into(),
                to_node_id: "n3".into(),
                left_parcel_id: Some("pb".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a2".into(),
                from_node_id: "n4".into(),
                to_node_id: "n5".into(),
                left_parcel_id: Some("pa".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![
                point(0.0, 0.0),
                point(40.0, 0.0),
                point(40.0, 20.0),
                point(0.0, 20.0),
            ],
            parcel_ids: vec!["pb".into(), "pa".into()],
            road_edge_ids: vec!["b0".into(), "a0".into()],
        }],
        parcels: vec![
            Parcel {
                id: "pb".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["b0".into(), "b1".into(), "b2".into(), "a1".into()],
                area_m2: 400.0,
                centroid: point(30.0, 10.0),
                frontage_edge_ids: vec!["b0".into()],
                access_edge_ids: vec!["b0".into()],
                zoning_district_id: "R2".into(),
                owner_id: None,
                historical_parent_ids: vec!["old-b".into(), "old-a".into()],
            },
            Parcel {
                id: "pa".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["a0".into(), "a1".into(), "a2".into(), "a3".into()],
                area_m2: 400.0,
                centroid: point(10.0, 10.0),
                frontage_edge_ids: vec!["a0".into()],
                access_edge_ids: vec!["a0".into()],
                zoning_district_id: "R2".into(),
                owner_id: None,
                historical_parent_ids: vec!["root-b".into(), "root-a".into()],
            },
        ],
        easements: vec![Easement {
            id: "ease-z".into(),
            parcel_ids: vec!["pb".into(), "pa".into()],
            kind: EasementKind::Access,
            geometry: vec![point(5.0, 5.0), point(35.0, 5.0)],
        }],
        lineage: vec![
            ParcelLineageEvent {
                id: "event-z".into(),
                tick: 8,
                kind: ParcelLineageKind::Assembly,
                source_parcel_ids: vec!["src-b".into(), "src-a".into()],
                resulting_parcel_ids: vec!["result-b".into(), "result-a".into()],
            },
            ParcelLineageEvent {
                id: "event-b".into(),
                tick: 3,
                kind: ParcelLineageKind::Split,
                source_parcel_ids: vec!["origin-b".into(), "origin-a".into()],
                resulting_parcel_ids: vec!["child-b".into(), "child-a".into()],
            },
            ParcelLineageEvent {
                id: "event-a".into(),
                tick: 3,
                kind: ParcelLineageKind::Split,
                source_parcel_ids: vec!["earlier-b".into(), "earlier-a".into()],
                resulting_parcel_ids: vec!["later-b".into(), "later-a".into()],
            },
        ],
    }
}

fn square(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Polygon2 {
    Polygon2 {
        points: vec![
            Vec2 { x: min_x, y: min_y },
            Vec2 { x: max_x, y: min_y },
            Vec2 { x: max_x, y: max_y },
            Vec2 { x: min_x, y: max_y },
        ],
    }
}

fn geography_entity(
    id: &str,
    kind: GeographyKind,
    parent_id: Option<&str>,
    sort_key: &str,
    boundary: Polygon2,
) -> GeographyEntity {
    GeographyEntity {
        id: id.into(),
        kind,
        parent_id: parent_id.map(str::to_owned),
        boundary,
        name: None,
        sort_key: sort_key.into(),
    }
}

fn terrain_sample() -> TerrainPhysicalSample {
    TerrainPhysicalSample {
        elevation_meters: 10.0,
        slope: 0.1,
        aspect_radians: 0.0,
        soil_class: SoilClass::Loam,
        soil_depth_meters: 2.0,
        bearing_capacity_kpa: 150.0,
        bedrock_depth_meters: 4.0,
        groundwater_depth_meters: 3.0,
        vegetation_class: VegetationClass::Grass,
        contamination_index: 0.0,
        land_preparation_multiplier: 1.0,
        surface_water: SurfaceWaterClass::None,
        buildable: true,
    }
}

fn valid_world_fixture() -> WorldFoundationSnapshot {
    let boundary = square(0.0, 0.0, 2.0, 2.0);
    WorldFoundationSnapshot {
        mode: WorldFoundationMode::Generated1r,
        seed: 17,
        config: WorldGenerationConfig {
            width: 2,
            height: 2,
            meters_per_cell: 20.0,
            preset: WorldFormPreset::Plain,
        },
        scenario_id: None,
        terrain: TerrainFieldSnapshot {
            width: 2,
            height: 2,
            meters_per_cell: 20.0,
            samples: vec![terrain_sample(); 4],
        },
        hydrology: HydrologySnapshot {
            width: 2,
            height: 2,
            conditioned_elevation_meters: vec![10.0; 4],
            receiver: vec![None; 4],
            watersheds: vec![WatershedRecord {
                id: "watershed-0".into(),
                outlet_index: 0,
                member_count: 4,
                upstream_area_cells: 4,
                primary_channel_id: None,
            }],
            channels: vec![],
            flow_accumulation: vec![1.0; 4],
            watershed_ids: vec!["watershed-0".into(); 4],
            flood_susceptibility: vec![0.1; 4],
        },
        geography: GeographySnapshot {
            entities: vec![
                geography_entity(
                    "block:0",
                    GeographyKind::Block,
                    Some("neighborhood:0"),
                    "0.0.0.0.0",
                    boundary.clone(),
                ),
                geography_entity(
                    "district:0",
                    GeographyKind::District,
                    Some("municipality:0"),
                    "0.0.0",
                    boundary.clone(),
                ),
                geography_entity(
                    "region:0",
                    GeographyKind::Region,
                    None,
                    "0",
                    boundary.clone(),
                ),
                geography_entity(
                    "neighborhood:0",
                    GeographyKind::Neighborhood,
                    Some("district:0"),
                    "0.0.0.0",
                    boundary.clone(),
                ),
                geography_entity(
                    "municipality:0",
                    GeographyKind::Municipality,
                    Some("region:0"),
                    "0.0",
                    boundary,
                ),
            ],
        },
        legacy_compatibility: None,
        last_flood_result: None,
    }
}

#[test]
fn canonical_graph_sorts_identity_and_set_like_membership_without_reordering_semantic_arrays() {
    let input = shared_snapshot_shuffled();
    let boundary_before = input
        .parcels
        .iter()
        .find(|parcel| parcel.id == "pb")
        .unwrap()
        .boundary_edge_ids
        .clone();
    let block_boundary_before = input.blocks[0].boundary.clone();
    let easement_geometry_before = input.easements[0].geometry.clone();

    let graph =
        CadastralGraph::try_from_snapshot(input).expect("valid shuffled snapshot should import");
    let snapshot = graph.snapshot();

    assert_eq!(
        snapshot
            .nodes
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["n0", "n1", "n2", "n3", "n4", "n5"]
    );
    assert_eq!(
        snapshot
            .edges
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["a0", "a1", "a2", "a3", "b0", "b1", "b2"]
    );
    assert_eq!(
        snapshot
            .parcels
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["pa", "pb"]
    );
    assert_eq!(snapshot.blocks[0].parcel_ids, vec!["pa", "pb"]);
    assert_eq!(snapshot.blocks[0].road_edge_ids, vec!["a0", "b0"]);
    assert_eq!(
        snapshot.parcels[0].historical_parent_ids,
        vec!["root-a", "root-b"]
    );
    assert_eq!(
        snapshot.parcels[1].historical_parent_ids,
        vec!["old-a", "old-b"]
    );
    assert_eq!(snapshot.easements[0].parcel_ids, vec!["pa", "pb"]);
    assert_eq!(
        snapshot
            .lineage
            .iter()
            .map(|row| (row.tick, row.id.as_str()))
            .collect::<Vec<_>>(),
        vec![(3, "event-a"), (3, "event-b"), (8, "event-z")]
    );
    assert_eq!(
        snapshot.lineage[0].source_parcel_ids,
        vec!["earlier-a", "earlier-b"]
    );
    assert_eq!(
        snapshot.lineage[0].resulting_parcel_ids,
        vec!["later-a", "later-b"]
    );

    assert_eq!(snapshot.parcels[1].boundary_edge_ids, boundary_before);
    assert_eq!(snapshot.blocks[0].boundary, block_boundary_before);
    assert_eq!(snapshot.easements[0].geometry, easement_geometry_before);
    assert_eq!(graph.adjacent_parcel_ids("pa"), vec!["pb"]);
    assert_eq!(
        graph.parcel_polygon("pa").unwrap(),
        vec![
            point(0.0, 0.0),
            point(20.0, 0.0),
            point(20.0, 20.0),
            point(0.0, 20.0)
        ]
    );
}

#[test]
fn full_envelope_import_is_atomic_across_world_and_cadastre_validation() {
    let envelope = serde_json::json!({
        "schemaVersion": 1,
        "sourceSaveVersion": 9,
        "sourceGameVersion": "0.9.0-urban-fabric",
        "world": valid_world_fixture(),
        "cadastre": shared_snapshot_shuffled(),
    });
    let bytes = serde_json::to_vec(&envelope).unwrap();
    let mirror = import_envelope_json(&bytes).expect("both valid halves should import");
    assert_eq!(mirror.world.snapshot().seed, 17);
    assert_eq!(
        mirror
            .cadastre
            .list_parcels()
            .iter()
            .map(|row| row.id.as_str())
            .collect::<Vec<_>>(),
        vec!["pa", "pb"]
    );

    let mut invalid_cadastre = shared_snapshot_shuffled();
    invalid_cadastre
        .parcels
        .iter_mut()
        .find(|parcel| parcel.id == "pa")
        .unwrap()
        .area_m2 = 399.0;
    let invalid = serde_json::json!({
        "schemaVersion": 1,
        "sourceSaveVersion": 9,
        "sourceGameVersion": "0.9.0-urban-fabric",
        "world": valid_world_fixture(),
        "cadastre": invalid_cadastre,
    });
    let error = import_envelope_json(&serde_json::to_vec(&invalid).unwrap()).unwrap_err();
    assert!(matches!(
        error,
        P2AError::CadastreValidation {
            code: "parcel-area-mismatch",
            entity_id: Some(id)
        } if id == "pa"
    ));

    let mut invalid_world = valid_world_fixture();
    invalid_world.terrain.samples.pop();
    let invalid = serde_json::json!({
        "schemaVersion": 1,
        "sourceSaveVersion": 9,
        "sourceGameVersion": "0.9.0-urban-fabric",
        "world": invalid_world,
        "cadastre": shared_snapshot_shuffled(),
    });
    assert!(matches!(
        import_envelope_json(&serde_json::to_vec(&invalid).unwrap()),
        Err(P2AError::WorldValidation {
            code: "terrain-length-mismatch",
            ..
        })
    ));
}
