use prism_core::entity::{EntityGuid, EntityRegistry, EntityRegistryError};

#[test]
fn recycled_slot_increments_generation_and_rejects_stale_guid() {
    let mut registry = EntityRegistry::new();
    let first = registry.spawn().expect("first spawn");
    assert_eq!(first, EntityGuid::new(0, 0));

    registry.despawn(first).expect("despawn first");
    assert!(!registry.is_alive(first));

    let second = registry.spawn().expect("recycled spawn");
    assert_eq!(second, EntityGuid::new(0, 1));
    assert!(registry.is_alive(second));
    assert_eq!(
        registry.despawn(first),
        Err(EntityRegistryError::StaleGuid(first))
    );
}

#[test]
fn free_slots_are_reused_in_lowest_index_order() {
    let mut registry = EntityRegistry::new();
    let a = registry.spawn().unwrap();
    let b = registry.spawn().unwrap();
    let c = registry.spawn().unwrap();

    registry.despawn(c).unwrap();
    registry.despawn(a).unwrap();

    assert_eq!(registry.spawn().unwrap(), EntityGuid::new(a.index, 1));
    assert_eq!(registry.spawn().unwrap(), EntityGuid::new(c.index, 1));
    assert!(registry.is_alive(b));
}

#[test]
fn identical_operation_sequences_produce_identical_guids() {
    fn sequence() -> Vec<EntityGuid> {
        let mut registry = EntityRegistry::new();
        let mut created = Vec::new();
        for _ in 0..8 {
            created.push(registry.spawn().unwrap());
        }
        for guid in [created[6], created[2], created[4]] {
            registry.despawn(guid).unwrap();
        }
        created.extend((0..3).map(|_| registry.spawn().unwrap()));
        created
    }

    assert_eq!(sequence(), sequence());
}
