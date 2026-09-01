use std::collections::{BTreeMap, BTreeSet};

use crate::error::P2AError;

use super::geometry::{normalize_point, normalize_ring, polygon_area};
use super::graph::CadastralGraph;
use super::types::{
    CadastralSnapshot, Easement, Parcel, ParcelEdge, ParcelEdgeKind, ParcelLineageEvent,
    ParcelLineageKind, ParcelNode, PolygonRing, UrbanBlock, WorldPoint,
};

const GEOMETRY_EPSILON: f64 = 1.0e-7;
const AREA_TOLERANCE_M2: f64 = 0.01;
const MIN_SPLIT_AREA_M2: f64 = 1.0;
const MIN_CUT_LENGTH_M: f64 = 0.1;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CadastralMutationResult {
    pub committed: bool,
    pub resulting_parcel_ids: Vec<String>,
    pub retired_parcel_ids: Vec<String>,
    pub parcel_reference_rewrites: BTreeMap<String, String>,
    pub rejection_reasons: Vec<String>,
}

#[derive(Clone, Debug)]
struct ParcelGeometrySpec {
    id: String,
    block_id: String,
    zoning_district_id: String,
    owner_id: Option<String>,
    historical_parent_ids: Vec<String>,
    polygon: PolygonRing,
}

#[derive(Clone, Copy, Debug)]
struct SegmentUse {
    parcel_index: usize,
    from: WorldPoint,
    to: WorldPoint,
}

impl CadastralGraph {
    #[must_use]
    pub fn split_parcel(
        &mut self,
        parcel_id: &str,
        cut_line: &[WorldPoint],
    ) -> CadastralMutationResult {
        match split_parcel_candidate(self, parcel_id, cut_line) {
            Ok((candidate, result)) => {
                *self = candidate;
                result
            }
            Err(reason) => rejected(reason),
        }
    }
}

fn split_parcel_candidate(
    graph: &CadastralGraph,
    parcel_id: &str,
    cut_line: &[WorldPoint],
) -> Result<(CadastralGraph, CadastralMutationResult), String> {
    let before = graph.snapshot();
    let source = graph
        .get_parcel(parcel_id)
        .cloned()
        .ok_or_else(|| format!("unknown-parcel:{parcel_id}"))?;
    if cut_line.len() != 2 {
        return Err("split-requires-two-point-cut".to_owned());
    }
    if before
        .easements
        .iter()
        .any(|easement| easement.parcel_ids.iter().any(|id| id == parcel_id))
    {
        return Err("parcel-has-easement".to_owned());
    }

    let start = normalize_point(cut_line[0]).map_err(error_reason)?;
    let end = normalize_point(cut_line[1]).map_err(error_reason)?;
    if distance(start, end) < MIN_CUT_LENGTH_M {
        return Err("cut-too-short".to_owned());
    }

    let source_polygon = graph.parcel_polygon(parcel_id).map_err(error_reason)?;
    if !point_on_boundary(start, &source_polygon) || !point_on_boundary(end, &source_polygon) {
        return Err("cut-endpoints-must-lie-on-boundary".to_owned());
    }

    let pieces = split_ring_by_chord(&source_polygon, start, end)
        .ok_or_else(|| "cut-does-not-produce-two-valid-parcels".to_owned())?;
    let source_area = polygon_area(&source_polygon).map_err(error_reason)?;
    let split_area = pieces
        .iter()
        .map(|piece| polygon_area(piece).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum::<f64>();
    if (source_area - split_area).abs() > AREA_TOLERANCE_M2 {
        return Err("split-area-not-conserved".to_owned());
    }

    let sequence = mutation_sequence(&before);
    let child_ids = vec![
        format!("parcel:{}:split:{sequence}:0", source.id),
        format!("parcel:{}:split:{sequence}:1", source.id),
    ];
    if child_ids[0] == child_ids[1]
        || child_ids
            .iter()
            .any(|id| before.parcels.iter().any(|parcel| parcel.id == *id))
    {
        return Err("generated-parcel-id-collision".to_owned());
    }

    let parents = lineage_parents(&[source.id.clone()], &source.historical_parent_ids);
    let mut specs = current_geometry_specs(graph, &before, &BTreeSet::from([source.id.clone()]))?;
    for (index, polygon) in pieces.into_iter().enumerate() {
        specs.push(ParcelGeometrySpec {
            id: child_ids[index].clone(),
            block_id: source.block_id.clone(),
            zoning_district_id: source.zoning_district_id.clone(),
            owner_id: source.owner_id.clone(),
            historical_parent_ids: parents.clone(),
            polygon,
        });
    }

    let lineage_event = create_lineage_event(
        &before,
        ParcelLineageKind::Split,
        "split",
        vec![source.id.clone()],
        child_ids.clone(),
    );
    let mut lineage = before.lineage.clone();
    lineage.push(lineage_event);
    let candidate_snapshot = rebuild_snapshot(&before, specs, lineage, &[])?;
    let candidate = CadastralGraph::try_from_snapshot(candidate_snapshot).map_err(error_reason)?;

    Ok((
        candidate,
        committed(child_ids, vec![source.id], BTreeMap::new()),
    ))
}

fn current_geometry_specs(
    graph: &CadastralGraph,
    snapshot: &CadastralSnapshot,
    excluded_ids: &BTreeSet<String>,
) -> Result<Vec<ParcelGeometrySpec>, String> {
    snapshot
        .parcels
        .iter()
        .filter(|parcel| !excluded_ids.contains(&parcel.id))
        .map(|parcel| {
            Ok(ParcelGeometrySpec {
                id: parcel.id.clone(),
                block_id: parcel.block_id.clone(),
                zoning_district_id: parcel.zoning_district_id.clone(),
                owner_id: parcel.owner_id.clone(),
                historical_parent_ids: parcel.historical_parent_ids.clone(),
                polygon: graph.parcel_polygon(&parcel.id).map_err(error_reason)?,
            })
        })
        .collect()
}

fn rebuild_snapshot(
    before: &CadastralSnapshot,
    raw_specs: Vec<ParcelGeometrySpec>,
    lineage: Vec<ParcelLineageEvent>,
    right_of_way_boundaries: &[PolygonRing],
) -> Result<CadastralSnapshot, String> {
    let mut old_nodes_by_point = BTreeMap::new();
    for node in &before.nodes {
        old_nodes_by_point.insert(point_key(node.point)?, node.clone());
    }
    let old_nodes_by_id = before
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node.clone()))
        .collect::<BTreeMap<_, _>>();

    let mut all_vertices = Vec::new();
    for spec in &raw_specs {
        all_vertices.extend(normalize_ring(&spec.polygon).map_err(error_reason)?);
    }
    let mut specs = raw_specs
        .into_iter()
        .map(|mut spec| {
            spec.polygon = segmentize_ring(&spec.polygon, &all_vertices)?;
            Ok(spec)
        })
        .collect::<Result<Vec<_>, String>>()?;
    specs.sort_by(|left, right| left.id.cmp(&right.id));

    let mut node_by_point = BTreeMap::<String, ParcelNode>::new();
    let mut used_node_ids = BTreeSet::<String>::new();
    let mut uses_by_segment = BTreeMap::<String, Vec<SegmentUse>>::new();
    let mut segment_keys_by_parcel = BTreeMap::<String, Vec<String>>::new();

    for (parcel_index, spec) in specs.iter().enumerate() {
        let ring = normalize_ring(&spec.polygon).map_err(error_reason)?;
        let mut keys = Vec::with_capacity(ring.len());
        for index in 0..ring.len() {
            let from = ring[index];
            let to = ring[(index + 1) % ring.len()];
            ensure_node(
                from,
                &old_nodes_by_point,
                &mut node_by_point,
                &mut used_node_ids,
            )?;
            ensure_node(
                to,
                &old_nodes_by_point,
                &mut node_by_point,
                &mut used_node_ids,
            )?;
            let key = segment_key(from, to)?;
            keys.push(key.clone());
            uses_by_segment.entry(key).or_default().push(SegmentUse {
                parcel_index,
                from,
                to,
            });
        }
        segment_keys_by_parcel.insert(spec.id.clone(), keys);
    }

    let mut old_exact_edge_by_segment = BTreeMap::<String, ParcelEdge>::new();
    for edge in &before.edges {
        let Some(from) = old_nodes_by_id
            .get(&edge.from_node_id)
            .map(|node| node.point)
        else {
            continue;
        };
        let Some(to) = old_nodes_by_id.get(&edge.to_node_id).map(|node| node.point) else {
            continue;
        };
        old_exact_edge_by_segment.insert(segment_key(from, to)?, edge.clone());
    }

    let mut used_edge_ids = BTreeSet::<String>::new();
    let mut edge_by_segment = BTreeMap::<String, ParcelEdge>::new();
    for (key, uses) in &uses_by_segment {
        if uses.is_empty() || uses.len() > 2 {
            return Err(format!("non-manifold parcel boundary:{key}"));
        }
        let first = uses[0];
        let from_node = node_by_point
            .get(&point_key(first.from)?)
            .ok_or_else(|| "topology-missing-node".to_owned())?;
        let to_node = node_by_point
            .get(&point_key(first.to)?)
            .ok_or_else(|| "topology-missing-node".to_owned())?;
        let previous = old_exact_edge_by_segment.get(key);
        let id = previous
            .filter(|edge| !used_edge_ids.contains(&edge.id))
            .map_or_else(
                || unique_id(&format!("edge:{key}"), &used_edge_ids),
                |edge| edge.id.clone(),
            );
        used_edge_ids.insert(id.clone());

        let shared = uses.len() == 2;
        let inherited = if shared {
            None
        } else {
            find_containing_old_edge(first.from, first.to, &before.edges, &old_nodes_by_id)
        };
        let dedicated_boundary = !shared
            && right_of_way_boundaries
                .iter()
                .any(|boundary| segment_on_boundary(first.from, first.to, boundary));
        let kind = if shared {
            ParcelEdgeKind::PropertyBoundary
        } else if dedicated_boundary {
            ParcelEdgeKind::RightOfWay
        } else {
            inherited
                .map(|edge| edge.kind)
                .unwrap_or(ParcelEdgeKind::PropertyBoundary)
        };
        let road_ref = if kind == ParcelEdgeKind::StreetFrontage {
            inherited.and_then(|edge| edge.road_ref.clone())
        } else {
            None
        };
        edge_by_segment.insert(
            key.clone(),
            ParcelEdge {
                id,
                from_node_id: from_node.id.clone(),
                to_node_id: to_node.id.clone(),
                left_parcel_id: Some(specs[first.parcel_index].id.clone()),
                right_parcel_id: uses
                    .get(1)
                    .map(|other| specs[other.parcel_index].id.clone()),
                kind,
                road_ref,
            },
        );
    }

    let mut parcels = Vec::<Parcel>::with_capacity(specs.len());
    for spec in &specs {
        let keys = segment_keys_by_parcel
            .get(&spec.id)
            .ok_or_else(|| "topology-missing-parcel-segments".to_owned())?;
        let boundary_edges = keys
            .iter()
            .map(|key| {
                edge_by_segment
                    .get(key)
                    .ok_or_else(|| "topology-missing-edge".to_owned())
            })
            .collect::<Result<Vec<_>, _>>()?;
        let boundary_edge_ids = boundary_edges
            .iter()
            .map(|edge| edge.id.clone())
            .collect::<Vec<_>>();
        let frontage_edge_ids = boundary_edges
            .iter()
            .filter(|edge| edge.kind == ParcelEdgeKind::StreetFrontage)
            .map(|edge| edge.id.clone())
            .collect::<Vec<_>>();
        let access_edge_ids = boundary_edges
            .iter()
            .filter(|edge| {
                edge.kind == ParcelEdgeKind::StreetFrontage
                    || edge.kind == ParcelEdgeKind::RightOfWay
            })
            .map(|edge| edge.id.clone())
            .collect::<Vec<_>>();
        parcels.push(Parcel {
            id: spec.id.clone(),
            block_id: spec.block_id.clone(),
            boundary_edge_ids,
            area_m2: polygon_area(&spec.polygon).map_err(error_reason)?,
            centroid: polygon_centroid(&spec.polygon)?,
            frontage_edge_ids,
            access_edge_ids,
            zoning_district_id: spec.zoning_district_id.clone(),
            owner_id: spec.owner_id.clone(),
            historical_parent_ids: spec.historical_parent_ids.clone(),
        });
    }

    parcels.sort_by(|left, right| left.id.cmp(&right.id));
    let mut blocks = before
        .blocks
        .iter()
        .map(|block| rebuild_block(block, &parcels))
        .collect::<Vec<_>>();
    blocks.sort_by(|left, right| left.id.cmp(&right.id));

    let mut nodes = node_by_point.into_values().collect::<Vec<_>>();
    nodes.sort_by(|left, right| left.id.cmp(&right.id));
    let mut edges = edge_by_segment.into_values().collect::<Vec<_>>();
    edges.sort_by(|left, right| left.id.cmp(&right.id));

    Ok(CadastralSnapshot {
        nodes,
        edges,
        blocks,
        parcels,
        easements: clone_easements(&before.easements)?,
        lineage,
    })
}

fn rebuild_block(block: &UrbanBlock, parcels: &[Parcel]) -> UrbanBlock {
    let mut parcel_ids = parcels
        .iter()
        .filter(|parcel| parcel.block_id == block.id)
        .map(|parcel| parcel.id.clone())
        .collect::<Vec<_>>();
    parcel_ids.sort();
    let mut road_edge_ids = parcels
        .iter()
        .filter(|parcel| parcel.block_id == block.id)
        .flat_map(|parcel| parcel.frontage_edge_ids.iter().cloned())
        .collect::<Vec<_>>();
    road_edge_ids.sort();
    road_edge_ids.dedup();
    UrbanBlock {
        id: block.id.clone(),
        boundary: block.boundary.clone(),
        parcel_ids,
        road_edge_ids,
    }
}

fn clone_easements(easements: &[Easement]) -> Result<Vec<Easement>, String> {
    easements
        .iter()
        .map(|easement| {
            Ok(Easement {
                id: easement.id.clone(),
                parcel_ids: easement.parcel_ids.clone(),
                kind: easement.kind,
                geometry: easement
                    .geometry
                    .iter()
                    .copied()
                    .map(|point| normalize_point(point).map_err(error_reason))
                    .collect::<Result<Vec<_>, _>>()?,
            })
        })
        .collect()
}

fn ensure_node(
    point: WorldPoint,
    old_nodes_by_point: &BTreeMap<String, ParcelNode>,
    node_by_point: &mut BTreeMap<String, ParcelNode>,
    used_node_ids: &mut BTreeSet<String>,
) -> Result<(), String> {
    let normalized = normalize_point(point).map_err(error_reason)?;
    let key = point_key(normalized)?;
    if node_by_point.contains_key(&key) {
        return Ok(());
    }
    let id = old_nodes_by_point
        .get(&key)
        .filter(|node| !used_node_ids.contains(&node.id))
        .map_or_else(
            || unique_id(&format!("node:{key}"), used_node_ids),
            |node| node.id.clone(),
        );
    used_node_ids.insert(id.clone());
    node_by_point.insert(
        key,
        ParcelNode {
            id,
            point: normalized,
        },
    );
    Ok(())
}

fn split_ring_by_chord(
    ring: &[WorldPoint],
    start: WorldPoint,
    end: WorldPoint,
) -> Option<[PolygonRing; 2]> {
    let positive = clip_to_half_plane(ring, start, end, 1.0)?;
    let negative = clip_to_half_plane(ring, start, end, -1.0)?;
    if polygon_area(&positive).ok()? < MIN_SPLIT_AREA_M2
        || polygon_area(&negative).ok()? < MIN_SPLIT_AREA_M2
    {
        return None;
    }
    Some([positive, negative])
}

fn clip_to_half_plane(
    ring: &[WorldPoint],
    line_start: WorldPoint,
    line_end: WorldPoint,
    sign: f64,
) -> Option<PolygonRing> {
    let source = normalize_ring(ring).ok()?;
    let mut output = Vec::new();
    for index in 0..source.len() {
        let from = source[index];
        let to = source[(index + 1) % source.len()];
        let from_side = line_side(line_start, line_end, from) * sign;
        let to_side = line_side(line_start, line_end, to) * sign;
        let from_inside = from_side >= -GEOMETRY_EPSILON;
        let to_inside = to_side >= -GEOMETRY_EPSILON;
        if from_inside && to_inside {
            output.push(to);
        } else if from_inside && !to_inside {
            output.push(line_intersection(from, to, line_start, line_end)?);
        } else if !from_inside && to_inside {
            output.push(line_intersection(from, to, line_start, line_end)?);
            output.push(to);
        }
    }
    if output.len() < 3 {
        return None;
    }
    normalize_ring(&output).ok()
}

fn segmentize_ring(ring: &[WorldPoint], vertices: &[WorldPoint]) -> Result<PolygonRing, String> {
    let source = normalize_ring(ring).map_err(error_reason)?;
    let mut expanded = Vec::new();
    for index in 0..source.len() {
        let from = source[index];
        let to = source[(index + 1) % source.len()];
        expanded.push(from);
        let mut interior = vertices
            .iter()
            .copied()
            .map(|point| normalize_point(point).map_err(error_reason))
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|point| !same_point(*point, from) && !same_point(*point, to))
            .filter(|point| point_on_segment(*point, from, to))
            .collect::<Vec<_>>();
        interior.sort_by(|left, right| {
            segment_parameter(*left, from, to).total_cmp(&segment_parameter(*right, from, to))
        });
        for point in interior {
            if expanded
                .last()
                .is_none_or(|previous| !same_point(*previous, point))
            {
                expanded.push(point);
            }
        }
    }
    normalize_ring(&expanded).map_err(error_reason)
}

fn find_containing_old_edge<'a>(
    from: WorldPoint,
    to: WorldPoint,
    old_edges: &'a [ParcelEdge],
    old_nodes: &'a BTreeMap<String, ParcelNode>,
) -> Option<&'a ParcelEdge> {
    old_edges.iter().find(|edge| {
        let Some(old_from) = old_nodes.get(&edge.from_node_id).map(|node| node.point) else {
            return false;
        };
        let Some(old_to) = old_nodes.get(&edge.to_node_id).map(|node| node.point) else {
            return false;
        };
        point_on_segment(from, old_from, old_to) && point_on_segment(to, old_from, old_to)
    })
}

fn segment_on_boundary(from: WorldPoint, to: WorldPoint, ring: &[WorldPoint]) -> bool {
    point_on_boundary(from, ring)
        && point_on_boundary(to, ring)
        && normalize_point(WorldPoint {
            x: (from.x + to.x) / 2.0,
            y: (from.y + to.y) / 2.0,
        })
        .is_ok_and(|midpoint| point_on_boundary(midpoint, ring))
}

fn point_on_boundary(point: WorldPoint, ring: &[WorldPoint]) -> bool {
    let Ok(normalized) = normalize_ring(ring) else {
        return false;
    };
    (0..normalized.len()).any(|index| {
        point_on_segment(
            point,
            normalized[index],
            normalized[(index + 1) % normalized.len()],
        )
    })
}

fn point_on_segment(point: WorldPoint, start: WorldPoint, end: WorldPoint) -> bool {
    let cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
    if cross.abs() > GEOMETRY_EPSILON {
        return false;
    }
    let dot = (point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y);
    if dot < -GEOMETRY_EPSILON {
        return false;
    }
    let length_squared = (end.x - start.x).mul_add(end.x - start.x, (end.y - start.y).powi(2));
    dot <= length_squared + GEOMETRY_EPSILON
}

fn line_side(start: WorldPoint, end: WorldPoint, point: WorldPoint) -> f64 {
    (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x)
}

fn line_intersection(
    segment_start: WorldPoint,
    segment_end: WorldPoint,
    line_start: WorldPoint,
    line_end: WorldPoint,
) -> Option<WorldPoint> {
    let start_side = line_side(line_start, line_end, segment_start);
    let end_side = line_side(line_start, line_end, segment_end);
    let denominator = start_side - end_side;
    if denominator.abs() <= GEOMETRY_EPSILON {
        return normalize_point(segment_start).ok();
    }
    let t = start_side / denominator;
    normalize_point(WorldPoint {
        x: segment_start.x + (segment_end.x - segment_start.x) * t,
        y: segment_start.y + (segment_end.y - segment_start.y) * t,
    })
    .ok()
}

fn segment_parameter(point: WorldPoint, start: WorldPoint, end: WorldPoint) -> f64 {
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    let denominator = dx.mul_add(dx, dy * dy);
    if denominator <= GEOMETRY_EPSILON {
        0.0
    } else {
        ((point.x - start.x) * dx + (point.y - start.y) * dy) / denominator
    }
}

fn distance(left: WorldPoint, right: WorldPoint) -> f64 {
    (right.x - left.x).hypot(right.y - left.y)
}

fn polygon_centroid(ring: &[WorldPoint]) -> Result<WorldPoint, String> {
    let ring = normalize_ring(ring).map_err(error_reason)?;
    let mut cross_sum = 0.0;
    let mut x_sum = 0.0;
    let mut y_sum = 0.0;
    for index in 0..ring.len() {
        let current = ring[index];
        let next = ring[(index + 1) % ring.len()];
        let cross = current.x * next.y - next.x * current.y;
        cross_sum += cross;
        x_sum += (current.x + next.x) * cross;
        y_sum += (current.y + next.y) * cross;
    }
    if cross_sum.abs() <= GEOMETRY_EPSILON {
        return Err("zero-area-ring".to_owned());
    }
    normalize_point(WorldPoint {
        x: x_sum / (3.0 * cross_sum),
        y: y_sum / (3.0 * cross_sum),
    })
    .map_err(error_reason)
}

fn mutation_sequence(snapshot: &CadastralSnapshot) -> u64 {
    snapshot
        .lineage
        .iter()
        .map(|event| event.tick)
        .max()
        .unwrap_or(0)
        + 1
}

fn create_lineage_event(
    snapshot: &CadastralSnapshot,
    kind: ParcelLineageKind,
    kind_name: &str,
    mut source_parcel_ids: Vec<String>,
    mut resulting_parcel_ids: Vec<String>,
) -> ParcelLineageEvent {
    source_parcel_ids.sort();
    source_parcel_ids.dedup();
    resulting_parcel_ids.sort();
    resulting_parcel_ids.dedup();
    let tick = mutation_sequence(snapshot);
    let used = snapshot
        .lineage
        .iter()
        .map(|event| event.id.clone())
        .collect::<BTreeSet<_>>();
    ParcelLineageEvent {
        id: unique_id(&format!("lineage:{tick}:{kind_name}"), &used),
        tick,
        kind,
        source_parcel_ids,
        resulting_parcel_ids,
    }
}

fn lineage_parents(source_ids: &[String], inherited: &[String]) -> Vec<String> {
    source_ids
        .iter()
        .chain(inherited)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn point_key(point: WorldPoint) -> Result<String, String> {
    let normalized = normalize_point(point).map_err(error_reason)?;
    Ok(format!("{},{}", normalized.x, normalized.y))
}

fn segment_key(from: WorldPoint, to: WorldPoint) -> Result<String, String> {
    let left = point_key(from)?;
    let right = point_key(to)?;
    if left < right {
        Ok(format!("{left}|{right}"))
    } else {
        Ok(format!("{right}|{left}"))
    }
}

fn same_point(left: WorldPoint, right: WorldPoint) -> bool {
    (left.x - right.x).abs() <= GEOMETRY_EPSILON && (left.y - right.y).abs() <= GEOMETRY_EPSILON
}

fn unique_id(base: &str, used: &BTreeSet<String>) -> String {
    if !used.contains(base) {
        return base.to_owned();
    }
    let mut suffix = 1_u64;
    loop {
        let candidate = format!("{base}:{suffix}");
        if !used.contains(&candidate) {
            return candidate;
        }
        suffix += 1;
    }
}

fn committed(
    resulting_parcel_ids: Vec<String>,
    mut retired_parcel_ids: Vec<String>,
    parcel_reference_rewrites: BTreeMap<String, String>,
) -> CadastralMutationResult {
    retired_parcel_ids.sort();
    CadastralMutationResult {
        committed: true,
        resulting_parcel_ids,
        retired_parcel_ids,
        parcel_reference_rewrites,
        rejection_reasons: Vec::new(),
    }
}

fn rejected(reason: String) -> CadastralMutationResult {
    CadastralMutationResult {
        committed: false,
        resulting_parcel_ids: Vec::new(),
        retired_parcel_ids: Vec::new(),
        parcel_reference_rewrites: BTreeMap::new(),
        rejection_reasons: vec![reason],
    }
}

fn error_reason(error: P2AError) -> String {
    match error {
        P2AError::Decode { message } => message,
        P2AError::UnsupportedSchema { found } => format!("unsupported-schema:{found}"),
        P2AError::UnsupportedSourceVersion {
            save_version,
            game_version,
        } => format!("unsupported-source-version:{save_version}:{game_version}"),
        P2AError::WorldValidation { code, field } => format!("{code}:{field}"),
        P2AError::CadastreValidation { code, entity_id }
        | P2AError::Geometry { code, entity_id } => {
            entity_id.map_or_else(|| code.to_owned(), |id| format!("{code}:{id}"))
        }
        P2AError::MutationRejected { reasons } => reasons.join(";"),
        P2AError::ParityMismatch { section, detail } => format!("{section}:{detail}"),
    }
}
