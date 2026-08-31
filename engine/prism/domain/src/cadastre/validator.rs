use std::collections::{HashMap, HashSet};

use crate::error::P2AError;

use super::geometry::{normalize_ring, polygon_area, polygon_intersection, ring_self_intersects};
use super::types::{CadastralSnapshot, Parcel, ParcelEdge, ParcelNode, PolygonRing, WorldPoint};

const AREA_TOLERANCE_M2: f64 = 0.01;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CadastralValidationIssue {
    pub code: &'static str,
    pub entity_id: Option<String>,
}

#[must_use]
pub fn validate_cadastral_snapshot(snapshot: &CadastralSnapshot) -> Vec<CadastralValidationIssue> {
    let mut errors = Vec::new();
    check_duplicate_ids(snapshot, &mut errors);

    let nodes: HashMap<&str, &ParcelNode> = snapshot
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect();
    let edges: HashMap<&str, &ParcelEdge> = snapshot
        .edges
        .iter()
        .map(|edge| (edge.id.as_str(), edge))
        .collect();
    let blocks: HashMap<_, _> = snapshot
        .blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect();
    let parcels: HashMap<_, _> = snapshot
        .parcels
        .iter()
        .map(|parcel| (parcel.id.as_str(), parcel))
        .collect();

    let mut referenced_node_ids = HashSet::new();
    let mut edge_by_node_pair: HashMap<String, String> = HashMap::new();

    for edge in &snapshot.edges {
        let from = nodes.get(edge.from_node_id.as_str()).copied();
        let to = nodes.get(edge.to_node_id.as_str()).copied();
        if from.is_none() {
            push(&mut errors, "missing-node", Some(&edge.id));
        }
        if to.is_none() {
            push(&mut errors, "missing-node", Some(&edge.id));
        }
        if let Some(from) = from {
            referenced_node_ids.insert(from.id.as_str());
        }
        if let Some(to) = to {
            referenced_node_ids.insert(to.id.as_str());
        }
        if let (Some(from), Some(to)) = (from, to)
            && same_point(from.point, to.point)
        {
            push(&mut errors, "zero-length-edge", Some(&edge.id));
        }
        if edge
            .left_parcel_id
            .as_deref()
            .is_some_and(|id| !parcels.contains_key(id))
        {
            push(&mut errors, "missing-parcel", Some(&edge.id));
        }
        if edge
            .right_parcel_id
            .as_deref()
            .is_some_and(|id| !parcels.contains_key(id))
        {
            push(&mut errors, "missing-parcel", Some(&edge.id));
        }
        if edge.left_parcel_id.is_some() && edge.left_parcel_id == edge.right_parcel_id {
            push(&mut errors, "parcel-boundary-invalid", Some(&edge.id));
        }
        if edge.kind == super::types::ParcelEdgeKind::StreetFrontage && edge.road_ref.is_none() {
            push(&mut errors, "road-reference-missing", Some(&edge.id));
        }

        let pair_key = canonical_node_pair(&edge.from_node_id, &edge.to_node_id);
        if let Some(previous) = edge_by_node_pair.get(&pair_key) {
            if previous != &edge.id {
                push(&mut errors, "duplicate-shared-boundary", Some(&edge.id));
            }
        } else {
            edge_by_node_pair.insert(pair_key, edge.id.clone());
        }
    }

    for node in &snapshot.nodes {
        if !referenced_node_ids.contains(node.id.as_str()) {
            push(&mut errors, "orphan-node", Some(&node.id));
        }
    }

    let mut parcel_polygons: Vec<(String, PolygonRing)> = Vec::new();
    for parcel in &snapshot.parcels {
        match blocks.get(parcel.block_id.as_str()).copied() {
            None => push(&mut errors, "missing-block", Some(&parcel.id)),
            Some(block) if !block.parcel_ids.contains(&parcel.id) => {
                push(&mut errors, "parcel-block-mismatch", Some(&parcel.id));
            }
            Some(_) => {}
        }

        for edge_id in &parcel.boundary_edge_ids {
            match edges.get(edge_id.as_str()).copied() {
                None => push(&mut errors, "missing-edge", Some(&parcel.id)),
                Some(edge)
                    if edge.left_parcel_id.as_deref() != Some(parcel.id.as_str())
                        && edge.right_parcel_id.as_deref() != Some(parcel.id.as_str()) =>
                {
                    push(&mut errors, "parcel-boundary-invalid", Some(&parcel.id));
                }
                Some(_) => {}
            }
        }

        for edge_id in &parcel.frontage_edge_ids {
            let valid = edges.get(edge_id.as_str()).is_some_and(|edge| {
                parcel.boundary_edge_ids.contains(edge_id)
                    && edge.kind == super::types::ParcelEdgeKind::StreetFrontage
            });
            if !valid {
                push(&mut errors, "frontage-invalid", Some(&parcel.id));
            }
        }

        for edge_id in &parcel.access_edge_ids {
            if !edges.contains_key(edge_id.as_str()) {
                push(&mut errors, "access-invalid", Some(&parcel.id));
            }
        }

        match polygon_from_snapshot(parcel, &edges, &nodes) {
            Ok(polygon) => {
                parcel_polygons.push((parcel.id.clone(), polygon.clone()));
                match ring_self_intersects(&polygon) {
                    Ok(true) => {
                        push(&mut errors, "parcel-self-intersection", Some(&parcel.id));
                    }
                    Ok(false) => {}
                    Err(_) => {
                        push(&mut errors, "parcel-boundary-invalid", Some(&parcel.id));
                    }
                }
                match polygon_area(&polygon) {
                    Ok(calculated_area)
                        if (calculated_area - parcel.area_m2).abs() > AREA_TOLERANCE_M2 =>
                    {
                        push(&mut errors, "parcel-area-mismatch", Some(&parcel.id));
                    }
                    Ok(_) => {}
                    Err(_) => {
                        push(&mut errors, "parcel-boundary-invalid", Some(&parcel.id));
                    }
                }
            }
            Err(_) => push(&mut errors, "parcel-boundary-invalid", Some(&parcel.id)),
        }
    }

    for block in &snapshot.blocks {
        for parcel_id in &block.parcel_ids {
            match parcels.get(parcel_id.as_str()).copied() {
                None => push(&mut errors, "missing-parcel", Some(&block.id)),
                Some(parcel) if parcel.block_id != block.id => {
                    push(&mut errors, "parcel-block-mismatch", Some(&block.id));
                }
                Some(_) => {}
            }
        }
        for edge_id in &block.road_edge_ids {
            if !edges.contains_key(edge_id.as_str()) {
                push(&mut errors, "missing-edge", Some(&block.id));
            }
        }
    }

    for left_index in 0..parcel_polygons.len() {
        let (left_id, left_polygon) = &parcel_polygons[left_index];
        for (right_id, right_polygon) in parcel_polygons.iter().skip(left_index + 1) {
            let Ok(intersection) = polygon_intersection(left_polygon, right_polygon) else {
                continue;
            };
            let overlap_area = intersection
                .iter()
                .filter_map(|ring| polygon_area(ring).ok())
                .sum::<f64>();
            if overlap_area > AREA_TOLERANCE_M2 {
                let entity_id = format!("{left_id}|{right_id}");
                push(&mut errors, "parcel-overlap", Some(&entity_id));
            }
        }
    }

    for easement in &snapshot.easements {
        for parcel_id in &easement.parcel_ids {
            if !parcels.contains_key(parcel_id.as_str()) {
                push(
                    &mut errors,
                    "easement-reference-invalid",
                    Some(&easement.id),
                );
            }
        }
    }

    if lineage_has_cycle(snapshot) {
        push(&mut errors, "lineage-cycle", None);
    }

    errors
}

fn check_duplicate_ids(snapshot: &CadastralSnapshot, errors: &mut Vec<CadastralValidationIssue>) {
    check_duplicate_group(snapshot.nodes.iter().map(|row| row.id.as_str()), errors);
    check_duplicate_group(snapshot.edges.iter().map(|row| row.id.as_str()), errors);
    check_duplicate_group(snapshot.blocks.iter().map(|row| row.id.as_str()), errors);
    check_duplicate_group(snapshot.parcels.iter().map(|row| row.id.as_str()), errors);
    check_duplicate_group(snapshot.easements.iter().map(|row| row.id.as_str()), errors);
    check_duplicate_group(snapshot.lineage.iter().map(|row| row.id.as_str()), errors);
}

fn check_duplicate_group<'a>(
    ids: impl IntoIterator<Item = &'a str>,
    errors: &mut Vec<CadastralValidationIssue>,
) {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            push(errors, "duplicate-id", Some(id));
        }
    }
}

fn polygon_from_snapshot(
    parcel: &Parcel,
    edges: &HashMap<&str, &ParcelEdge>,
    nodes: &HashMap<&str, &ParcelNode>,
) -> Result<PolygonRing, P2AError> {
    if parcel.boundary_edge_ids.len() < 3 {
        return Err(boundary_error(&parcel.id));
    }
    let boundary_edges = parcel
        .boundary_edge_ids
        .iter()
        .map(|edge_id| {
            edges
                .get(edge_id.as_str())
                .copied()
                .ok_or_else(|| boundary_error(&parcel.id))
        })
        .collect::<Result<Vec<_>, _>>()?;

    if let Some(points) = walk_boundary(&boundary_edges, nodes, false) {
        return normalize_ring(&points);
    }
    if let Some(points) = walk_boundary(&boundary_edges, nodes, true) {
        return normalize_ring(&points);
    }
    Err(boundary_error(&parcel.id))
}

fn walk_boundary(
    edges: &[&ParcelEdge],
    nodes: &HashMap<&str, &ParcelNode>,
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
    let start = nodes.get(start_node_id).copied()?;
    let mut points = vec![start.point];

    for edge in edges.iter().skip(1) {
        let node = nodes.get(current_node_id).copied()?;
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

fn lineage_has_cycle(snapshot: &CadastralSnapshot) -> bool {
    let mut graph: HashMap<&str, HashSet<&str>> = HashMap::new();
    for event in &snapshot.lineage {
        for source in &event.source_parcel_ids {
            let targets = graph.entry(source.as_str()).or_default();
            for result in &event.resulting_parcel_ids {
                targets.insert(result.as_str());
            }
        }
    }

    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    graph
        .keys()
        .copied()
        .any(|id| visit_lineage(id, &graph, &mut visiting, &mut visited))
}

fn visit_lineage<'a>(
    id: &'a str,
    graph: &HashMap<&'a str, HashSet<&'a str>>,
    visiting: &mut HashSet<&'a str>,
    visited: &mut HashSet<&'a str>,
) -> bool {
    if visiting.contains(id) {
        return true;
    }
    if visited.contains(id) {
        return false;
    }
    visiting.insert(id);
    if graph.get(id).is_some_and(|next| {
        next.iter()
            .copied()
            .any(|next_id| visit_lineage(next_id, graph, visiting, visited))
    }) {
        return true;
    }
    visiting.remove(id);
    visited.insert(id);
    false
}

fn same_point(left: WorldPoint, right: WorldPoint) -> bool {
    left.x == right.x && left.y == right.y
}

fn canonical_node_pair(left: &str, right: &str) -> String {
    if left < right {
        format!("{left}|{right}")
    } else {
        format!("{right}|{left}")
    }
}

fn push(errors: &mut Vec<CadastralValidationIssue>, code: &'static str, entity_id: Option<&str>) {
    errors.push(CadastralValidationIssue {
        code,
        entity_id: entity_id.map(str::to_owned),
    });
}

fn boundary_error(parcel_id: &str) -> P2AError {
    P2AError::CadastreValidation {
        code: "parcel-boundary-invalid",
        entity_id: Some(parcel_id.to_owned()),
    }
}
