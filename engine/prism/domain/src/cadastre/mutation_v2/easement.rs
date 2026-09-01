use std::collections::BTreeSet;

use super::super::geometry::{normalize_point, point_in_ring};
use super::super::graph::CadastralGraph;
use super::super::types::{Easement, EasementKind, PolygonRing, WorldPoint};
use super::{CadastralMutationResult, committed, error_reason, point_key, rejected, unique_id};

const EASEMENT_SAMPLE_STEPS: usize = 8;

impl CadastralGraph {
    #[must_use]
    pub fn create_easement(
        &mut self,
        parcel_ids: &[String],
        kind: EasementKind,
        geometry: &[WorldPoint],
    ) -> CadastralMutationResult {
        match create_easement_candidate(self, parcel_ids, kind, geometry) {
            Ok((candidate, result)) => {
                *self = candidate;
                result
            }
            Err(reason) => rejected(reason),
        }
    }

    #[must_use]
    pub fn remove_easement(&mut self, easement_id: &str) -> CadastralMutationResult {
        match remove_easement_candidate(self, easement_id) {
            Ok((candidate, result)) => {
                *self = candidate;
                result
            }
            Err(reason) => rejected(reason),
        }
    }
}

fn create_easement_candidate(
    graph: &CadastralGraph,
    parcel_ids: &[String],
    kind: EasementKind,
    geometry: &[WorldPoint],
) -> Result<(CadastralGraph, CadastralMutationResult), String> {
    let before = graph.snapshot();
    let target_ids = parcel_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if target_ids.is_empty() {
        return Err("easement-requires-parcel".to_owned());
    }
    if geometry.len() < 2 {
        return Err("easement-requires-two-points".to_owned());
    }
    if target_ids.iter().any(|id| graph.get_parcel(id).is_none()) {
        return Err("easement-references-unknown-parcel".to_owned());
    }

    let normalized_geometry = geometry
        .iter()
        .copied()
        .map(|point| normalize_point(point).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?;
    let distinct_points = normalized_geometry
        .iter()
        .copied()
        .map(point_key)
        .collect::<Result<BTreeSet<_>, _>>()?;
    if distinct_points.len() < 2 {
        return Err("easement-geometry-collapses".to_owned());
    }

    let target_polygons = target_ids
        .iter()
        .map(|id| graph.parcel_polygon(id).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?;
    if !polyline_within_polygons(&normalized_geometry, &target_polygons)? {
        return Err("easement-outside-parcel".to_owned());
    }

    let used_ids = before
        .easements
        .iter()
        .map(|easement| easement.id.clone())
        .collect::<BTreeSet<_>>();
    let easement_id = unique_id(
        &format!(
            "easement:{}:{}",
            easement_kind_name(kind),
            target_ids.join("+")
        ),
        &used_ids,
    );
    let mut candidate_snapshot = before;
    candidate_snapshot.easements.push(Easement {
        id: easement_id,
        parcel_ids: target_ids,
        kind,
        geometry: normalized_geometry,
    });
    let candidate = CadastralGraph::try_from_snapshot(candidate_snapshot).map_err(error_reason)?;
    Ok((
        candidate,
        committed(Vec::new(), Vec::new(), Default::default()),
    ))
}

fn remove_easement_candidate(
    graph: &CadastralGraph,
    easement_id: &str,
) -> Result<(CadastralGraph, CadastralMutationResult), String> {
    if graph.get_easement(easement_id).is_none() {
        return Err(format!("unknown-easement:{easement_id}"));
    }
    let mut candidate_snapshot = graph.snapshot();
    candidate_snapshot
        .easements
        .retain(|easement| easement.id != easement_id);
    let candidate = CadastralGraph::try_from_snapshot(candidate_snapshot).map_err(error_reason)?;
    Ok((
        candidate,
        committed(Vec::new(), Vec::new(), Default::default()),
    ))
}

fn polyline_within_polygons(
    polyline: &[WorldPoint],
    polygons: &[PolygonRing],
) -> Result<bool, String> {
    for segment in polyline.windows(2) {
        let start = segment[0];
        let end = segment[1];
        for step in 0..=EASEMENT_SAMPLE_STEPS {
            let t = step as f64 / EASEMENT_SAMPLE_STEPS as f64;
            let point = normalize_point(WorldPoint {
                x: start.x + (end.x - start.x) * t,
                y: start.y + (end.y - start.y) * t,
            })
            .map_err(error_reason)?;
            let mut contained = false;
            for polygon in polygons {
                if point_in_ring(point, polygon).map_err(error_reason)? {
                    contained = true;
                    break;
                }
            }
            if !contained {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn easement_kind_name(kind: EasementKind) -> &'static str {
    match kind {
        EasementKind::Access => "access",
        EasementKind::Utility => "utility",
        EasementKind::Drainage => "drainage",
        EasementKind::Pedestrian => "pedestrian",
    }
}
