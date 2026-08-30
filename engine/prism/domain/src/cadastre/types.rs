use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct WorldPoint {
    pub x: f64,
    pub y: f64,
}

pub type PolygonRing = Vec<WorldPoint>;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ParcelNode {
    pub id: String,
    pub point: WorldPoint,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParcelEdgeKind {
    #[serde(rename = "property-boundary")]
    PropertyBoundary,
    #[serde(rename = "street-frontage")]
    StreetFrontage,
    #[serde(rename = "water-boundary")]
    WaterBoundary,
    #[serde(rename = "right-of-way")]
    RightOfWay,
    #[serde(rename = "easement-boundary")]
    EasementBoundary,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelEdge {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    #[serde(default)]
    pub left_parcel_id: Option<String>,
    #[serde(default)]
    pub right_parcel_id: Option<String>,
    pub kind: ParcelEdgeKind,
    #[serde(default)]
    pub road_ref: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Parcel {
    pub id: String,
    pub block_id: String,
    pub boundary_edge_ids: Vec<String>,
    pub area_m2: f64,
    pub centroid: WorldPoint,
    pub frontage_edge_ids: Vec<String>,
    pub access_edge_ids: Vec<String>,
    pub zoning_district_id: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    pub historical_parent_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UrbanBlock {
    pub id: String,
    pub boundary: PolygonRing,
    pub parcel_ids: Vec<String>,
    pub road_edge_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EasementKind {
    Access,
    Utility,
    Drainage,
    Pedestrian,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Easement {
    pub id: String,
    pub parcel_ids: Vec<String>,
    pub kind: EasementKind,
    pub geometry: Vec<WorldPoint>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ParcelLineageKind {
    #[serde(rename = "split")]
    Split,
    #[serde(rename = "assembly")]
    Assembly,
    #[serde(rename = "boundary-adjustment")]
    BoundaryAdjustment,
    #[serde(rename = "right-of-way")]
    RightOfWay,
    #[serde(rename = "easement")]
    Easement,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParcelLineageEvent {
    pub id: String,
    pub tick: u64,
    pub kind: ParcelLineageKind,
    pub source_parcel_ids: Vec<String>,
    pub resulting_parcel_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CadastralSnapshot {
    pub nodes: Vec<ParcelNode>,
    pub edges: Vec<ParcelEdge>,
    pub blocks: Vec<UrbanBlock>,
    pub parcels: Vec<Parcel>,
    pub easements: Vec<Easement>,
    pub lineage: Vec<ParcelLineageEvent>,
}
