use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, Parcel, ParcelEdge, ParcelEdgeKind, ParcelNode, UrbanBlock, WorldPoint,
};
use prism_domain::world::import::WorldMirror;
use prism_domain::world::types::{
    FloodResult, GeographyEntity, GeographyKind, GeographySnapshot, HydrologySnapshot, Polygon2,
    SoilClass, SurfaceWaterClass, TerrainFieldSnapshot, TerrainPhysicalSample, Vec2,
    VegetationClass, WatershedRecord, WorldFormPreset, WorldFoundationMode,
    WorldFoundationSnapshot, WorldGenerationConfig,
};
use serde_json::Value;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/prism-p2a/query-cases.json"
    ))
    .expect("P2A query fixture should decode")
}

fn fixture_number(value: &Value, pointer: &str) -> f64 {
    value
        .pointer(pointer)
        .and_then(Value::as_f64)
        .unwrap_or_else(|| panic!("missing numeric fixture value at {pointer}"))
}

fn fixture_u32(value: &Value, pointer: &str) -> u32 {
    u32::try_from(
        value
            .pointer(pointer)
            .and_then(Value::as_u64)
            .unwrap_or_else(|| panic!("missing integer fixture value at {pointer}")),
    )
    .expect("fixture coordinate should fit u32")
}

fn fixture_string<'a>(value: &'a Value, pointer: &str) -> &'a str {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("missing string fixture value at {pointer}"))
}

fn fixture_strings(value: &Value, pointer: &str) -> Vec<String> {
    value
        .pointer(pointer)
        .and_then(Value::as_array)
        .unwrap_or_else(|| panic!("missing string array fixture value at {pointer}"))
        .iter()
        .map(|item| {
            item.as_str()
                .expect("fixture array item should be a string")
                .to_owned()
        })
        .collect()
}

fn point(x: f64, y: f64) -> WorldPoint {
    WorldPoint { x, y }
}

fn polygon(min_x: f64, min_y: f64, max_x: f64, max_y: f64) -> Polygon2 {
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
        id: id.to_owned(),
        kind,
        parent_id: parent_id.map(str::to_owned),
        boundary,
        name: None,
        sort_key: sort_key.to_owned(),
    }
}

fn terrain_sample(elevation_meters: f64, slope: f64) -> TerrainPhysicalSample {
    TerrainPhysicalSample {
        elevation_meters,
        slope,
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

fn world_fixture(with_flood: bool) -> WorldFoundationSnapshot {
    let boundary = polygon(0.0, 0.0, 2.0, 2.0);
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
            samples: vec![
                terrain_sample(10.0, 0.1),
                terrain_sample(11.0, 0.2),
                terrain_sample(12.0, 0.3),
                terrain_sample(13.0, 0.4),
            ],
        },
        hydrology: HydrologySnapshot {
            width: 2,
            height: 2,
            conditioned_elevation_meters: vec![100.0, 101.0, 102.0, 103.0],
            receiver: vec![Some(1), None, Some(3), None],
            watersheds: vec![WatershedRecord {
                id: "watershed-0".to_owned(),
                outlet_index: 1,
                member_count: 4,
                upstream_area_cells: 4,
                primary_channel_id: None,
            }],
            channels: vec![],
            flow_accumulation: vec![1.0, 2.0, 3.0, 4.0],
            watershed_ids: vec!["watershed-0".to_owned(); 4],
            flood_susceptibility: vec![0.1, 0.2, 0.3, 0.4],
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
        last_flood_result: with_flood.then(|| FloodResult {
            event_id: "storm-query".to_owned(),
            depth_meters: vec![0.0, 0.05, 0.1, 0.25],
            rainfall_volume: 100.0,
            infiltration_volume: 30.0,
            retained_channel_surface_volume: 10.0,
            overbank_flood_volume: 20.0,
            exported_volume: 40.0,
            balance_error: 0.0,
        }),
    }
}

fn cadastre_fixture() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            ParcelNode {
                id: "n5".to_owned(),
                point: point(0.0, 20.0),
            },
            ParcelNode {
                id: "n1".to_owned(),
                point: point(20.0, 0.0),
            },
            ParcelNode {
                id: "n4".to_owned(),
                point: point(20.0, 20.0),
            },
            ParcelNode {
                id: "n0".to_owned(),
                point: point(0.0, 0.0),
            },
            ParcelNode {
                id: "n3".to_owned(),
                point: point(40.0, 20.0),
            },
            ParcelNode {
                id: "n2".to_owned(),
                point: point(40.0, 0.0),
            },
        ],
        edges: vec![
            ParcelEdge {
                id: "b2".to_owned(),
                from_node_id: "n3".to_owned(),
                to_node_id: "n4".to_owned(),
                left_parcel_id: Some("pb".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a1".to_owned(),
                from_node_id: "n1".to_owned(),
                to_node_id: "n4".to_owned(),
                left_parcel_id: Some("pa".to_owned()),
                right_parcel_id: Some("pb".to_owned()),
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a3".to_owned(),
                from_node_id: "n5".to_owned(),
                to_node_id: "n0".to_owned(),
                left_parcel_id: Some("pa".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "b0".to_owned(),
                from_node_id: "n1".to_owned(),
                to_node_id: "n2".to_owned(),
                left_parcel_id: Some("pb".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::StreetFrontage,
                road_ref: Some("south-b".to_owned()),
            },
            ParcelEdge {
                id: "a0".to_owned(),
                from_node_id: "n0".to_owned(),
                to_node_id: "n1".to_owned(),
                left_parcel_id: Some("pa".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::StreetFrontage,
                road_ref: Some("south-a".to_owned()),
            },
            ParcelEdge {
                id: "b1".to_owned(),
                from_node_id: "n2".to_owned(),
                to_node_id: "n3".to_owned(),
                left_parcel_id: Some("pb".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "a2".to_owned(),
                from_node_id: "n4".to_owned(),
                to_node_id: "n5".to_owned(),
                left_parcel_id: Some("pa".to_owned()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
        ],
        blocks: vec![UrbanBlock {
            id: "block".to_owned(),
            boundary: vec![
                point(0.0, 0.0),
                point(40.0, 0.0),
                point(40.0, 20.0),
                point(0.0, 20.0),
            ],
            parcel_ids: vec!["pb".to_owned(), "pa".to_owned()],
            road_edge_ids: vec!["b0".to_owned(), "a0".to_owned()],
        }],
        parcels: vec![
            Parcel {
                id: "pb".to_owned(),
                block_id: "block".to_owned(),
                boundary_edge_ids: vec![
                    "b0".to_owned(),
                    "b1".to_owned(),
                    "b2".to_owned(),
                    "a1".to_owned(),
                ],
                area_m2: 400.0,
                centroid: point(30.0, 10.0),
                frontage_edge_ids: vec!["b0".to_owned()],
                access_edge_ids: vec!["b0".to_owned()],
                zoning_district_id: "R2".to_owned(),
                owner_id: None,
                historical_parent_ids: vec![],
            },
            Parcel {
                id: "pa".to_owned(),
                block_id: "block".to_owned(),
                boundary_edge_ids: vec![
                    "a0".to_owned(),
                    "a1".to_owned(),
                    "a2".to_owned(),
                    "a3".to_owned(),
                ],
                area_m2: 400.0,
                centroid: point(10.0, 10.0),
                frontage_edge_ids: vec!["a0".to_owned()],
                access_edge_ids: vec!["a0".to_owned()],
                zoning_district_id: "R2".to_owned(),
                owner_id: None,
                historical_parent_ids: vec![],
            },
        ],
        easements: vec![],
        lineage: vec![],
    }
}

fn expected_polygon(value: &Value) -> Vec<WorldPoint> {
    value
        .pointer("/cadastre/parcel/polygon")
        .and_then(Value::as_array)
        .expect("parcel polygon fixture should be an array")
        .iter()
        .map(|point_value| WorldPoint {
            x: point_value
                .get("x")
                .and_then(Value::as_f64)
                .expect("polygon point x should be numeric"),
            y: point_value
                .get("y")
                .and_then(Value::as_f64)
                .expect("polygon point y should be numeric"),
        })
        .collect()
}

#[test]
fn read_only_world_and_cadastre_queries_match_the_frozen_typescript_cases() {
    let cases = fixture();
    let world =
        WorldMirror::try_from(world_fixture(false)).expect("valid query world should import");

    for name in ["first", "last"] {
        let prefix = format!("/terrain/{name}");
        let x = fixture_u32(&cases, &format!("{prefix}/x"));
        let y = fixture_u32(&cases, &format!("{prefix}/y"));
        let sample = world
            .terrain_sample_at(x, y)
            .expect("terrain query should be in bounds");
        assert_eq!(
            sample.elevation_meters,
            fixture_number(&cases, &format!("{prefix}/elevationMeters"))
        );
        assert_eq!(
            sample.slope,
            fixture_number(&cases, &format!("{prefix}/slope"))
        );
    }

    for name in ["first", "last"] {
        let prefix = format!("/hydrology/{name}");
        let x = fixture_u32(&cases, &format!("{prefix}/x"));
        let y = fixture_u32(&cases, &format!("{prefix}/y"));
        let sample = world
            .hydrology_sample_at(x, y)
            .expect("hydrology query should be in bounds");
        assert_eq!(
            sample.conditioned_elevation_meters,
            fixture_number(&cases, &format!("{prefix}/conditionedElevationMeters"))
        );
        assert_eq!(
            sample.watershed_id,
            fixture_string(&cases, &format!("{prefix}/watershedId"))
        );
        assert_eq!(
            sample.flow_accumulation,
            fixture_number(&cases, &format!("{prefix}/flowAccumulation"))
        );
        assert_eq!(
            sample.flood_susceptibility,
            fixture_number(&cases, &format!("{prefix}/floodSusceptibility"))
        );
    }

    let flood_x = fixture_u32(&cases, "/flood/absent/x");
    let flood_y = fixture_u32(&cases, "/flood/absent/y");
    assert_eq!(
        world
            .flood_depth_at(flood_x, flood_y)
            .expect("flood query should be in bounds"),
        fixture_number(&cases, "/flood/absent/depthMeters")
    );

    let flooded_world = WorldMirror::try_from(world_fixture(true))
        .expect("valid flooded query world should import");
    assert_eq!(
        flooded_world
            .flood_depth_at(
                fixture_u32(&cases, "/flood/present/x"),
                fixture_u32(&cases, "/flood/present/y"),
            )
            .expect("flood query should be in bounds"),
        fixture_number(&cases, "/flood/present/depthMeters")
    );

    let by_id = world
        .geography_by_id(fixture_string(&cases, "/geography/byId/id"))
        .expect("frozen geography id should exist");
    assert_eq!(by_id.kind, GeographyKind::Region);

    let deepest = world
        .geography_at(
            point(
                fixture_number(&cases, "/geography/deepest/x"),
                fixture_number(&cases, "/geography/deepest/y"),
            ),
            None,
        )
        .expect("deepest geography query should match");
    assert_eq!(deepest.id, fixture_string(&cases, "/geography/deepest/id"));

    let district = world
        .geography_at(
            point(
                fixture_number(&cases, "/geography/kindFiltered/x"),
                fixture_number(&cases, "/geography/kindFiltered/y"),
            ),
            Some(GeographyKind::District),
        )
        .expect("kind-filtered geography query should match");
    assert_eq!(
        district.id,
        fixture_string(&cases, "/geography/kindFiltered/id")
    );

    let geography_ids = world
        .geography_ids_in_aabb(
            fixture_number(&cases, "/geography/aabb/minX"),
            fixture_number(&cases, "/geography/aabb/minY"),
            fixture_number(&cases, "/geography/aabb/maxX"),
            fixture_number(&cases, "/geography/aabb/maxY"),
            None,
        )
        .expect("valid geography bounds should query");
    assert_eq!(
        geography_ids,
        fixture_strings(&cases, "/geography/aabb/ids")
    );

    let graph = CadastralGraph::try_from_snapshot(cadastre_fixture())
        .expect("valid query cadastre should import");
    let parcel_id = fixture_string(&cases, "/cadastre/parcel/id");
    assert_eq!(
        graph
            .parcel_polygon(parcel_id)
            .expect("frozen parcel should have a valid polygon"),
        expected_polygon(&cases)
    );
    assert_eq!(
        graph.adjacent_parcel_ids(fixture_string(&cases, "/cadastre/adjacency/id")),
        fixture_strings(&cases, "/cadastre/adjacency/ids")
    );

    let aabbs = cases
        .pointer("/cadastre/aabbs")
        .and_then(Value::as_array)
        .expect("cadastre AABB fixture should be an array");
    for (index, aabb) in aabbs.iter().enumerate() {
        let prefix = format!("/cadastre/aabbs/{index}");
        let ids = graph
            .parcel_ids_in_aabb(
                aabb.get("minX").and_then(Value::as_f64).unwrap(),
                aabb.get("minY").and_then(Value::as_f64).unwrap(),
                aabb.get("maxX").and_then(Value::as_f64).unwrap(),
                aabb.get("maxY").and_then(Value::as_f64).unwrap(),
            )
            .expect("valid parcel bounds should query");
        assert_eq!(ids, fixture_strings(&cases, &format!("{prefix}/ids")));
    }
}
