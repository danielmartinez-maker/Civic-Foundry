use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind, ParcelNode, UrbanBlock,
    WorldPoint,
};
use prism_domain::canonical::hash::prism_cadastral_hash_v1;

#[test]
fn easement_create_and_remove_match_typescript_contract() {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let create = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(5.0, 5.0), p(35.0, 5.0)],
    );

    assert!(create.committed, "{:?}", create.rejection_reasons);
    assert!(create.resulting_parcel_ids.is_empty());
    assert!(create.retired_parcel_ids.is_empty());
    assert!(create.parcel_reference_rewrites.is_empty());
    let easement = graph.get_easement("easement:utility:p0").unwrap();
    assert_eq!(easement.parcel_ids, vec!["p0"]);
    assert_eq!(easement.kind, EasementKind::Utility);
    assert_eq!(easement.geometry, vec![p(5.0, 5.0), p(35.0, 5.0)]);

    let remove = graph.remove_easement("easement:utility:p0");
    assert!(remove.committed, "{:?}", remove.rejection_reasons);
    assert!(remove.resulting_parcel_ids.is_empty());
    assert!(remove.retired_parcel_ids.is_empty());
    assert!(remove.parcel_reference_rewrites.is_empty());
    assert!(graph.get_easement("easement:utility:p0").is_none());
}

#[test]
fn repeated_easement_ids_are_stably_suffixed() {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let first = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Access,
        &[p(5.0, 5.0), p(35.0, 5.0)],
    );
    let second = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Access,
        &[p(5.0, 10.0), p(35.0, 10.0)],
    );

    assert!(first.committed);
    assert!(second.committed);
    assert!(graph.get_easement("easement:access:p0").is_some());
    assert!(graph.get_easement("easement:access:p0:1").is_some());
}

#[test]
fn easement_create_rejections_are_atomic_and_hash_preserving() {
    assert_atomic_create_rejection(
        &[],
        EasementKind::Utility,
        &[p(5.0, 5.0), p(35.0, 5.0)],
        "easement-requires-parcel",
    );
    assert_atomic_create_rejection(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(5.0, 5.0)],
        "easement-requires-two-points",
    );
    assert_atomic_create_rejection(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(5.0, 5.0), p(5.0, 5.0)],
        "easement-geometry-collapses",
    );
    assert_atomic_create_rejection(
        &["missing".to_owned()],
        EasementKind::Utility,
        &[p(5.0, 5.0), p(35.0, 5.0)],
        "easement-references-unknown-parcel",
    );
    assert_atomic_create_rejection(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(5.0, 5.0), p(45.0, 5.0)],
        "easement-outside-parcel",
    );
}

#[test]
fn easement_sampling_rejects_segment_that_leaves_and_reenters_target() {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);
    let result = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Pedestrian,
        &[p(5.0, 5.0), p(45.0, 5.0), p(35.0, 5.0)],
    );

    assert!(!result.committed);
    assert!(result
        .rejection_reasons
        .iter()
        .any(|reason| reason == "easement-outside-parcel"));
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

#[test]
fn removing_unknown_easement_is_atomic() {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);
    let result = graph.remove_easement("missing");

    assert!(!result.committed);
    assert_eq!(result.rejection_reasons, vec!["unknown-easement:missing"]);
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

fn assert_atomic_create_rejection(
    parcel_ids: &[String],
    kind: EasementKind,
    geometry: &[WorldPoint],
    expected_reason: &str,
) {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);
    let result = graph.create_easement(parcel_ids, kind, geometry);

    assert!(!result.committed);
    assert!(
        result
            .rejection_reasons
            .iter()
            .any(|reason| reason == expected_reason),
        "{:?}",
        result.rejection_reasons
    );
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

fn single_parcel_fixture() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            node("n0", 0.0, 0.0),
            node("n1", 40.0, 0.0),
            node("n2", 40.0, 20.0),
            node("n3", 0.0, 20.0),
        ],
        edges: vec![
            parcel_edge(
                "e0",
                "n0",
                "n1",
                ParcelEdgeKind::StreetFrontage,
                Some("south"),
            ),
            parcel_edge("e1", "n1", "n2", ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("e2", "n2", "n3", ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("e3", "n3", "n0", ParcelEdgeKind::PropertyBoundary, None),
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![p(0.0, 0.0), p(40.0, 0.0), p(40.0, 20.0), p(0.0, 20.0)],
            parcel_ids: vec!["p0".into()],
            road_edge_ids: vec!["e0".into()],
        }],
        parcels: vec![Parcel {
            id: "p0".into(),
            block_id: "block".into(),
            boundary_edge_ids: vec!["e0".into(), "e1".into(), "e2".into(), "e3".into()],
            area_m2: 800.0,
            centroid: p(20.0, 10.0),
            frontage_edge_ids: vec!["e0".into()],
            access_edge_ids: vec!["e0".into()],
            zoning_district_id: "R2".into(),
            owner_id: Some("owner:a".into()),
            historical_parent_ids: vec![],
        }],
        easements: vec![],
        lineage: vec![],
    }
}

fn p(x: f64, y: f64) -> WorldPoint {
    WorldPoint { x, y }
}

fn node(id: &str, x: f64, y: f64) -> ParcelNode {
    ParcelNode {
        id: id.into(),
        point: p(x, y),
    }
}

fn parcel_edge(
    id: &str,
    from: &str,
    to: &str,
    kind: ParcelEdgeKind,
    road_ref: Option<&str>,
) -> ParcelEdge {
    ParcelEdge {
        id: id.into(),
        from_node_id: from.into(),
        to_node_id: to.into(),
        left_parcel_id: Some("p0".into()),
        right_parcel_id: None,
        kind,
        road_ref: road_ref.map(str::to_owned),
    }
}
