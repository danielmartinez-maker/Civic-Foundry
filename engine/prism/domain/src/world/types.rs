use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldGenerationConfig {
    pub width: u32,
    pub height: u32,
    pub meters_per_cell: f64,
    pub preset: WorldFormPreset,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorldFormPreset {
    Plain,
    RiverValley,
    Basin,
    RollingUplands,
    RidgeEdge,
    CoastalLowland,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorldFoundationMode {
    #[serde(rename = "generated-1r")]
    Generated1r,
    #[serde(rename = "legacy-flat")]
    LegacyFlat,
    #[serde(rename = "legacy-explicit")]
    LegacyExplicit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SoilClass {
    Rock,
    Gravel,
    Sand,
    Loam,
    Clay,
    Alluvium,
    Peat,
    FillDisturbed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VegetationClass {
    None,
    Grass,
    Forest,
    Scrub,
    Wetland,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SurfaceWaterClass {
    None,
    Lake,
    River,
    Coast,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainPhysicalSample {
    pub elevation_meters: f64,
    pub slope: f64,
    pub aspect_radians: f64,
    pub soil_class: SoilClass,
    pub soil_depth_meters: f64,
    pub bearing_capacity_kpa: f64,
    pub bedrock_depth_meters: f64,
    pub groundwater_depth_meters: f64,
    pub vegetation_class: VegetationClass,
    pub contamination_index: f64,
    pub land_preparation_multiplier: f64,
    pub surface_water: SurfaceWaterClass,
    pub buildable: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerrainFieldSnapshot {
    pub width: u32,
    pub height: u32,
    pub meters_per_cell: f64,
    pub samples: Vec<TerrainPhysicalSample>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Biome {
    Grass,
    Forest,
    Rock,
    Water,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TerrainCell {
    pub elevation: f64,
    pub water: bool,
    pub buildable: bool,
    pub biome: Biome,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LegacyTerrainSnapshot {
    pub width: u32,
    pub height: u32,
    pub cells: Vec<TerrainCell>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatershedRecord {
    pub id: String,
    pub outlet_index: u32,
    pub member_count: u32,
    pub upstream_area_cells: u32,
    pub primary_channel_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelSegment {
    pub id: String,
    pub from_index: u32,
    pub to_index: u32,
    pub accumulation: f64,
    pub capacity_volume_m3: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrologySnapshot {
    pub width: u32,
    pub height: u32,
    pub conditioned_elevation_meters: Vec<f64>,
    pub receiver: Vec<Option<u32>>,
    pub watersheds: Vec<WatershedRecord>,
    pub channels: Vec<ChannelSegment>,
    pub flow_accumulation: Vec<f64>,
    pub watershed_ids: Vec<String>,
    pub flood_susceptibility: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FloodResult {
    pub event_id: String,
    pub depth_meters: Vec<f64>,
    pub rainfall_volume: f64,
    pub infiltration_volume: f64,
    pub retained_channel_surface_volume: f64,
    pub overbank_flood_volume: f64,
    pub exported_volume: f64,
    pub balance_error: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GeographyKind {
    Region,
    Municipality,
    District,
    Neighborhood,
    Block,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Polygon2 {
    pub points: Vec<Vec2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeographyEntity {
    pub id: String,
    pub kind: GeographyKind,
    pub parent_id: Option<String>,
    pub boundary: Polygon2,
    #[serde(default)]
    pub name: Option<String>,
    pub sort_key: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct GeographySnapshot {
    pub entities: Vec<GeographyEntity>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldFoundationSnapshot {
    pub mode: WorldFoundationMode,
    pub seed: i64,
    pub config: WorldGenerationConfig,
    pub scenario_id: Option<String>,
    pub terrain: TerrainFieldSnapshot,
    pub hydrology: HydrologySnapshot,
    pub geography: GeographySnapshot,
    pub legacy_compatibility: Option<LegacyTerrainSnapshot>,
    pub last_flood_result: Option<FloodResult>,
}
