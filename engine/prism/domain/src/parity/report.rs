use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::cadastre::mutation::CadastralMutationResult;
use crate::cadastre::types::{EasementKind, ParcelLineageEvent, ParcelLineageKind, WorldPoint};
use crate::cadastre::validator::validate_cadastral_snapshot;
use crate::canonical::hash::prism_canonical_hash_v1;
use crate::compat::envelope::{P2AMirror, import_envelope_json};
use crate::error::P2AError;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct P2AParityCase {
    pub name: String,
    pub envelope: serde_json::Value,
    pub commands: Vec<P2AMutationCommand>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case", rename_all_fields = "camelCase")]
pub enum P2AMutationCommand {
    Split {
        parcel_id: String,
        cut_line: Vec<WorldPoint>,
    },
    Assemble {
        parcel_ids: Vec<String>,
    },
    CreateEasement {
        parcel_ids: Vec<String>,
        easement_kind: EasementKind,
        geometry: Vec<WorldPoint>,
    },
    RemoveEasement {
        easement_id: String,
    },
    RightOfWay {
        parcel_id: String,
        geometry: Vec<WorldPoint>,
    },
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct P2AParityReport {
    pub name: String,
    pub steps: Vec<P2AParityStep>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct P2AParityStep {
    pub index: usize,
    pub committed: bool,
    pub resulting_parcel_ids: Vec<String>,
    pub retired_parcel_ids: Vec<String>,
    pub parcel_reference_rewrites: BTreeMap<String, String>,
    pub rejection_reasons: Vec<String>,
    pub canonical_hash: String,
    pub total_parcel_area_m2: f64,
    pub lineage: Vec<P2ALineageView>,
    pub validation: Vec<P2AValidationPair>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct P2ALineageView {
    pub id: String,
    pub tick: u64,
    pub kind: &'static str,
    pub source_parcel_ids: Vec<String>,
    pub resulting_parcel_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct P2AValidationPair {
    pub code: &'static str,
    pub entity_id: Option<String>,
}

pub fn run_parity_case(case: P2AParityCase) -> Result<P2AParityReport, P2AError> {
    let envelope_bytes = serde_json::to_vec(&case.envelope).map_err(|error| P2AError::Decode {
        message: error.to_string(),
    })?;
    let mut mirror = import_envelope_json(&envelope_bytes)?;
    let mut steps = Vec::with_capacity(case.commands.len());

    for (index, command) in case.commands.iter().enumerate() {
        let result = apply_command(&mut mirror, command);
        steps.push(step_report(index, &mirror, result));
    }

    Ok(P2AParityReport {
        name: case.name,
        steps,
    })
}

fn apply_command(mirror: &mut P2AMirror, command: &P2AMutationCommand) -> CadastralMutationResult {
    match command {
        P2AMutationCommand::Split {
            parcel_id,
            cut_line,
        } => mirror.cadastre.split_parcel(parcel_id, cut_line),
        P2AMutationCommand::Assemble { parcel_ids } => mirror.cadastre.assemble_parcels(parcel_ids),
        P2AMutationCommand::CreateEasement {
            parcel_ids,
            easement_kind,
            geometry,
        } => mirror
            .cadastre
            .create_easement(parcel_ids, *easement_kind, geometry),
        P2AMutationCommand::RemoveEasement { easement_id } => {
            mirror.cadastre.remove_easement(easement_id)
        }
        P2AMutationCommand::RightOfWay {
            parcel_id,
            geometry,
        } => mirror.cadastre.dedicate_right_of_way(parcel_id, geometry),
    }
}

fn step_report(
    index: usize,
    mirror: &P2AMirror,
    result: CadastralMutationResult,
) -> P2AParityStep {
    let snapshot = mirror.cadastre.snapshot();
    let mut validation = validate_cadastral_snapshot(&snapshot)
        .into_iter()
        .map(|issue| P2AValidationPair {
            code: issue.code,
            entity_id: issue.entity_id,
        })
        .collect::<Vec<_>>();
    validation.sort();

    let mut lineage = snapshot
        .lineage
        .iter()
        .map(lineage_view)
        .collect::<Vec<_>>();
    lineage.sort_by(|left, right| {
        left.tick
            .cmp(&right.tick)
            .then_with(|| left.id.cmp(&right.id))
    });

    P2AParityStep {
        index,
        committed: result.committed,
        resulting_parcel_ids: result.resulting_parcel_ids,
        retired_parcel_ids: result.retired_parcel_ids,
        parcel_reference_rewrites: result.parcel_reference_rewrites,
        rejection_reasons: result.rejection_reasons,
        canonical_hash: prism_canonical_hash_v1(mirror),
        total_parcel_area_m2: snapshot.parcels.iter().map(|parcel| parcel.area_m2).sum(),
        lineage,
        validation,
    }
}

fn lineage_view(event: &ParcelLineageEvent) -> P2ALineageView {
    let mut source_parcel_ids = event.source_parcel_ids.clone();
    source_parcel_ids.sort();
    let mut resulting_parcel_ids = event.resulting_parcel_ids.clone();
    resulting_parcel_ids.sort();
    P2ALineageView {
        id: event.id.clone(),
        tick: event.tick,
        kind: lineage_kind_name(event.kind),
        source_parcel_ids,
        resulting_parcel_ids,
    }
}

fn lineage_kind_name(kind: ParcelLineageKind) -> &'static str {
    match kind {
        ParcelLineageKind::Split => "split",
        ParcelLineageKind::Assembly => "assembly",
        ParcelLineageKind::BoundaryAdjustment => "boundary-adjustment",
        ParcelLineageKind::RightOfWay => "right-of-way",
        ParcelLineageKind::Easement => "easement",
    }
}
