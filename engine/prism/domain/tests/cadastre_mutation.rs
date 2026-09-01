use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, Easement, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind, ParcelLineageKind,
    ParcelNode, UrbanBlock, WorldPoint,
};
use prism_domain::canonical::hash::prism_cadastral_hash_v1;

#[test]
fn split_conserves_area_and_retires_source_with_lineage() {
    let mut graph = CadastralGraph::try_from_snapshot(graph_40x20_fixture()).unwrap();
    let result = graph.split_parcel(
        "p0",
        &[
            WorldPoint { x: 20.0, y: 0.0 },
            WorldPoint { x: 20.0, y: 20.0 },
        ],
    );

    assert!(result.committed, "{:?}", result.rejection_reasons);
    assert_eq!(
        result.resulting_parcel_ids,
        vec!["parcel:p0:split:1:0", "parcel:p0:split:1:1"]
    );
    assert_eq!(result.retired_parcel_ids, vec!["p0"]);
    assert!(graph.get_parcel("p0").is_none());
    let total_area: f64 = result
        .resulting_parcel_ids
        .iter()
        .map(|id| graph.get_parcel(id).unwrap().area_m2)
        .sum();
    assert!((total_area - 800.0).abs() <= 0.01);
    assert!(result.resulting_parcel_ids.iter().all(|id| {
        graph
            .get_parcel(id)
            .unwrap()
            .historical_parent_ids
            .contains(&"p0".to_owned())
    }));
    assert!(graph.list_lineage().iter().any(|event| {
        event.id == "lineage:1:split"
            && event.source_parcel_ids == vec!["p0"]
            && event.resulting_parcel_ids == result.resulting_parcel_ids
    }));
}

#[test]
fn invalid_split_is_atomic_and_preserves_hash() {
    let mut graph = CadastralGraph::try_from_snapshot(graph_40x20_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);
    let result = graph.split_parcel(
        "p0",
        &[
            WorldPoint { x: 0.0, y: 0.0 },
            WorldPoint { x: 0.01, y: 0.01 },
        ],
    );

    assert!(!result.committed);
    assert!(result.resulting_parcel_ids.is_empty());
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

#[test]
fn assembly_is_order_independent_removes_internal_boundary_and_records_lineage() {
    let mut graph = CadastralGraph::try_from_snapshot(two_adjacent_parcel_fixture()).unwrap();
    let result = graph.assemble_parcels(&["p1".to_owned(), "p0".to_owned()]);

    assert!(result.committed, "{:?}", result.rejection_reasons);
    assert_eq!(
        result.resulting_parcel_ids,
        vec!["parcel:assembly:1:p0+p1"]
    );
    assert_eq!(result.retired_parcel_ids, vec!["p0", "p1"]);
    assert_eq!(
        result.parcel_reference_rewrites.get("p0"),
        Some(&"parcel:assembly:1:p0+p1".to_owned())
    );
    assert_eq!(
        result.parcel_reference_rewrites.get("p1"),
        Some(&"parcel:assembly:1:p0+p1".to_owned())
    );

    let assembled = graph.get_parcel("parcel:assembly:1:p0+p1").unwrap();
    assert!((assembled.area_m2 - 800.0).abs() <= 0.01);
    assert_eq!(assembled.historical_parent_ids, vec!["p0", "p1"]);
    assert!(graph.get_parcel("p0").is_none());
    assert!(graph.get_parcel("p1").is_none());
    assert!(graph.get_edge("shared").is_none());
    assert!(graph.adjacent_parcel_ids(&assembled.id).unwrap().is_empty());
    assert!(graph.list_lineage().iter().any(|event| {
        event.id == "lineage:1:assembly"
            && event.kind == ParcelLineageKind::Assembly
            && event.source_parcel_ids == vec!["p0", "p1"]
            && event.resulting_parcel_ids == vec!["parcel:assembly:1:p0+p1"]
    }));
}

#[test]
fn assembly_rejects_non_adjacent_selection_atomically() {
    let mut graph = CadastralGraph::try_from_snapshot(non_adjacent_same_block_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);

    let result = graph.assemble_parcels(&["p0".to_owned(), "p2".to_owned()]);

    assert!(!result.committed);
    assert!(result
        .rejection_reasons
        .iter()
        .any(|reason| reason == "assembly-parcels-not-adjacent"));
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

#[test]
fn assembly_rejects_mixed_block_zoning_owner_and_easement_without_mutation() {
    let cases = [
        (assembly_mixed_block_fixture(), "assembly-requires-one-block"),
        (
            assembly_mixed_zoning_fixture(),
            "assembly-requires-one-zoning-district",
        ),
        (
            assembly_mixed_owner_fixture(),
            "assembly-requires-common-owner",
        ),
        (assembly_with_easement_fixture(), "parcel-has-easement"),
    ];

    for (snapshot, expected_reason) in cases {
        let mut graph = CadastralGraph::try_from_snapshot(snapshot).unwrap();
        let before = graph.snapshot();
        let before_hash = prism_cadastral_hash_v1(&graph);
        let result = graph.assemble_parcels(&["p1".to_owned(), "p0".to_owned()]);
        assert!(!result.committed, "expected rejection {expected_reason}");
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
}

#[test]
fn easement_create_and_remove_are_deterministic_and_preserve_parcel() {
    let mut graph = CadastralGraph::try_from_snapshot(graph_40x20_fixture()).unwrap();
    let created = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(8.0, 0.0), p(8.0, 20.0)],
    );

    assert!(created.committed, "{:?}", created.rejection_reasons);
    assert!(created.resulting_parcel_ids.is_empty());
    assert!(created.retired_parcel_ids.is_empty());
    assert_eq!(graph.get_parcel("p0").unwrap().area_m2, 800.0);
    let easements = graph.list_easements();
    assert_eq!(easements.len(), 1);
    assert_eq!(easements[0].id, "easement:utility:p0");
    assert_eq!(easements[0].kind, EasementKind::Utility);
    assert_eq!(easements[0].parcel_ids, vec!["p0"]);
    assert_eq!(easements[0].geometry, vec![p(8.0, 0.0), p(8.0, 20.0)]);

    let removed = graph.remove_easement("easement:utility:p0");
    assert!(removed.committed, "{:?}", removed.rejection_reasons);
    assert!(graph.list_easements().is_empty());

    let recreated = graph.create_easement(
        &["p0".to_owned()],
        EasementKind::Utility,
        &[p(8.0, 0.0), p(8.0, 20.0)],
    );
    assert!(recreated.committed, "{:?}", recreated.rejection_reasons);
    assert_eq!(graph.list_easements()[0].id, "easement:utility:p0");
}

#[test]
fn easement_rejections_are_atomic_and_hash_preserving() {
    let cases: Vec<(Vec<String>, EasementKind, Vec<WorldPoint>, &str)> = vec![
        (
            vec![],
            EasementKind::Utility,
            vec![p(8.0, 0.0), p(8.0, 20.0)],
            "easement-requires-parcel",
        ),
        (
            vec!["p0".to_owned()],
            EasementKind::Utility,
            vec![p(8.0, 0.0)],
            "easement-requires-two-points",
        ),
        (
            vec!["p0".to_owned()],
            EasementKind::Utility,
            vec![p(8.0, 8.0), p(8.0, 8.0)],
            "easement-geometry-collapses",
        ),
        (
            vec!["missing".to_owned()],
            EasementKind::Utility,
            vec![p(8.0, 0.0), p(8.0, 20.0)],
            "easement-references-unknown-parcel",
        ),
        (
            vec!["p0".to_owned()],
            EasementKind::Utility,
            vec![p(50.0, 0.0), p(50.0, 20.0)],
            "easement-outside-parcel",
        ),
    ];

    for (parcel_ids, kind, geometry, expected_reason) in cases {
        let mut graph = CadastralGraph::try_from_snapshot(graph_40x20_fixture()).unwrap();
        let before = graph.snapshot();
        let before_hash = prism_cadastral_hash_v1(&graph);
        let result = graph.create_easement(&parcel_ids, kind, &geometry);
        assert!(!result.committed, "expected rejection {expected_reason}");
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
}

#[test]
fn unknown_easement_removal_is_atomic() {
    let mut graph = CadastralGraph::try_from_snapshot(graph_40x20_fixture()).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);

    let result = graph.remove_easement("easement:missing");

    assert!(!result.committed);
    assert_eq!(result.rejection_reasons, vec!["unknown-easement:easement:missing"]);
    assert_eq!(graph.snapshot(), before);
    assert_eq!(prism_cadastral_hash_v1(&graph), before_hash);
}

fn graph_40x20_fixture() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            node("n0", 0.0, 0.0),
            node("n1", 40.0, 0.0),
            node("n2", 40.0, 20.0),
            node("n3", 0.0, 20.0),
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
            edge("e1", "n1", "n2"),
            edge("e2", "n2", "n3"),
            edge("e3", "n3", "n0"),
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

fn two_adjacent_parcel_fixture() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            node("n0", 0.0, 0.0),
            node("n1", 20.0, 0.0),
            node("n2", 40.0, 0.0),
            node("n3", 40.0, 20.0),
            node("n4", 20.0, 20.0),
            node("n5", 0.0, 20.0),
        ],
        edges: vec![
            parcel_edge(
                "a0",
                "n0",
                "n1",
                Some("p0"),
                None,
                ParcelEdgeKind::StreetFrontage,
                Some("south"),
            ),
            parcel_edge(
                "shared",
                "n1",
                "n4",
                Some("p0"),
                Some("p1"),
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            parcel_edge(
                "a2",
                "n4",
                "n5",
                Some("p0"),
                None,
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            parcel_edge(
                "a3",
                "n5",
                "n0",
                Some("p0"),
                None,
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            parcel_edge(
                "b0",
                "n1",
                "n2",
                Some("p1"),
                None,
                ParcelEdgeKind::StreetFrontage,
                Some("south"),
            ),
            parcel_edge(
                "b1",
                "n2",
                "n3",
                Some("p1"),
                None,
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            parcel_edge(
                "b2",
                "n3",
                "n4",
                Some("p1"),
                None,
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![p(0.0, 0.0), p(40.0, 0.0), p(40.0, 20.0), p(0.0, 20.0)],
            parcel_ids: vec!["p0".into(), "p1".into()],
            road_edge_ids: vec!["a0".into(), "b0".into()],
        }],
        parcels: vec![
            Parcel {
                id: "p0".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["a0".into(), "shared".into(), "a2".into(), "a3".into()],
                area_m2: 400.0,
                centroid: p(10.0, 10.0),
                frontage_edge_ids: vec!["a0".into()],
                access_edge_ids: vec!["a0".into()],
                zoning_district_id: "R2".into(),
                owner_id: Some("owner:a".into()),
                historical_parent_ids: vec![],
            },
            Parcel {
                id: "p1".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["b0".into(), "b1".into(), "b2".into(), "shared".into()],
                area_m2: 400.0,
                centroid: p(30.0, 10.0),
                frontage_edge_ids: vec!["b0".into()],
                access_edge_ids: vec!["b0".into()],
                zoning_district_id: "R2".into(),
                owner_id: Some("owner:a".into()),
                historical_parent_ids: vec![],
            },
        ],
        easements: vec![],
        lineage: vec![],
    }
}

fn non_adjacent_same_block_fixture() -> CadastralSnapshot {
    CadastralSnapshot {
        nodes: vec![
            node("n0", 0.0, 0.0),
            node("n1", 20.0, 0.0),
            node("n2", 20.0, 20.0),
            node("n3", 0.0, 20.0),
            node("n4", 40.0, 0.0),
            node("n5", 60.0, 0.0),
            node("n6", 60.0, 20.0),
            node("n7", 40.0, 20.0),
        ],
        edges: vec![
            parcel_edge("a0", "n0", "n1", Some("p0"), None, ParcelEdgeKind::StreetFrontage, Some("south")),
            parcel_edge("a1", "n1", "n2", Some("p0"), None, ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("a2", "n2", "n3", Some("p0"), None, ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("a3", "n3", "n0", Some("p0"), None, ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("c0", "n4", "n5", Some("p2"), None, ParcelEdgeKind::StreetFrontage, Some("south-2")),
            parcel_edge("c1", "n5", "n6", Some("p2"), None, ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("c2", "n6", "n7", Some("p2"), None, ParcelEdgeKind::PropertyBoundary, None),
            parcel_edge("c3", "n7", "n4", Some("p2"), None, ParcelEdgeKind::PropertyBoundary, None),
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![p(0.0, 0.0), p(60.0, 0.0), p(60.0, 20.0), p(0.0, 20.0)],
            parcel_ids: vec!["p0".into(), "p2".into()],
            road_edge_ids: vec!["a0".into(), "c0".into()],
        }],
        parcels: vec![
            Parcel {
                id: "p0".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["a0".into(), "a1".into(), "a2".into(), "a3".into()],
                area_m2: 400.0,
                centroid: p(10.0, 10.0),
                frontage_edge_ids: vec!["a0".into()],
                access_edge_ids: vec!["a0".into()],
                zoning_district_id: "R2".into(),
                owner_id: Some("owner:a".into()),
                historical_parent_ids: vec![],
            },
            Parcel {
                id: "p2".into(),
                block_id: "block".into(),
                boundary_edge_ids: vec!["c0".into(), "c1".into(), "c2".into(), "c3".into()],
                area_m2: 400.0,
                centroid: p(50.0, 10.0),
                frontage_edge_ids: vec!["c0".into()],
                access_edge_ids: vec!["c0".into()],
                zoning_district_id: "R2".into(),
                owner_id: Some("owner:a".into()),
                historical_parent_ids: vec![],
            },
        ],
        easements: vec![],
        lineage: vec![],
    }
}

fn assembly_mixed_block_fixture() -> CadastralSnapshot {
    let mut snapshot = two_adjacent_parcel_fixture();
    snapshot.parcels[1].block_id = "block-2".into();
    snapshot.blocks[0].parcel_ids = vec!["p0".into()];
    snapshot.blocks[0].road_edge_ids = vec!["a0".into()];
    snapshot.blocks.push(UrbanBlock {
        id: "block-2".into(),
        boundary: vec![p(20.0, 0.0), p(40.0, 0.0), p(40.0, 20.0), p(20.0, 20.0)],
        parcel_ids: vec!["p1".into()],
        road_edge_ids: vec!["b0".into()],
    });
    snapshot
}

fn assembly_mixed_zoning_fixture() -> CadastralSnapshot {
    let mut snapshot = two_adjacent_parcel_fixture();
    snapshot.parcels[1].zoning_district_id = "C1".into();
    snapshot
}

fn assembly_mixed_owner_fixture() -> CadastralSnapshot {
    let mut snapshot = two_adjacent_parcel_fixture();
    snapshot.parcels[1].owner_id = Some("owner:b".into());
    snapshot
}

fn assembly_with_easement_fixture() -> CadastralSnapshot {
    let mut snapshot = two_adjacent_parcel_fixture();
    snapshot.easements.push(Easement {
        id: "existing-easement".into(),
        parcel_ids: vec!["p0".into()],
        kind: EasementKind::Utility,
        geometry: vec![p(5.0, 0.0), p(5.0, 20.0)],
    });
    snapshot
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

fn edge(id: &str, from: &str, to: &str) -> ParcelEdge {
    parcel_edge(
        id,
        from,
        to,
        Some("p0"),
        None,
        ParcelEdgeKind::PropertyBoundary,
        None,
    )
}

fn parcel_edge(
    id: &str,
    from: &str,
    to: &str,
    left: Option<&str>,
    right: Option<&str>,
    kind: ParcelEdgeKind,
    road_ref: Option<&str>,
) -> ParcelEdge {
    ParcelEdge {
        id: id.into(),
        from_node_id: from.into(),
        to_node_id: to.into(),
        left_parcel_id: left.map(str::to_owned),
        right_parcel_id: right.map(str::to_owned),
        kind,
        road_ref: road_ref.map(str::to_owned),
    }
}
