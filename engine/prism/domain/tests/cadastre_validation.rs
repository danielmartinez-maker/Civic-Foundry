use std::collections::BTreeSet;

use prism_domain::cadastre::types::{
    CadastralSnapshot, Easement, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind,
    ParcelLineageEvent, ParcelLineageKind, ParcelNode, UrbanBlock, WorldPoint,
};
use prism_domain::cadastre::validator::validate_cadastral_snapshot;

fn point(x: f64, y: f64) -> WorldPoint {
    WorldPoint { x, y }
}

fn valid_snapshot() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            ParcelNode {
                id: "n0".into(),
                point: point(0.0, 0.0),
            },
            ParcelNode {
                id: "n1".into(),
                point: point(20.0, 0.0),
            },
            ParcelNode {
                id: "n2".into(),
                point: point(20.0, 20.0),
            },
            ParcelNode {
                id: "n3".into(),
                point: point(0.0, 20.0),
            },
        ],
        edges: vec![
            ParcelEdge {
                id: "e0".into(),
                from_node_id: "n0".into(),
                to_node_id: "n1".into(),
                left_parcel_id: Some("p0".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::StreetFrontage,
                road_ref: Some("south".into()),
            },
            ParcelEdge {
                id: "e1".into(),
                from_node_id: "n1".into(),
                to_node_id: "n2".into(),
                left_parcel_id: Some("p0".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "e2".into(),
                from_node_id: "n2".into(),
                to_node_id: "n3".into(),
                left_parcel_id: Some("p0".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
            ParcelEdge {
                id: "e3".into(),
                from_node_id: "n3".into(),
                to_node_id: "n0".into(),
                left_parcel_id: Some("p0".into()),
                right_parcel_id: None,
                kind: ParcelEdgeKind::PropertyBoundary,
                road_ref: None,
            },
        ],
        blocks: vec![UrbanBlock {
            id: "b0".into(),
            boundary: vec![
                point(0.0, 0.0),
                point(20.0, 0.0),
                point(20.0, 20.0),
                point(0.0, 20.0),
            ],
            parcel_ids: vec!["p0".into()],
            road_edge_ids: vec!["e0".into()],
        }],
        parcels: vec![Parcel {
            id: "p0".into(),
            block_id: "b0".into(),
            boundary_edge_ids: vec!["e0".into(), "e1".into(), "e2".into(), "e3".into()],
            area_m2: 400.0,
            centroid: point(10.0, 10.0),
            frontage_edge_ids: vec!["e0".into()],
            access_edge_ids: vec!["e0".into()],
            zoning_district_id: "R2".into(),
            owner_id: None,
            historical_parent_ids: vec![],
        }],
        easements: vec![],
        lineage: vec![],
    }
}

fn issue_pairs(snapshot: &CadastralSnapshot) -> BTreeSet<(&'static str, Option<String>)> {
    validate_cadastral_snapshot(snapshot)
        .into_iter()
        .map(|issue| (issue.code, issue.entity_id))
        .collect()
}

fn assert_issue(snapshot: &CadastralSnapshot, code: &'static str, entity_id: Option<&str>) {
    let expected = (code, entity_id.map(str::to_owned));
    let actual = issue_pairs(snapshot);
    assert!(
        actual.contains(&expected),
        "expected {expected:?} in validator output {actual:?}"
    );
}

fn lineage(id: &str, source: &[&str], result: &[&str]) -> ParcelLineageEvent {
    ParcelLineageEvent {
        id: id.into(),
        tick: 1,
        kind: ParcelLineageKind::Split,
        source_parcel_ids: source.iter().map(|value| (*value).to_owned()).collect(),
        resulting_parcel_ids: result.iter().map(|value| (*value).to_owned()).collect(),
    }
}

fn add_remote_edge(snapshot: &mut CadastralSnapshot, parcel_id: Option<&str>) {
    snapshot.nodes.push(ParcelNode {
        id: "probe-n0".into(),
        point: point(100.0, 100.0),
    });
    snapshot.nodes.push(ParcelNode {
        id: "probe-n1".into(),
        point: point(101.0, 100.0),
    });
    snapshot.edges.push(ParcelEdge {
        id: "probe-edge".into(),
        from_node_id: "probe-n0".into(),
        to_node_id: "probe-n1".into(),
        left_parcel_id: parcel_id.map(str::to_owned),
        right_parcel_id: None,
        kind: ParcelEdgeKind::PropertyBoundary,
        road_ref: None,
    });
}

fn add_overlapping_parcel(snapshot: &mut CadastralSnapshot) {
    snapshot.nodes.extend([
        ParcelNode {
            id: "m0".into(),
            point: point(0.0, 0.0),
        },
        ParcelNode {
            id: "m1".into(),
            point: point(20.0, 0.0),
        },
        ParcelNode {
            id: "m2".into(),
            point: point(20.0, 20.0),
        },
        ParcelNode {
            id: "m3".into(),
            point: point(0.0, 20.0),
        },
    ]);
    snapshot.edges.extend([
        ParcelEdge {
            id: "m-e0".into(),
            from_node_id: "m0".into(),
            to_node_id: "m1".into(),
            left_parcel_id: Some("p1".into()),
            right_parcel_id: None,
            kind: ParcelEdgeKind::StreetFrontage,
            road_ref: Some("south-2".into()),
        },
        ParcelEdge {
            id: "m-e1".into(),
            from_node_id: "m1".into(),
            to_node_id: "m2".into(),
            left_parcel_id: Some("p1".into()),
            right_parcel_id: None,
            kind: ParcelEdgeKind::PropertyBoundary,
            road_ref: None,
        },
        ParcelEdge {
            id: "m-e2".into(),
            from_node_id: "m2".into(),
            to_node_id: "m3".into(),
            left_parcel_id: Some("p1".into()),
            right_parcel_id: None,
            kind: ParcelEdgeKind::PropertyBoundary,
            road_ref: None,
        },
        ParcelEdge {
            id: "m-e3".into(),
            from_node_id: "m3".into(),
            to_node_id: "m0".into(),
            left_parcel_id: Some("p1".into()),
            right_parcel_id: None,
            kind: ParcelEdgeKind::PropertyBoundary,
            road_ref: None,
        },
    ]);
    snapshot.blocks[0].parcel_ids.push("p1".into());
    snapshot.parcels.push(Parcel {
        id: "p1".into(),
        block_id: "b0".into(),
        boundary_edge_ids: vec!["m-e0".into(), "m-e1".into(), "m-e2".into(), "m-e3".into()],
        area_m2: 400.0,
        centroid: point(10.0, 10.0),
        frontage_edge_ids: vec!["m-e0".into()],
        access_edge_ids: vec!["m-e0".into()],
        zoning_district_id: "R2".into(),
        owner_id: None,
        historical_parent_ids: vec![],
    });
}

#[test]
fn every_current_typescript_validator_code_has_a_stable_native_code_entity_pair() {
    let mut covered = BTreeSet::new();

    let mut snapshot = valid_snapshot();
    snapshot.lineage = vec![lineage("dup", &[], &[]), lineage("dup", &[], &[])];
    assert_issue(&snapshot, "duplicate-id", Some("dup"));
    covered.insert("duplicate-id");

    let mut snapshot = valid_snapshot();
    snapshot.edges.push(ParcelEdge {
        id: "missing-node-edge".into(),
        from_node_id: "n0".into(),
        to_node_id: "ghost-node".into(),
        left_parcel_id: None,
        right_parcel_id: None,
        kind: ParcelEdgeKind::PropertyBoundary,
        road_ref: None,
    });
    assert_issue(&snapshot, "missing-node", Some("missing-node-edge"));
    covered.insert("missing-node");

    let mut snapshot = valid_snapshot();
    snapshot.blocks[0].road_edge_ids.push("ghost-edge".into());
    assert_issue(&snapshot, "missing-edge", Some("b0"));
    covered.insert("missing-edge");

    let mut snapshot = valid_snapshot();
    add_remote_edge(&mut snapshot, Some("ghost-parcel"));
    assert_issue(&snapshot, "missing-parcel", Some("probe-edge"));
    covered.insert("missing-parcel");

    let mut snapshot = valid_snapshot();
    snapshot.parcels[0].block_id = "ghost-block".into();
    assert_issue(&snapshot, "missing-block", Some("p0"));
    covered.insert("missing-block");

    let mut snapshot = valid_snapshot();
    snapshot.edges[0].to_node_id = "n0".into();
    assert_issue(&snapshot, "zero-length-edge", Some("e0"));
    covered.insert("zero-length-edge");

    let mut snapshot = valid_snapshot();
    snapshot.edges.push(ParcelEdge {
        id: "duplicate-edge".into(),
        from_node_id: "n1".into(),
        to_node_id: "n0".into(),
        left_parcel_id: None,
        right_parcel_id: None,
        kind: ParcelEdgeKind::PropertyBoundary,
        road_ref: None,
    });
    assert_issue(
        &snapshot,
        "duplicate-shared-boundary",
        Some("duplicate-edge"),
    );
    covered.insert("duplicate-shared-boundary");

    let mut snapshot = valid_snapshot();
    snapshot.edges[1].left_parcel_id = None;
    assert_issue(&snapshot, "parcel-boundary-invalid", Some("p0"));
    covered.insert("parcel-boundary-invalid");

    let mut snapshot = valid_snapshot();
    snapshot.nodes[1].point = point(20.0, 20.0);
    snapshot.nodes[2].point = point(0.0, 20.0);
    snapshot.nodes[3].point = point(20.0, 0.0);
    assert_issue(&snapshot, "parcel-self-intersection", Some("p0"));
    covered.insert("parcel-self-intersection");

    let mut snapshot = valid_snapshot();
    snapshot.parcels[0].area_m2 = 399.0;
    assert_issue(&snapshot, "parcel-area-mismatch", Some("p0"));
    covered.insert("parcel-area-mismatch");

    let mut snapshot = valid_snapshot();
    add_overlapping_parcel(&mut snapshot);
    assert_issue(&snapshot, "parcel-overlap", Some("p0|p1"));
    covered.insert("parcel-overlap");

    let mut snapshot = valid_snapshot();
    snapshot.blocks[0].parcel_ids.clear();
    assert_issue(&snapshot, "parcel-block-mismatch", Some("p0"));
    covered.insert("parcel-block-mismatch");

    let mut snapshot = valid_snapshot();
    snapshot.parcels[0].frontage_edge_ids = vec!["e1".into()];
    assert_issue(&snapshot, "frontage-invalid", Some("p0"));
    covered.insert("frontage-invalid");

    let mut snapshot = valid_snapshot();
    snapshot.parcels[0].access_edge_ids = vec!["ghost-access".into()];
    assert_issue(&snapshot, "access-invalid", Some("p0"));
    covered.insert("access-invalid");

    let mut snapshot = valid_snapshot();
    snapshot.edges[0].road_ref = None;
    assert_issue(&snapshot, "road-reference-missing", Some("e0"));
    covered.insert("road-reference-missing");

    let mut snapshot = valid_snapshot();
    snapshot.nodes.push(ParcelNode {
        id: "orphan".into(),
        point: point(100.0, 100.0),
    });
    assert_issue(&snapshot, "orphan-node", Some("orphan"));
    covered.insert("orphan-node");

    let mut snapshot = valid_snapshot();
    snapshot.easements.push(Easement {
        id: "ease-bad".into(),
        parcel_ids: vec!["ghost-parcel".into()],
        kind: EasementKind::Utility,
        geometry: vec![point(0.0, 0.0), point(1.0, 1.0)],
    });
    assert_issue(&snapshot, "easement-reference-invalid", Some("ease-bad"));
    covered.insert("easement-reference-invalid");

    let mut snapshot = valid_snapshot();
    snapshot.lineage = vec![
        lineage("cycle-a", &["p0"], &["p1"]),
        lineage("cycle-b", &["p1"], &["p0"]),
    ];
    assert_issue(&snapshot, "lineage-cycle", None);
    covered.insert("lineage-cycle");

    let expected = BTreeSet::from([
        "duplicate-id",
        "missing-node",
        "missing-edge",
        "missing-parcel",
        "missing-block",
        "zero-length-edge",
        "duplicate-shared-boundary",
        "parcel-boundary-invalid",
        "parcel-self-intersection",
        "parcel-area-mismatch",
        "parcel-overlap",
        "parcel-block-mismatch",
        "frontage-invalid",
        "access-invalid",
        "road-reference-missing",
        "orphan-node",
        "easement-reference-invalid",
        "lineage-cycle",
    ]);
    assert_eq!(covered, expected);
}
