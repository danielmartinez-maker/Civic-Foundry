use std::collections::BTreeMap;

use prism_core::ecs::{
    ArchetypeChunk, ArchetypeKey, ComponentLayout, ComponentTemperature, ComponentTypeId,
    ComponentValue, DEFAULT_CHUNK_TARGET_BYTES,
};
use prism_core::entity::EntityGuid;

fn layout(id: u64, size: usize) -> ComponentLayout {
    ComponentLayout::new(
        ComponentTypeId::new(id),
        size,
        size.next_power_of_two().min(64),
        ComponentTemperature::Hot,
    )
    .expect("valid layout")
}

fn row(values: &[(ComponentLayout, Vec<u8>)]) -> BTreeMap<ComponentTypeId, ComponentValue> {
    values
        .iter()
        .map(|(layout, bytes)| {
            (
                layout.type_id(),
                ComponentValue::new(layout.type_id(), bytes.clone(), layout).expect("valid value"),
            )
        })
        .collect()
}

#[test]
fn archetype_key_is_canonical_and_rejects_duplicates() {
    let a = ComponentTypeId::new(1);
    let b = ComponentTypeId::new(2);
    assert_eq!(
        ArchetypeKey::new(vec![b, a]).expect("key"),
        ArchetypeKey::new(vec![a, b]).expect("key")
    );
    assert!(ArchetypeKey::new(vec![a, a]).is_err());
}

#[test]
fn archetype_chunk_uses_cache_line_aligned_soa_columns() {
    let layouts = vec![layout(1, 8), layout(2, 16)];
    let chunk = ArchetypeChunk::new(&layouts).expect("chunk");

    assert_eq!(chunk.capacity_rows(), DEFAULT_CHUNK_TARGET_BYTES / 24);
    assert!(chunk.capacity_rows() > 0);
    for pointer in chunk.column_ptrs() {
        assert_eq!(pointer as usize % 64, 0);
    }
}

#[test]
fn row_round_trips_and_swap_remove_reports_moved_entity() {
    let first = layout(1, 4);
    let second = layout(2, 8);
    let layouts = vec![first, second];
    let mut chunk = ArchetypeChunk::new(&layouts).expect("chunk");

    let first_entity = EntityGuid::new(10, 0);
    let second_entity = EntityGuid::new(11, 0);
    chunk
        .push(
            first_entity,
            &row(&[(first, vec![1, 2, 3, 4]), (second, vec![9; 8])]),
        )
        .expect("first row");
    chunk
        .push(
            second_entity,
            &row(&[(first, vec![5, 6, 7, 8]), (second, vec![7; 8])]),
        )
        .expect("second row");

    assert_eq!(
        chunk
            .read_component(0, ComponentTypeId::new(1))
            .expect("component"),
        &[1, 2, 3, 4]
    );

    let removed = chunk.remove_swap(0).expect("remove");
    assert_eq!(removed.removed_entity(), first_entity);
    assert_eq!(removed.moved_entity(), Some(second_entity));
    assert_eq!(chunk.entity_at(0), Some(second_entity));
    assert_eq!(
        chunk
            .read_component(0, ComponentTypeId::new(1))
            .expect("moved component"),
        &[5, 6, 7, 8]
    );
}
