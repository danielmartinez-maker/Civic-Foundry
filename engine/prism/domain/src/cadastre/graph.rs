use std::collections::{BTreeMap, BTreeSet};

use crate::error::P2AError;

use super::geometry::normalize_ring;
use super::types::{
    CadastralSnapshot, Easement, Parcel, ParcelEdge, ParcelLineageEvent, ParcelNode, PolygonRing,
    UrbanBlock, WorldPoint,
};
use super::validator::validate_cadastral_snapshot;

#[derive(Clone, Debug, PartialEq)]
pub struct CadastralGraph {
    nodes: BTreeMap<String, ParcelNode>,
    edges: BTreeMap<String, ParcelEdge>,
    blocks: BTreeMap<String, UrbanBlock>,
    parcels: BTreeMap<String, Parcel>,
    easements: BTreeMap<String, Easement>,
    lineage: Vec<ParcelLineageEvent>,
}

#[derive(Clone, Debug, PartialEq)]
struct AabbEntry {
    id: String,
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
}

impl CadastralGraph {
    pub fn try_from_snapshot(mut snapshot: CadastralSnapshot) -> Result<Self, P2AError> {
        if let Some(issue) = validate_cadastral_snapshot(&snapshot).into_iter().next() {
            return Err(P2AError::CadastreValidation {
                code: issue.code,
                entity_id: issue.entity_id,
            });
        }

        canonicalize_snapshot(&mut snapshot);
        Ok(Self {
            nodes: snapshot
                .nodes
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect(),
            edges: snapshot
                .edges
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect(),
            blocks: snapshot
                .blocks
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect(),
            parcels: snapshot
                .parcels
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect(),
            easements: snapshot
                .easements
                .into_iter()
                .map(|row| (row.id.clone(), row))
                .collect(),
            lineage: snapshot.lineage,
        })
    }

    #[must_use]
    pub fn get_node(&self, id: &str) -> Option<&ParcelNode> {
        self.nodes.get(id)
    }

    #[must_use]
    pub fn get_edge(&self, id: &str) -> Option<&ParcelEdge> {
        self.edges.get(id)
    }

    #[must_use]
    pub fn get_block(&self, id: &str) -> Option<&UrbanBlock> {
        self.blocks.get(id)
    }

    #[must_use]
    pub fn get_parcel(&self, id: &str) -> Option<&Parcel> {
        self.parcels.get(id)
    }

    #[must_use]
    pub fn get_easement(&self, id: &str) -> Option<&Easement> {
        self.easements.get(id)
    }

    #[must_use]
    pub fn list_nodes(&self) -> Vec<&ParcelNode> {
        self.nodes.values().collect()
    }

    #[must_use]
    pub fn list_edges(&self) -> Vec<&ParcelEdge> {
        self.edges.values().collect()
    }

    #[must_use]
    pub fn list_blocks(&self) -> Vec<&UrbanBlock> {
        self.blocks.values().collect()
    }

    #[must_use]
    pub fn list_parcels(&self) -> Vec<&Parcel> {
        self.parcels.values().collect()
    }

    #[must_use]
    pub fn list_easements(&self) -> Vec<&Easement> {
        self.easements.values().collect()
    }

    #[must_use]
    pub fn list_lineage(&self) -> &[ParcelLineageEvent] {
        &self.lineage
    }

    #[must_use]
    pub fn snapshot(&self) -> CadastralSnapshot {
        CadastralSnapshot {
            nodes: self.nodes.values().cloned().collect(),
            edges: self.edges.values().cloned().collect(),
            blocks: self.blocks.values().cloned().collect(),
            parcels: self.parcels.values().cloned().collect(),
            easements: self.easements.values().cloned().collect(),
            lineage: self.lineage.clone(),
        }
    }

    #[must_use]
    pub fn adjacent_parcel_ids(&self, parcel_id: &str) -> Vec<String> {
        if !self.parcels.contains_key(parcel_id) {
            return Vec::new();
        }
        let mut adjacent = BTreeSet::new();
        for edge in self.edges.values() {
            if edge.left_parcel_id.as_deref() == Some(parcel_id)
                && let Some(right) = &edge.right_parcel_id
            {
                adjacent.insert(right.clone());
            }
            if edge.right_parcel_id.as_deref() == Some(parcel_id)
                && let Some(left) = &edge.left_parcel_id
            {
                adjacent.insert(left.clone());
            }
        }
        adjacent.into_iter().collect()
    }

    pub fn parcel_polygon(&self, parcel_id: &str) -> Result<PolygonRing, P2AError> {
        let parcel = self
            .parcels
            .get(parcel_id)
            .ok_or_else(|| P2AError::CadastreValidation {
                code: "missing-parcel",
                entity_id: Some(parcel_id.to_owned()),
            })?;
        trace_boundary(parcel, &self.edges, &self.nodes)
    }

    pub fn parcel_ids_in_aabb(
        &self,
        min_x: f64,
        min_y: f64,
        max_x: f64,
        max_y: f64,
    ) -> Result<Vec<String>, P2AError> {
        validate_query_aabb(min_x, min_y, max_x, max_y)?;

        let mut index = Vec::with_capacity(self.parcels.len());
        for parcel_id in self.parcels.keys() {
            let polygon = self.parcel_polygon(parcel_id)?;
            let (parcel_min_x, parcel_min_y, parcel_max_x, parcel_max_y) = ring_bounds(&polygon);
            index.push(AabbEntry {
                id: parcel_id.clone(),
                min_x: parcel_min_x,
                min_y: parcel_min_y,
                max_x: parcel_max_x,
                max_y: parcel_max_y,
            });
        }
        index.sort_by(|left, right| left.id.cmp(&right.id));

        Ok(index
            .into_iter()
            .filter(|entry| {
                entry.min_x <= max_x
                    && entry.max_x >= min_x
                    && entry.min_y <= max_y
                    && entry.max_y >= min_y
            })
            .map(|entry| entry.id)
            .collect())
    }
}

impl TryFrom<CadastralSnapshot> for CadastralGraph {
    type Error = P2AError;

    fn try_from(snapshot: CadastralSnapshot) -> Result<Self, Self::Error> {
        Self::try_from_snapshot(snapshot)
    }
}

fn canonicalize_snapshot(snapshot: &mut CadastralSnapshot) {
    for block in &mut snapshot.blocks {
        block.parcel_ids.sort();
        block.road_edge_ids.sort();
    }
    for parcel in &mut snapshot.parcels {
        parcel.frontage_edge_ids.sort();
        parcel.access_edge_ids.sort();
        parcel.historical_parent_ids.sort();
    }
    for easement in &mut snapshot.easements {
        easement.parcel_ids.sort();
    }
    for event in &mut snapshot.lineage {
        event.source_parcel_ids.sort();
        event.resulting_parcel_ids.sort();
    }

    snapshot.nodes.sort_by(|left, right| left.id.cmp(&right.id));
    snapshot.edges.sort_by(|left, right| left.id.cmp(&right.id));
    snapshot
        .blocks
        .sort_by(|left, right| left.id.cmp(&right.id));
    snapshot
        .parcels
        .sort_by(|left, right| left.id.cmp(&right.id));
    snapshot
        .easements
        .sort_by(|left, right| left.id.cmp(&right.id));
    snapshot.lineage.sort_by(|left, right| {
        left.tick
            .cmp(&right.tick)
            .then_with(|| left.id.cmp(&right.id))
    });
}

fn trace_boundary(
    parcel: &Parcel,
    edges: &BTreeMap<String, ParcelEdge>,
    nodes: &BTreeMap<String, ParcelNode>,
) -> Result<PolygonRing, P2AError> {
    if parcel.boundary_edge_ids.len() < 3 {
        return Err(boundary_error(&parcel.id));
    }
    let boundary_edges = parcel
        .boundary_edge_ids
        .iter()
        .map(|edge_id| edges.get(edge_id).ok_or_else(|| boundary_error(&parcel.id)))
        .collect::<Result<Vec<_>, _>>()?;

    if let Some(points) = walk_boundary(&boundary_edges, nodes, false) {
        return normalize_ring(&points).map_err(|_| boundary_error(&parcel.id));
    }
    if let Some(points) = walk_boundary(&boundary_edges, nodes, true) {
        return normalize_ring(&points).map_err(|_| boundary_error(&parcel.id));
    }
    Err(boundary_error(&parcel.id))
}

fn walk_boundary(
    edges: &[&ParcelEdge],
    nodes: &BTreeMap<String, ParcelNode>,
    reverse_first: bool,
) -> Option<Vec<WorldPoint>> {
    let first = edges.first().copied()?;
    let start_node_id = if reverse_first {
        first.to_node_id.as_str()
    } else {
        first.from_node_id.as_str()
    };
    let mut current_node_id = if reverse_first {
        first.from_node_id.as_str()
    } else {
        first.to_node_id.as_str()
    };
    let start = nodes.get(start_node_id)?;
    let mut points = vec![start.point];

    for edge in edges.iter().skip(1) {
        let node = nodes.get(current_node_id)?;
        points.push(node.point);
        if edge.from_node_id == current_node_id {
            current_node_id = edge.to_node_id.as_str();
        } else if edge.to_node_id == current_node_id {
            current_node_id = edge.from_node_id.as_str();
        } else {
            return None;
        }
    }

    (current_node_id == start_node_id).then_some(points)
}

fn ring_bounds(ring: &[WorldPoint]) -> (f64, f64, f64, f64) {
    let first = ring
        .first()
        .expect("validated parcel polygons contain at least three points");
    ring.iter().skip(1).fold(
        (first.x, first.y, first.x, first.y),
        |(min_x, min_y, max_x, max_y), point| {
            (
                min_x.min(point.x),
                min_y.min(point.y),
                max_x.max(point.x),
                max_y.max(point.y),
            )
        },
    )
}

fn validate_query_aabb(
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
) -> Result<(), P2AError> {
    if [min_x, min_y, max_x, max_y]
        .into_iter()
        .any(|value| !value.is_finite())
        || min_x > max_x
        || min_y > max_y
    {
        return Err(P2AError::CadastreValidation {
            code: "query-invalid-aabb",
            entity_id: None,
        });
    }
    Ok(())
}

fn boundary_error(parcel_id: &str) -> P2AError {
    P2AError::CadastreValidation {
        code: "parcel-boundary-invalid",
        entity_id: Some(parcel_id.to_owned()),
    }
}
