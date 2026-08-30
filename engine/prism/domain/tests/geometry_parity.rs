use std::fs;
use std::path::PathBuf;

use prism_domain::cadastre::geometry::{
    normalize_point, normalize_ring, polygon_difference, polygon_intersection, polygon_union,
};
use prism_domain::cadastre::types::{PolygonRing, WorldPoint};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct GeometryFixture {
    normalization: Vec<NormalizationCase>,
    booleans: Vec<BooleanCase>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind")]
enum NormalizationCase {
    #[serde(rename = "point")]
    Point {
        name: String,
        input: WorldPoint,
        expected: WorldPoint,
    },
    #[serde(rename = "ring")]
    Ring {
        name: String,
        input: PolygonRing,
        expected: PolygonRing,
    },
}

#[derive(Debug, Deserialize)]
struct BooleanCase {
    name: String,
    operation: String,
    subject: PolygonRing,
    #[serde(default)]
    clip: Option<PolygonRing>,
    expected: Vec<PolygonRing>,
}

fn fixture() -> GeometryFixture {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tests/fixtures/prism-p2a/geometry-cases.json");
    let bytes = fs::read(path).expect("read committed P2A geometry fixture");
    serde_json::from_slice(&bytes).expect("decode committed P2A geometry fixture")
}

#[test]
fn native_geometry_matches_centimeter_normalization_fixture() {
    for case in fixture().normalization {
        match case {
            NormalizationCase::Point {
                name,
                input,
                expected,
            } => {
                let actual = normalize_point(input).expect("point normalization should succeed");
                assert_eq!(actual, expected, "{name}");
            }
            NormalizationCase::Ring {
                name,
                input,
                expected,
            } => {
                let actual = normalize_ring(&input).expect("ring normalization should succeed");
                assert_eq!(actual, expected, "{name}");
            }
        }
    }
}

#[test]
fn native_geometry_matches_typescript_boolean_fixture() {
    for case in fixture().booleans {
        let actual = match case.operation.as_str() {
            "intersection" => polygon_intersection(
                &case.subject,
                case.clip.as_deref().expect("intersection clip geometry"),
            ),
            "difference" => polygon_difference(
                &case.subject,
                case.clip.as_deref().expect("difference clip geometry"),
            ),
            "union" => {
                let mut polygons = vec![case.subject.clone()];
                if let Some(clip) = case.clip {
                    polygons.push(clip);
                }
                polygon_union(&polygons)
            }
            operation => panic!("unknown fixture operation {operation}"),
        }
        .expect("fixture geometry operation should succeed");

        assert_eq!(actual, case.expected, "{}", case.name);
    }
}
