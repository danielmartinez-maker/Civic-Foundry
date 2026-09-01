use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, Easement, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind,
    ParcelLineageKind, ParcelNode, UrbanBlock, WorldPoint,
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
fn assembly_reversed_order_is_canonical_and_removes_internal_boundary() {
    let mut graph = CadastralGraph::try_from_snapshot(two_adjacent_parcel_fixture()).unwrap();
    let result = graph.assemble_parcels(&["p1".to_owned(), "p0".to_owned()]);

    assert!(result.committed, "{:?}", result.rejection_reasons);
    assert_eq!(
        result.resulting_parcel_ids,
        vec!["parcel:assembly:1:p0+p1"]
    );
    assert_eq!(result.retired_parcel_ids, vec!["p0", "p1"]);
    assert_eq!(
        result.parcel_reference_rewrites.get("p0").map(String::as_str),
        Some("parcel:assembly:1:p0+p1")
    );
    assert_eq!(
        result.parcel_reference_rewrites.get("p1").map(String::as_str),
        Some("parcel:assembly:1:p0+p1")
    );
    assert!(graph.get_parcel("p0").is_none());
    assert!(graph.get_parcel("p1").is_none());
    assert!(graph.get_edge("shared").is_none());

    let assembled = graph.get_parcel("parcel:assembly:1:p0+p1").unwrap();
    assert!((assembled.area_m2 - 800.0).abs() <= 0.01);
    assert_eq!(assembled.historical_parent_ids, vec!["p0", "p1"]);
    assert!(graph.adjacent_parcel_ids(&assembled.id).is_empty());
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
    assert_atomic_assembly_rejection(
        &mut graph,
        &["p0".to_owned(), "p2".to_owned()],
        "assembly-parcels-not-adjacent",
    );
}

#[test]
fn assembly_rejects_mixed_blocks_atomically() {
    let mut graph = CadastralGraph::try_from_snapshot(assembly_mixed_block_fixture()).unwrap();
    assert_atomic_assembly_rejection(
        &mut graph,
        &["p1".to_owned(), "p0".to_owned()],
        "assembly-requires-one-block",
    );
}

#[test]
fn assembly_rejects_mixed_zoning_atomically() {
    let mut graph = CadastralGraph::try_from_snapshot(assembly_mixed_zoning_fixture()).unwrap();
    assert_atomic_assembly_rejection(
        &mut graph,
        &["p1".to_owned(), "p0".to_owned()],
        "assembly-requires-one-zoning-district",
    );
}

#[test]
fn assembly_rejects_mixed_owners_atomically() {
    let mut graph = CadastralGraph::try_from_snapshot(assembly_mixed_owner_fixture()).unwrap();
    assert_atomic_assembly_rejection(
        &mut graph,
        &["p1".to_owned(), "p0".to_owned()],
        "assembly-requires-common-owner",
    );
}

#[test]
fn assembly_rejects_parcel_with_easement_atomically() {
    let mut graph = CadastralGraph::try_from_snapshot(assembly_with_easement_fixture()).unwrap();
    assert_atomic_assembly_rejection(
        &mut graph,
        &["p1".to_owned(), "p0".to_owned()],
        "parcel-has-easement",
    );
}

fn assert_atomic_assembly_rejection(
    graph: &mut CadastralGraph,
    parcel_ids: &[String],
    expected_reason: &str,
) {
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(graph);
    let result = graph.assemble_parcels(parcel_ids);

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
    assert_eq!(prism_cadastral_hash_v1(graph), before_hash);
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
            parcel(
                "p0",
                "block",
                &["a0", "shared", "a2", "a3"],
                400.0,
                10.0,
                "R2",
                Some("owner:a"),
                "a0",
            ),
            parcel(
                "p1",
                "block",
                &["b0", "b1", "b2", "shared"],
                400.0,
                30.0,
                "R2",
                Some("owner:a"),
                "b0",
            ),
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
            parcel_edge(
                "a0",
                "n0",
                "n1",
                Some("p0"),
                None,
                ParcelEdgeKind::StreetFrontage,
                Some("south"),
            ),
            property_edge("a1", "n1", "n2", "p0"),
            property_edge("a2", "n2", "n3", "p0"),
            property_edge("a3", "n3", "n0", "p0"),
            parcel_edge(
                "c0",
                "n4",
                "n5",
                Some("p2"),
                None,
                ParcelEdgeKind::StreetFrontage,
                Some("south-2"),
            ),
            property_edge("c1", "n5", "n6", "p2"),
            property_edge("c2", "n6", "n7", "p2"),
            property_edge("c3", "n7", "n4", "p2"),
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![p(0.0, 0.0), p(60.0, 0.0), p(60.0, 20.0), p(0.0, 20.0)],
            parcel_ids: vec!["p0".into(), "p2".into()],
            road_edge_ids: vec!["a0".into(), "c0".into()],
        }],
        parcels: vec![
            parcel(
                "p0",
                "block",
                &["a0", "a1", "a2", "a3"],
                400.0,
                10.0,
                "R2",
                Some("owner:a"),
                "a0",
            ),
            parcel(
                "p2",
                "block",
                &["c0", "c1", "c2", "c3"],
                400.0,
                50.0,
                "R2",
                Some("owner:a"),
                "c0",
            ),
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
    property_edge(id, from, to, "p0")
}

fn property_edge(id: &str, from: &str, to: &str, parcel_id: &str) -> ParcelEdge {
    parcel_edge(
        id,
        from,
        to,
        Some(parcel_id),
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

#[allow(clippy::too_many_arguments)]
fn parcel(
    id: &str,
    block_id: &str,
    boundary_edge_ids: &[&str],
    area_m2: f64,
    centroid_x: f64,
    zoning_district_id: &str,
    owner_id: Option<&str>,
    frontage_edge_id: &str,
) -> Parcel {
    Parcel {
        id: id.into(),
        block_id: block_id.into(),
        boundary_edge_ids: boundary_edge_ids
            .iter()
            .map(|value| (*value).to_owned())
            .collect(),
        area_m2,
        centroid: p(centroid_x, 10.0),
        frontage_edge_ids: vec![frontage_edge_id.to_owned()],
        access_edge_ids: vec![frontage_edge_id.to_owned()],
        zoning_district_id: zoning_district_id.into(),
        owner_id: owner_id.map(str::to_owned),
        historical_parent_ids: vec![],
    }
}
