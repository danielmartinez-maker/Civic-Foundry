use std::collections::{BTreeMap, BTreeSet};

use super::super::geometry::{polygon_area, polygon_union};
use super::super::graph::CadastralGraph;
use super::super::types::ParcelLineageKind;
use super::{
    AREA_TOLERANCE_M2, CadastralMutationResult, ParcelGeometrySpec, committed,
    create_lineage_event, current_geometry_specs, error_reason, lineage_parents, mutation_sequence,
    rebuild_snapshot, rejected,
};

impl CadastralGraph {
    #[must_use]
    pub fn assemble_parcels(&mut self, parcel_ids: &[String]) -> CadastralMutationResult {
        match assembly_candidate(self, parcel_ids) {
            Ok((candidate, result)) => {
                *self = candidate;
                result
            }
            Err(reason) => rejected(reason),
        }
    }
}

fn assembly_candidate(
    graph: &CadastralGraph,
    parcel_ids: &[String],
) -> Result<(CadastralGraph, CadastralMutationResult), String> {
    let before = graph.snapshot();
    let source_ids = parcel_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if source_ids.len() < 2 {
        return Err("assembly-requires-at-least-two-parcels".to_owned());
    }

    let sources = source_ids
        .iter()
        .map(|id| {
            graph
                .get_parcel(id)
                .cloned()
                .ok_or_else(|| "assembly-references-unknown-parcel".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let first = &sources[0];
    if sources
        .iter()
        .any(|parcel| parcel.block_id != first.block_id)
    {
        return Err("assembly-requires-one-block".to_owned());
    }
    if sources
        .iter()
        .any(|parcel| parcel.zoning_district_id != first.zoning_district_id)
    {
        return Err("assembly-requires-one-zoning-district".to_owned());
    }
    if sources
        .iter()
        .any(|parcel| parcel.owner_id != first.owner_id)
    {
        return Err("assembly-requires-common-owner".to_owned());
    }

    let source_set = source_ids.iter().cloned().collect::<BTreeSet<_>>();
    if before.easements.iter().any(|easement| {
        easement
            .parcel_ids
            .iter()
            .any(|parcel_id| source_set.contains(parcel_id))
    }) {
        return Err("parcel-has-easement".to_owned());
    }
    if !selection_is_connected(graph, &source_ids, &source_set) {
        return Err("assembly-parcels-not-adjacent".to_owned());
    }

    let polygons = source_ids
        .iter()
        .map(|id| graph.parcel_polygon(id).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?;
    let mut union = polygon_union(&polygons).map_err(error_reason)?;
    if union.len() != 1 {
        return Err("assembly-does-not-form-one-contiguous-polygon".to_owned());
    }
    let source_area = polygons
        .iter()
        .map(|polygon| polygon_area(polygon).map_err(error_reason))
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .sum::<f64>();
    let union_area = polygon_area(&union[0]).map_err(error_reason)?;
    if (source_area - union_area).abs() > AREA_TOLERANCE_M2 {
        return Err("assembly-area-not-conserved".to_owned());
    }

    let sequence = mutation_sequence(&before);
    let result_id = format!("parcel:assembly:{sequence}:{}", source_ids.join("+"));
    if before.parcels.iter().any(|parcel| parcel.id == result_id) {
        return Err("generated-parcel-id-collision".to_owned());
    }

    let inherited_parents = sources
        .iter()
        .flat_map(|parcel| parcel.historical_parent_ids.iter().cloned())
        .collect::<Vec<_>>();
    let historical_parent_ids = lineage_parents(&source_ids, &inherited_parents);
    let mut specs = current_geometry_specs(graph, &before, &source_set)?;
    specs.push(ParcelGeometrySpec {
        id: result_id.clone(),
        block_id: first.block_id.clone(),
        zoning_district_id: first.zoning_district_id.clone(),
        owner_id: first.owner_id.clone(),
        historical_parent_ids,
        polygon: union.remove(0),
    });

    let mut lineage = before.lineage.clone();
    lineage.push(create_lineage_event(
        &before,
        ParcelLineageKind::Assembly,
        "assembly",
        source_ids.clone(),
        vec![result_id.clone()],
    ));
    let candidate_snapshot = rebuild_snapshot(&before, specs, lineage, &[])?;
    let candidate = CadastralGraph::try_from_snapshot(candidate_snapshot).map_err(error_reason)?;
    let rewrites = source_ids
        .iter()
        .cloned()
        .map(|source_id| (source_id, result_id.clone()))
        .collect::<BTreeMap<_, _>>();

    Ok((candidate, committed(vec![result_id], source_ids, rewrites)))
}

fn selection_is_connected(
    graph: &CadastralGraph,
    source_ids: &[String],
    source_set: &BTreeSet<String>,
) -> bool {
    let mut visited = BTreeSet::new();
    let mut pending = vec![source_ids[0].clone()];
    while let Some(current) = pending.pop() {
        if !visited.insert(current.clone()) {
            continue;
        }
        for adjacent in graph.adjacent_parcel_ids(&current) {
            if source_set.contains(&adjacent) && !visited.contains(&adjacent) {
                pending.push(adjacent);
            }
        }
    }
    visited.len() == source_ids.len()
}
