use std::collections::{BTreeMap, BTreeSet};

use super::super::geometry::{
    normalize_ring, polygon_area, polygon_difference, polygon_intersection,
};
use super::super::graph::CadastralGraph;
use super::super::types::{ParcelLineageKind, WorldPoint};
use super::{
    AREA_TOLERANCE_M2, CadastralMutationResult, ParcelGeometrySpec, committed,
    create_lineage_event, current_geometry_specs, error_reason, lineage_parents, mutation_sequence,
    rebuild_snapshot, rejected,
};

const MIN_RIGHT_OF_WAY_AREA_M2: f64 = 1.0;
const MIN_SPLIT_AREA_M2: f64 = 1.0;

impl CadastralGraph {
    #[must_use]
    pub fn dedicate_right_of_way(
        &mut self,
        parcel_id: &str,
        geometry: &[WorldPoint],
    ) -> CadastralMutationResult {
        match right_of_way_candidate(self, parcel_id, geometry) {
            Ok((candidate, result)) => {
                *self = candidate;
                result
            }
            Err(reason) => rejected(reason),
        }
    }
}

fn right_of_way_candidate(
    graph: &CadastralGraph,
    parcel_id: &str,
    geometry: &[WorldPoint],
) -> Result<(CadastralGraph, CadastralMutationResult), String> {
    let before = graph.snapshot();
    let source = graph
        .get_parcel(parcel_id)
        .cloned()
        .ok_or_else(|| format!("unknown-parcel:{parcel_id}"))?;
    if before
        .easements
        .iter()
        .any(|easement| easement.parcel_ids.iter().any(|id| id == parcel_id))
    {
        return Err("parcel-has-easement".to_owned());
    }

    let source_polygon = graph.parcel_polygon(parcel_id).map_err(error_reason)?;
    let dedication = normalize_ring(geometry).map_err(error_reason)?;
    let dedicated_area = polygon_area(&dedication).map_err(error_reason)?;
    if dedicated_area < MIN_RIGHT_OF_WAY_AREA_M2 {
        return Err("right-of-way-too-small".to_owned());
    }

    let contained_area = polygon_intersection(&source_polygon, &dedication)
        .map_err(error_reason)?
        .iter()
        .map(|ring| polygon_area(ring).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum::<f64>();
    if (contained_area - dedicated_area).abs() > AREA_TOLERANCE_M2 {
        return Err("right-of-way-outside-parcel".to_owned());
    }

    let mut residuals = polygon_difference(&source_polygon, &dedication).map_err(error_reason)?;
    if residuals.len() != 1 {
        return Err("right-of-way-must-leave-one-residual-parcel".to_owned());
    }
    let residual = residuals.remove(0);
    let residual_area = polygon_area(&residual).map_err(error_reason)?;
    if residual_area < MIN_SPLIT_AREA_M2 {
        return Err("right-of-way-consumes-parcel".to_owned());
    }
    if (source.area_m2 - residual_area - dedicated_area).abs() > AREA_TOLERANCE_M2 {
        return Err("right-of-way-area-not-conserved".to_owned());
    }

    let sequence = mutation_sequence(&before);
    let residual_id = format!("parcel:{}:row:{sequence}", source.id);
    if before.parcels.iter().any(|parcel| parcel.id == residual_id) {
        return Err("generated-parcel-id-collision".to_owned());
    }

    let parents = lineage_parents(
        std::slice::from_ref(&source.id),
        &source.historical_parent_ids,
    );
    let source_set = BTreeSet::from([source.id.clone()]);
    let mut specs = current_geometry_specs(graph, &before, &source_set)?;
    specs.push(ParcelGeometrySpec {
        id: residual_id.clone(),
        block_id: source.block_id.clone(),
        zoning_district_id: source.zoning_district_id.clone(),
        owner_id: source.owner_id.clone(),
        historical_parent_ids: parents,
        polygon: residual,
    });

    let mut lineage = before.lineage.clone();
    lineage.push(create_lineage_event(
        &before,
        ParcelLineageKind::RightOfWay,
        "right-of-way",
        vec![source.id.clone()],
        vec![residual_id.clone()],
    ));
    let candidate_snapshot = rebuild_snapshot(&before, specs, lineage, &[dedication])?;
    let candidate = CadastralGraph::try_from_snapshot(candidate_snapshot).map_err(error_reason)?;
    let rewrites = BTreeMap::from([(source.id.clone(), residual_id.clone())]);

    Ok((
        candidate,
        committed(vec![residual_id], vec![source.id], rewrites),
    ))
}
