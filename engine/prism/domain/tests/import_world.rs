use prism_domain::error::P2AError;
use prism_domain::world::import::WorldMirror;
use prism_domain::world::types::*;

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
        id: id.to_owned(),
        kind,
        parent_id: parent_id.map(str::to_owned),
        boundary,
        name: None,
        sort_key: sort_key.to_owned(),
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
                id: "watershed-0".to_owned(),
                outlet_index: 0,
                member_count: 4,
                upstream_area_cells: 4,
                primary_channel_id: None,
            }],
            channels: vec![],
            flow_accumulation: vec![1.0; 4],
            watershed_ids: vec!["watershed-0".to_owned(); 4],
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

fn assert_world_validation(result: Result<WorldMirror, P2AError>) {
    assert!(matches!(result, Err(P2AError::WorldValidation { .. })));
}

#[test]
fn valid_world_imports_and_canonicalizes_geography_order() {
    let mirror = WorldMirror::try_from(valid_world_fixture()).expect("valid world should import");
    let ids: Vec<_> = mirror
        .snapshot()
        .geography
        .entities
        .iter()
        .map(|entity| entity.id.as_str())
        .collect();
    assert_eq!(
        ids,
        vec![
            "region:0",
            "municipality:0",
            "district:0",
            "neighborhood:0",
            "block:0"
        ]
    );
}

#[test]
fn rejects_zero_world_dimensions() {
    let mut fixture = valid_world_fixture();
    fixture.terrain.width = 0;
    assert_world_validation(WorldMirror::try_from(fixture));
}

#[test]
fn rejects_invalid_meters_per_cell() {
    let mut fixture = valid_world_fixture();
    fixture.terrain.meters_per_cell = 0.0;
    assert_world_validation(WorldMirror::try_from(fixture));
}

#[test]
fn rejects_wrong_terrain_sample_count() {
    let mut fixture = valid_world_fixture();
    fixture.terrain.samples.pop();
    assert_world_validation(WorldMirror::try_from(fixture));
}

#[test]
fn rejects_non_finite_and_out_of_range_terrain_values() {
    let mut non_finite = valid_world_fixture();
    non_finite.terrain.samples[0].elevation_meters = f64::NAN;
    assert_world_validation(WorldMirror::try_from(non_finite));

    let mut negative_slope = valid_world_fixture();
    negative_slope.terrain.samples[0].slope = -0.01;
    assert_world_validation(WorldMirror::try_from(negative_slope));

    let mut bad_contamination = valid_world_fixture();
    bad_contamination.terrain.samples[0].contamination_index = 1.01;
    assert_world_validation(WorldMirror::try_from(bad_contamination));

    let mut bad_multiplier = valid_world_fixture();
    bad_multiplier.terrain.samples[0].land_preparation_multiplier = 0.0;
    assert_world_validation(WorldMirror::try_from(bad_multiplier));
}

#[test]
fn rejects_terrain_hydrology_dimension_mismatch() {
    let mut fixture = valid_world_fixture();
    fixture.hydrology.width += 1;
    assert!(matches!(
        WorldMirror::try_from(fixture),
        Err(P2AError::WorldValidation {
            code: "dimension-mismatch",
            ..
        })
    ));
}

#[test]
fn rejects_invalid_hydrology_arrays_and_receivers() {
    let mut wrong_length = valid_world_fixture();
    wrong_length.hydrology.flow_accumulation.pop();
    assert_world_validation(WorldMirror::try_from(wrong_length));

    let mut non_finite = valid_world_fixture();
    non_finite.hydrology.conditioned_elevation_meters[0] = f64::INFINITY;
    assert_world_validation(WorldMirror::try_from(non_finite));

    let mut bad_receiver = valid_world_fixture();
    bad_receiver.hydrology.receiver[0] = Some(4);
    assert_world_validation(WorldMirror::try_from(bad_receiver));

    let mut bad_susceptibility = valid_world_fixture();
    bad_susceptibility.hydrology.flood_susceptibility[0] = -0.01;
    assert_world_validation(WorldMirror::try_from(bad_susceptibility));
}

#[test]
fn rejects_invalid_flood_snapshot() {
    let mut wrong_depth_length = valid_world_fixture();
    wrong_depth_length.last_flood_result = Some(FloodResult {
        event_id: "storm-1".to_owned(),
        depth_meters: vec![0.0; 3],
        rainfall_volume: 10.0,
        infiltration_volume: 2.0,
        retained_channel_surface_volume: 1.0,
        overbank_flood_volume: 1.0,
        exported_volume: 6.0,
        balance_error: 0.0,
    });
    assert_world_validation(WorldMirror::try_from(wrong_depth_length));

    let mut non_finite = valid_world_fixture();
    non_finite.last_flood_result = Some(FloodResult {
        event_id: "storm-1".to_owned(),
        depth_meters: vec![0.0; 4],
        rainfall_volume: f64::NAN,
        infiltration_volume: 2.0,
        retained_channel_surface_volume: 1.0,
        overbank_flood_volume: 1.0,
        exported_volume: 6.0,
        balance_error: 0.0,
    });
    assert_world_validation(WorldMirror::try_from(non_finite));
}

#[test]
fn rejects_duplicate_geography_ids_and_invalid_root_count() {
    let mut duplicate = valid_world_fixture();
    duplicate
        .geography
        .entities
        .push(duplicate.geography.entities[0].clone());
    assert_world_validation(WorldMirror::try_from(duplicate));

    let mut no_root = valid_world_fixture();
    no_root
        .geography
        .entities
        .retain(|entity| entity.kind != GeographyKind::Region);
    assert_world_validation(WorldMirror::try_from(no_root));
}

#[test]
fn rejects_missing_or_wrong_geography_parent() {
    let mut missing = valid_world_fixture();
    let municipality = missing
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Municipality)
        .expect("fixture municipality");
    municipality.parent_id = Some("region:missing".to_owned());
    assert_world_validation(WorldMirror::try_from(missing));

    let mut wrong_kind = valid_world_fixture();
    let block = wrong_kind
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Block)
        .expect("fixture block");
    block.parent_id = Some("district:0".to_owned());
    assert_world_validation(WorldMirror::try_from(wrong_kind));
}

#[test]
fn rejects_geography_cycle() {
    let mut fixture = valid_world_fixture();
    let municipality = fixture
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Municipality)
        .expect("fixture municipality");
    municipality.parent_id = Some("district:0".to_owned());
    let district = fixture
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::District)
        .expect("fixture district");
    district.parent_id = Some("municipality:0".to_owned());
    assert_world_validation(WorldMirror::try_from(fixture));
}

#[test]
fn rejects_child_outside_parent_and_material_sibling_overlap() {
    let mut outside = valid_world_fixture();
    let block = outside
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Block)
        .expect("fixture block");
    block.boundary = square(10.0, 10.0, 11.0, 11.0);
    assert_world_validation(WorldMirror::try_from(outside));

    let mut overlap = valid_world_fixture();
    overlap.geography.entities.push(geography_entity(
        "block:1",
        GeographyKind::Block,
        Some("neighborhood:0"),
        "0.0.0.0.1",
        square(0.5, 0.5, 1.5, 1.5),
    ));
    assert_world_validation(WorldMirror::try_from(overlap));
}

#[test]
fn rejects_malformed_geography_polygons() {
    let mut too_short = valid_world_fixture();
    let block = too_short
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Block)
        .expect("fixture block");
    block.boundary.points = vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 1.0, y: 0.0 }];
    assert_world_validation(WorldMirror::try_from(too_short));

    let mut self_intersection = valid_world_fixture();
    let block = self_intersection
        .geography
        .entities
        .iter_mut()
        .find(|entity| entity.kind == GeographyKind::Block)
        .expect("fixture block");
    block.boundary = Polygon2 {
        points: vec![
            Vec2 { x: 0.0, y: 0.0 },
            Vec2 { x: 2.0, y: 2.0 },
            Vec2 { x: 0.0, y: 2.0 },
            Vec2 { x: 2.0, y: 0.0 },
        ],
    };
    assert_world_validation(WorldMirror::try_from(self_intersection));
}
