use std::cmp::Ordering;

use crate::cadastre::graph::CadastralGraph;
use crate::cadastre::types::{
    CadastralSnapshot, EasementKind, ParcelEdgeKind, ParcelLineageKind, WorldPoint,
};
use crate::compat::envelope::P2AMirror;
use crate::world::types::{
    Biome, ChannelSegment, FloodResult, GeographyEntity, GeographyKind, HydrologySnapshot,
    LegacyTerrainSnapshot, SoilClass, SurfaceWaterClass, TerrainFieldSnapshot,
    TerrainPhysicalSample, Vec2, VegetationClass, WatershedRecord, WorldFormPreset,
    WorldFoundationMode, WorldFoundationSnapshot,
};

const FNV_OFFSET_BASIS_64: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME_64: u64 = 0x0000_0100_0000_01b3;
const JS_MAX_SAFE_INTEGER_U64: u64 = 9_007_199_254_740_991;
const JS_MAX_SAFE_INTEGER_I64: i64 = 9_007_199_254_740_991;
const JS_MIN_SAFE_INTEGER_I64: i64 = -9_007_199_254_740_991;

const TAG_WORLD: u8 = 1;
const TAG_WORLD_CONFIG: u8 = 2;
const TAG_TERRAIN: u8 = 3;
const TAG_TERRAIN_SAMPLE: u8 = 4;
const TAG_HYDROLOGY: u8 = 5;
const TAG_WATERSHED: u8 = 6;
const TAG_CHANNEL: u8 = 7;
const TAG_GEOGRAPHY: u8 = 8;
const TAG_GEOGRAPHY_ENTITY: u8 = 9;
const TAG_POLYGON: u8 = 10;
const TAG_POINT: u8 = 11;
const TAG_LEGACY_TERRAIN: u8 = 12;
const TAG_TERRAIN_CELL: u8 = 13;
const TAG_FLOOD_RESULT: u8 = 14;
const TAG_CADASTRE: u8 = 20;
const TAG_PARCEL_NODE: u8 = 21;
const TAG_PARCEL_EDGE: u8 = 22;
const TAG_URBAN_BLOCK: u8 = 23;
const TAG_PARCEL: u8 = 24;
const TAG_EASEMENT: u8 = 25;
const TAG_LINEAGE: u8 = 26;

#[derive(Default)]
struct CanonicalByteWriter {
    bytes: Vec<u8>,
}

impl CanonicalByteWriter {
    fn finish(self) -> Vec<u8> {
        self.bytes
    }

    fn tag(&mut self, tag: u8) {
        self.u8(tag);
    }

    fn u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn i64(&mut self, value: i64) {
        assert!(
            (JS_MIN_SAFE_INTEGER_I64..=JS_MAX_SAFE_INTEGER_I64).contains(&value),
            "PrismCanonicalHashV1 expected safe integer i64, found {value}"
        );
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn u64(&mut self, value: u64) {
        assert!(
            value <= JS_MAX_SAFE_INTEGER_U64,
            "PrismCanonicalHashV1 expected safe integer u64, found {value}"
        );
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn f64(&mut self, value: f64) {
        assert!(
            value.is_finite(),
            "PrismCanonicalHashV1 requires finite f64 values, found {value}"
        );
        let canonical = if value == 0.0 { 0.0 } else { value };
        self.bytes.extend_from_slice(&canonical.to_le_bytes());
    }

    fn bool(&mut self, value: bool) {
        self.u8(u8::from(value));
    }

    fn string(&mut self, value: &str) {
        let bytes = value.as_bytes();
        self.u32(checked_len(bytes.len()));
        self.bytes.extend_from_slice(bytes);
    }

    fn option<T>(&mut self, value: Option<&T>, write: impl FnOnce(&mut Self, &T)) {
        match value {
            Some(value) => {
                self.u8(1);
                write(self, value);
            }
            None => self.u8(0),
        }
    }

    fn array<T>(&mut self, values: &[T], mut write: impl FnMut(&mut Self, &T)) {
        self.u32(checked_len(values.len()));
        for value in values {
            write(self, value);
        }
    }

    fn string_array(&mut self, values: &[String]) {
        self.array(values, |writer, value| writer.string(value));
    }

    fn string_set(&mut self, values: &[String]) {
        let mut ordered = values.iter().collect::<Vec<_>>();
        ordered.sort_by(|left, right| compare_utf8(left, right));
        self.u32(checked_len(ordered.len()));
        for value in ordered {
            self.string(value);
        }
    }
}

fn checked_len(len: usize) -> u32 {
    u32::try_from(len).expect("PrismCanonicalHashV1 collection length exceeds u32")
}

fn compare_utf8(left: &str, right: &str) -> Ordering {
    left.as_bytes().cmp(right.as_bytes())
}

#[must_use]
pub fn fnv1a64_hex(bytes: &[u8]) -> String {
    let mut hash = FNV_OFFSET_BASIS_64;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME_64);
    }
    format!("{hash:016x}")
}

#[must_use]
pub fn prism_canonical_hash_v1(mirror: &P2AMirror) -> String {
    let mut writer = CanonicalByteWriter::default();
    write_world(&mut writer, mirror.world.snapshot());
    let cadastre = mirror.cadastre.snapshot();
    write_cadastre(&mut writer, &cadastre);
    fnv1a64_hex(&writer.finish())
}

#[must_use]
pub fn prism_cadastral_hash_v1(graph: &CadastralGraph) -> String {
    let mut writer = CanonicalByteWriter::default();
    let cadastre = graph.snapshot();
    write_cadastre(&mut writer, &cadastre);
    fnv1a64_hex(&writer.finish())
}

fn write_world(writer: &mut CanonicalByteWriter, world: &WorldFoundationSnapshot) {
    writer.tag(TAG_WORLD);
    writer.string(world_foundation_mode(world.mode));
    writer.i64(world.seed);

    writer.tag(TAG_WORLD_CONFIG);
    writer.u32(world.config.width);
    writer.u32(world.config.height);
    writer.f64(world.config.meters_per_cell);
    writer.string(world_form_preset(world.config.preset));

    writer.option(world.scenario_id.as_ref(), |writer, scenario_id| {
        writer.string(scenario_id);
    });

    write_terrain(writer, &world.terrain);
    write_hydrology(writer, &world.hydrology);
    write_geography(writer, &world.geography.entities);

    writer.option(world.legacy_compatibility.as_ref(), |writer, legacy| {
        write_legacy_terrain(writer, legacy);
    });
    writer.option(world.last_flood_result.as_ref(), |writer, flood| {
        write_flood_result(writer, flood);
    });
}

fn write_terrain(writer: &mut CanonicalByteWriter, terrain: &TerrainFieldSnapshot) {
    writer.tag(TAG_TERRAIN);
    writer.u32(terrain.width);
    writer.u32(terrain.height);
    writer.f64(terrain.meters_per_cell);
    writer.array(&terrain.samples, |writer, sample| {
        write_terrain_sample(writer, sample);
    });
}

fn write_terrain_sample(writer: &mut CanonicalByteWriter, sample: &TerrainPhysicalSample) {
    writer.tag(TAG_TERRAIN_SAMPLE);
    writer.f64(sample.elevation_meters);
    writer.f64(sample.slope);
    writer.f64(sample.aspect_radians);
    writer.string(soil_class(sample.soil_class));
    writer.f64(sample.soil_depth_meters);
    writer.f64(sample.bearing_capacity_kpa);
    writer.f64(sample.bedrock_depth_meters);
    writer.f64(sample.groundwater_depth_meters);
    writer.string(vegetation_class(sample.vegetation_class));
    writer.f64(sample.contamination_index);
    writer.f64(sample.land_preparation_multiplier);
    writer.string(surface_water_class(sample.surface_water));
    writer.bool(sample.buildable);
}

fn write_hydrology(writer: &mut CanonicalByteWriter, hydrology: &HydrologySnapshot) {
    writer.tag(TAG_HYDROLOGY);
    writer.u32(hydrology.width);
    writer.u32(hydrology.height);
    writer.array(&hydrology.conditioned_elevation_meters, |writer, item| {
        writer.f64(*item);
    });
    writer.array(&hydrology.receiver, |writer, item| {
        writer.option(item.as_ref(), |writer, index| writer.u32(*index));
    });

    let mut watersheds = hydrology.watersheds.iter().collect::<Vec<_>>();
    watersheds.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(watersheds.len()));
    for watershed in watersheds {
        write_watershed(writer, watershed);
    }

    let mut channels = hydrology.channels.iter().collect::<Vec<_>>();
    channels.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(channels.len()));
    for channel in channels {
        write_channel(writer, channel);
    }

    writer.array(&hydrology.flow_accumulation, |writer, item| {
        writer.f64(*item);
    });
    writer.string_array(&hydrology.watershed_ids);
    writer.array(&hydrology.flood_susceptibility, |writer, item| {
        writer.f64(*item);
    });
}

fn write_watershed(writer: &mut CanonicalByteWriter, watershed: &WatershedRecord) {
    writer.tag(TAG_WATERSHED);
    writer.string(&watershed.id);
    writer.u32(watershed.outlet_index);
    writer.u32(watershed.member_count);
    writer.u32(watershed.upstream_area_cells);
    writer.option(
        watershed.primary_channel_id.as_ref(),
        |writer, channel_id| {
            writer.string(channel_id);
        },
    );
}

fn write_channel(writer: &mut CanonicalByteWriter, channel: &ChannelSegment) {
    writer.tag(TAG_CHANNEL);
    writer.string(&channel.id);
    writer.u32(channel.from_index);
    writer.u32(channel.to_index);
    writer.f64(channel.accumulation);
    writer.f64(channel.capacity_volume_m3);
}

fn write_geography(writer: &mut CanonicalByteWriter, entities: &[GeographyEntity]) {
    writer.tag(TAG_GEOGRAPHY);
    let mut ordered = entities.iter().collect::<Vec<_>>();
    ordered.sort_by(|left, right| {
        compare_utf8(&left.sort_key, &right.sort_key)
            .then_with(|| compare_utf8(&left.id, &right.id))
    });
    writer.u32(checked_len(ordered.len()));
    for entity in ordered {
        writer.tag(TAG_GEOGRAPHY_ENTITY);
        writer.string(&entity.id);
        writer.string(geography_kind(entity.kind));
        writer.option(entity.parent_id.as_ref(), |writer, parent_id| {
            writer.string(parent_id);
        });
        writer.tag(TAG_POLYGON);
        writer.array(&entity.boundary.points, |writer, point| {
            write_vec2(writer, point);
        });
        writer.option(entity.name.as_ref(), |writer, name| writer.string(name));
        writer.string(&entity.sort_key);
    }
}

fn write_legacy_terrain(writer: &mut CanonicalByteWriter, legacy: &LegacyTerrainSnapshot) {
    writer.tag(TAG_LEGACY_TERRAIN);
    writer.u32(legacy.width);
    writer.u32(legacy.height);
    writer.array(&legacy.cells, |writer, cell| {
        writer.tag(TAG_TERRAIN_CELL);
        writer.f64(cell.elevation);
        writer.bool(cell.water);
        writer.bool(cell.buildable);
        writer.string(biome(cell.biome));
    });
}

fn write_flood_result(writer: &mut CanonicalByteWriter, flood: &FloodResult) {
    writer.tag(TAG_FLOOD_RESULT);
    writer.string(&flood.event_id);
    writer.array(&flood.depth_meters, |writer, depth| writer.f64(*depth));
    writer.f64(flood.rainfall_volume);
    writer.f64(flood.infiltration_volume);
    writer.f64(flood.retained_channel_surface_volume);
    writer.f64(flood.overbank_flood_volume);
    writer.f64(flood.exported_volume);
    writer.f64(flood.balance_error);
}

fn write_cadastre(writer: &mut CanonicalByteWriter, cadastre: &CadastralSnapshot) {
    writer.tag(TAG_CADASTRE);

    let mut nodes = cadastre.nodes.iter().collect::<Vec<_>>();
    nodes.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(nodes.len()));
    for node in nodes {
        writer.tag(TAG_PARCEL_NODE);
        writer.string(&node.id);
        write_world_point(writer, node.point);
    }

    let mut edges = cadastre.edges.iter().collect::<Vec<_>>();
    edges.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(edges.len()));
    for edge in edges {
        writer.tag(TAG_PARCEL_EDGE);
        writer.string(&edge.id);
        writer.string(&edge.from_node_id);
        writer.string(&edge.to_node_id);
        writer.option(edge.left_parcel_id.as_ref(), |writer, parcel_id| {
            writer.string(parcel_id);
        });
        writer.option(edge.right_parcel_id.as_ref(), |writer, parcel_id| {
            writer.string(parcel_id);
        });
        writer.string(parcel_edge_kind(edge.kind));
        writer.option(edge.road_ref.as_ref(), |writer, road_ref| {
            writer.string(road_ref);
        });
    }

    let mut blocks = cadastre.blocks.iter().collect::<Vec<_>>();
    blocks.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(blocks.len()));
    for block in blocks {
        writer.tag(TAG_URBAN_BLOCK);
        writer.string(&block.id);
        writer.array(&block.boundary, |writer, point| {
            write_world_point(writer, *point);
        });
        writer.string_set(&block.parcel_ids);
        writer.string_set(&block.road_edge_ids);
    }

    let mut parcels = cadastre.parcels.iter().collect::<Vec<_>>();
    parcels.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(parcels.len()));
    for parcel in parcels {
        writer.tag(TAG_PARCEL);
        writer.string(&parcel.id);
        writer.string(&parcel.block_id);
        writer.string_array(&parcel.boundary_edge_ids);
        writer.f64(parcel.area_m2);
        write_world_point(writer, parcel.centroid);
        writer.string_set(&parcel.frontage_edge_ids);
        writer.string_set(&parcel.access_edge_ids);
        writer.string(&parcel.zoning_district_id);
        writer.option(parcel.owner_id.as_ref(), |writer, owner_id| {
            writer.string(owner_id);
        });
        writer.string_set(&parcel.historical_parent_ids);
    }

    let mut easements = cadastre.easements.iter().collect::<Vec<_>>();
    easements.sort_by(|left, right| compare_utf8(&left.id, &right.id));
    writer.u32(checked_len(easements.len()));
    for easement in easements {
        writer.tag(TAG_EASEMENT);
        writer.string(&easement.id);
        writer.string_set(&easement.parcel_ids);
        writer.string(easement_kind(easement.kind));
        writer.array(&easement.geometry, |writer, point| {
            write_world_point(writer, *point);
        });
    }

    let mut lineage = cadastre.lineage.iter().collect::<Vec<_>>();
    lineage.sort_by(|left, right| {
        left.tick
            .cmp(&right.tick)
            .then_with(|| compare_utf8(&left.id, &right.id))
    });
    writer.u32(checked_len(lineage.len()));
    for event in lineage {
        writer.tag(TAG_LINEAGE);
        writer.string(&event.id);
        writer.u64(event.tick);
        writer.string(parcel_lineage_kind(event.kind));
        writer.string_set(&event.source_parcel_ids);
        writer.string_set(&event.resulting_parcel_ids);
    }
}

fn write_vec2(writer: &mut CanonicalByteWriter, point: &Vec2) {
    writer.tag(TAG_POINT);
    writer.f64(point.x);
    writer.f64(point.y);
}

fn write_world_point(writer: &mut CanonicalByteWriter, point: WorldPoint) {
    writer.tag(TAG_POINT);
    writer.f64(point.x);
    writer.f64(point.y);
}

fn world_foundation_mode(value: WorldFoundationMode) -> &'static str {
    match value {
        WorldFoundationMode::Generated1r => "generated-1r",
        WorldFoundationMode::LegacyFlat => "legacy-flat",
        WorldFoundationMode::LegacyExplicit => "legacy-explicit",
    }
}

fn world_form_preset(value: WorldFormPreset) -> &'static str {
    match value {
        WorldFormPreset::Plain => "plain",
        WorldFormPreset::RiverValley => "river_valley",
        WorldFormPreset::Basin => "basin",
        WorldFormPreset::RollingUplands => "rolling_uplands",
        WorldFormPreset::RidgeEdge => "ridge_edge",
        WorldFormPreset::CoastalLowland => "coastal_lowland",
    }
}

fn soil_class(value: SoilClass) -> &'static str {
    match value {
        SoilClass::Rock => "rock",
        SoilClass::Gravel => "gravel",
        SoilClass::Sand => "sand",
        SoilClass::Loam => "loam",
        SoilClass::Clay => "clay",
        SoilClass::Alluvium => "alluvium",
        SoilClass::Peat => "peat",
        SoilClass::FillDisturbed => "fill_disturbed",
    }
}

fn vegetation_class(value: VegetationClass) -> &'static str {
    match value {
        VegetationClass::None => "none",
        VegetationClass::Grass => "grass",
        VegetationClass::Forest => "forest",
        VegetationClass::Scrub => "scrub",
        VegetationClass::Wetland => "wetland",
    }
}

fn surface_water_class(value: SurfaceWaterClass) -> &'static str {
    match value {
        SurfaceWaterClass::None => "none",
        SurfaceWaterClass::Lake => "lake",
        SurfaceWaterClass::River => "river",
        SurfaceWaterClass::Coast => "coast",
    }
}

fn biome(value: Biome) -> &'static str {
    match value {
        Biome::Grass => "grass",
        Biome::Forest => "forest",
        Biome::Rock => "rock",
        Biome::Water => "water",
    }
}

fn geography_kind(value: GeographyKind) -> &'static str {
    match value {
        GeographyKind::Region => "region",
        GeographyKind::Municipality => "municipality",
        GeographyKind::District => "district",
        GeographyKind::Neighborhood => "neighborhood",
        GeographyKind::Block => "block",
    }
}

fn parcel_edge_kind(value: ParcelEdgeKind) -> &'static str {
    match value {
        ParcelEdgeKind::PropertyBoundary => "property-boundary",
        ParcelEdgeKind::StreetFrontage => "street-frontage",
        ParcelEdgeKind::WaterBoundary => "water-boundary",
        ParcelEdgeKind::RightOfWay => "right-of-way",
        ParcelEdgeKind::EasementBoundary => "easement-boundary",
    }
}

fn easement_kind(value: EasementKind) -> &'static str {
    match value {
        EasementKind::Access => "access",
        EasementKind::Utility => "utility",
        EasementKind::Drainage => "drainage",
        EasementKind::Pedestrian => "pedestrian",
    }
}

fn parcel_lineage_kind(value: ParcelLineageKind) -> &'static str {
    match value {
        ParcelLineageKind::Split => "split",
        ParcelLineageKind::Assembly => "assembly",
        ParcelLineageKind::BoundaryAdjustment => "boundary-adjustment",
        ParcelLineageKind::RightOfWay => "right-of-way",
        ParcelLineageKind::Easement => "easement",
    }
}
