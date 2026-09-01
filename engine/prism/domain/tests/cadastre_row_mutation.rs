use prism_domain::cadastre::graph::CadastralGraph;
use prism_domain::cadastre::types::{
    CadastralSnapshot, Easement, EasementKind, Parcel, ParcelEdge, ParcelEdgeKind,
    ParcelLineageKind, ParcelNode, UrbanBlock, WorldPoint,
};
use prism_domain::canonical::hash::prism_cadastral_hash_v1;

#[test]
fn right_of_way_creates_one_residual_with_lineage_and_access() {
    let mut graph = CadastralGraph::try_from_snapshot(single_parcel_fixture()).unwrap();
    let result = graph.dedicate_right_of_way(
        "p0",
        &[p(0.0, 0.0), p(5.0, 0.0), p(5.0, 20.0), p(0.0, 20.0)],
    );

    assert!(result.committed, "{:?}", result.rejection_reasons);
    assert_eq!(result.resulting_parcel_ids, vec!["parcel:p0:row:1"]);
    assert_eq!(result.retired_parcel_ids, vec!["p0"]);
    assert_eq!(
        result
            .parcel_reference_rewrites
            .get("p0")
            .map(String::as_str),
        Some("parcel:p0:row:1")
    );
    assert!(graph.get_parcel("p0").is_none());
    let residual = graph.get_parcel("parcel:p0:row:1").unwrap();
    assert!((residual.area_m2 - 700.0).abs() <= 0.01);
    assert_eq!(residual.historical_parent_ids, vec!["p0"]);
    assert!(residual.boundary_edge_ids.iter().any(|edge_id| {
        graph
            .get_edge(edge_id)
            .is_some_and(|edge| edge.kind == ParcelEdgeKind::RightOfWay)
    }));
    assert!(residual.access_edge_ids.iter().any(|edge_id| {
        graph
            .get_edge(edge_id)
            .is_some_and(|edge| edge.kind == ParcelEdgeKind::RightOfWay)
    }));
    assert!(graph.list_lineage().iter().any(|event| {
        event.id == "lineage:1:right-of-way"
            && event.kind == ParcelLineageKind::RightOfWay
            && event.source_parcel_ids == vec!["p0"]
            && event.resulting_parcel_ids == vec!["parcel:p0:row:1"]
    }));
}

#[test]
fn right_of_way_rejections_are_atomic_and_hash_preserving() {
    assert_atomic_rejection(
        single_parcel_fixture(),
        &[p(0.0, 0.0), p(0.5, 0.0), p(0.5, 0.5), p(0.0, 0.5)],
        "right-of-way-too-small",
    );
    assert_atomic_rejection(
        single_parcel_fixture(),
        &[p(-5.0, 0.0), p(5.0, 0.0), p(5.0, 20.0), p(-5.0, 20.0)],
        "right-of-way-outside-parcel",
    );
    assert_atomic_rejection(
        single_parcel_fixture(),
        &[p(0.0, 0.0), p(40.0, 0.0), p(40.0, 20.0), p(0.0, 20.0)],
        "right-of-way-must-leave-one-residual-parcel",
    );
    assert_atomic_rejection(
        single_parcel_fixture(),
        &[p(0.0, 0.0), p(39.99, 0.0), p(39.99, 20.0), p(0.0, 20.0)],
        "right-of-way-consumes-parcel",
    );
    assert_atomic_rejection(
        single_parcel_fixture(),
        &[p(19.0, 0.0), p(21.0, 0.0), p(21.0, 20.0), p(19.0, 20.0)],
        "right-of-way-must-leave-one-residual-parcel",
    );
    assert_atomic_rejection(
        parcel_with_easement_fixture(),
        &[p(0.0, 0.0), p(5.0, 0.0), p(5.0, 20.0), p(0.0, 20.0)],
        "parcel-has-easement",
    );
    assert_atomic_rejection(
        generated_id_collision_fixture(),
        &[p(0.0, 0.0), p(5.0, 0.0), p(5.0, 20.0), p(0.0, 20.0)],
        "generated-parcel-id-collision",
    );
}

fn assert_atomic_rejection(
    snapshot: CadastralSnapshot,
    geometry: &[WorldPoint],
    expected_reason: &str,
) {
    let mut graph = CadastralGraph::try_from_snapshot(snapshot).unwrap();
    let before = graph.snapshot();
    let before_hash = prism_cadastral_hash_v1(&graph);
    let result = graph.dedicate_right_of_way("p0", geometry);

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
            edge(
                "e0",
                "n0",
                "n1",
                "p0",
                ParcelEdgeKind::StreetFrontage,
                Some("south"),
            ),
            edge(
                "e1",
                "n1",
                "n2",
                "p0",
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            edge(
                "e2",
                "n2",
                "n3",
                "p0",
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
            edge(
                "e3",
                "n3",
                "n0",
                "p0",
                ParcelEdgeKind::PropertyBoundary,
                None,
            ),
        ],
        blocks: vec![UrbanBlock {
            id: "block".into(),
            boundary: vec![p(0.0, 0.0), p(40.0, 0.0), p(40.0, 20.0), p(0.0, 20.0)],
            parcel_ids: vec!["p0".into()],
            road_edge_ids: vec!["e0".into()],
        }],
        parcels: vec![parcel(
            "p0",
            &["e0", "e1", "e2", "e3"],
            800.0,
            p(20.0, 10.0),
            "e0",
        )],
        easements: vec![],
        lineage: vec![],
    }
}

fn parcel_with_easement_fixture() -> CadastralSnapshot {
    let mut snapshot = single_parcel_fixture();
    snapshot.easements.push(Easement {
        id: "easement:utility:p0".into(),
        parcel_ids: vec!["p0".into()],
        kind: EasementKind::Utility,
        geometry: vec![p(5.0, 5.0), p(35.0, 5.0)],
    });
    snapshot
}

fn generated_id_collision_fixture() -> CadastralSnapshot {
    let mut snapshot = single_parcel_fixture();
    snapshot.nodes.extend([
        node("c0", 50.0, 0.0),
        node("c1", 60.0, 0.0),
        node("c2", 60.0, 10.0),
        node("c3", 50.0, 10.0),
    ]);
    snapshot.edges.extend([
        edge(
            "c-e0",
            "c0",
            "c1",
            "parcel:p0:row:1",
            ParcelEdgeKind::StreetFrontage,
            Some("south-collision"),
        ),
        edge(
            "c-e1",
            "c1",
            "c2",
            "parcel:p0:row:1",
            ParcelEdgeKind::PropertyBoundary,
            None,
        ),
        edge(
            "c-e2",
            "c2",
            "c3",
            "parcel:p0:row:1",
            ParcelEdgeKind::PropertyBoundary,
            None,
        ),
        edge(
            "c-e3",
            "c3",
            "c0",
            "parcel:p0:row:1",
            ParcelEdgeKind::PropertyBoundary,
            None,
        ),
    ]);
    snapshot.blocks[0].boundary = vec![p(0.0, 0.0), p(60.0, 0.0), p(60.0, 20.0), p(0.0, 20.0)];
    snapshot.blocks[0].parcel_ids.push("parcel:p0:row:1".into());
    snapshot.blocks[0].road_edge_ids.push("c-e0".into());
    snapshot.parcels.push(parcel(
        "parcel:p0:row:1",
        &["c-e0", "c-e1", "c-e2", "c-e3"],
        100.0,
        p(55.0, 5.0),
        "c-e0",
    ));
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

fn edge(
    id: &str,
    from: &str,
    to: &str,
    parcel_id: &str,
    kind: ParcelEdgeKind,
    road_ref: Option<&str>,
) -> ParcelEdge {
    ParcelEdge {
        id: id.into(),
        from_node_id: from.into(),
        to_node_id: to.into(),
        left_parcel_id: Some(parcel_id.into()),
        right_parcel_id: None,
        kind,
        road_ref: road_ref.map(str::to_owned),
    }
}

fn parcel(
    id: &str,
    boundary_edge_ids: &[&str],
    area_m2: f64,
    centroid: WorldPoint,
    frontage_edge_id: &str,
) -> Parcel {
    Parcel {
        id: id.into(),
        block_id: "block".into(),
        boundary_edge_ids: boundary_edge_ids
            .iter()
            .map(|value| (*value).into())
            .collect(),
        area_m2,
        centroid,
        frontage_edge_ids: vec![frontage_edge_id.into()],
        access_edge_ids: vec![frontage_edge_id.into()],
        zoning_district_id: "R2".into(),
        owner_id: Some("owner:a".into()),
        historical_parent_ids: vec![],
    }
}
