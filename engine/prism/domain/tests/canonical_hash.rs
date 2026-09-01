use prism_domain::canonical::hash::{prism_cadastral_hash_v1, prism_canonical_hash_v1};
use prism_domain::compat::envelope::import_envelope_json;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct HashFixture {
    vectors: Vec<HashVector>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HashVector {
    name: String,
    expected_hash: String,
    envelope: Value,
}

fn load_fixture() -> HashFixture {
    serde_json::from_str(include_str!(
        "../../../../tests/fixtures/prism-p2a/hash-vectors.json"
    ))
    .expect("P2A hash fixture should decode")
}

#[test]
fn rust_hash_matches_typescript_vectors() {
    for vector in load_fixture().vectors {
        let envelope =
            serde_json::to_vec(&vector.envelope).expect("fixture envelope should encode");
        let mirror = import_envelope_json(&envelope).expect("fixture envelope should import");

        assert_eq!(
            prism_canonical_hash_v1(&mirror),
            vector.expected_hash,
            "{}",
            vector.name
        );
    }
}

#[test]
fn cadastral_hash_has_fixed_lowercase_u64_form() {
    let vector = load_fixture()
        .vectors
        .into_iter()
        .next()
        .expect("at least one full hash vector");
    let envelope = serde_json::to_vec(&vector.envelope).expect("fixture envelope should encode");
    let mirror = import_envelope_json(&envelope).expect("fixture envelope should import");

    let hash = prism_cadastral_hash_v1(&mirror.cadastre);
    assert_eq!(hash.len(), 16);
    assert!(
        hash.bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    );
}
