use prism_core::ecs::{
    ComponentLayout, ComponentRegistry, ComponentTemperature, ComponentTypeId, ComponentValue,
    EcsWorld, StructuralCommandBuffer,
};
use prism_core::jobs::JobId;

fn layout(id: u64, size: usize) -> ComponentLayout {
    ComponentLayout::new(
        ComponentTypeId::new(id),
        size,
        size.next_power_of_two().min(64),
        ComponentTemperature::Hot,
    )
    .expect("layout")
}

fn registry() -> ComponentRegistry {
    let mut registry = ComponentRegistry::new();
    registry.register(layout(1, 4)).expect("component 1");
    registry.register(layout(2, 8)).expect("component 2");
    registry.register(layout(3, 2)).expect("component 3");
    registry
}

fn value(id: u64, bytes: &[u8]) -> ComponentValue {
    let registered = registry();
    let layout = registered.get(ComponentTypeId::new(id)).expect("layout");
    ComponentValue::new(ComponentTypeId::new(id), bytes.to_vec(), layout).expect("value")
}

fn spawn_buffer(job: u64, marker: u8) -> StructuralCommandBuffer {
    let mut buffer = StructuralCommandBuffer::new(JobId::new(job));
    buffer.spawn(vec![
        value(2, &[marker; 8]),
        value(1, &[marker, marker + 1, marker + 2, marker + 3]),
    ]);
    buffer
}

#[test]
fn reversed_buffer_completion_order_produces_identical_world_state() {
    let mut left = EcsWorld::new(registry());
    let mut right = EcsWorld::new(registry());

    left.commit_structural(vec![spawn_buffer(20, 20), spawn_buffer(10, 10)])
        .expect("left commit");
    right
        .commit_structural(vec![spawn_buffer(10, 10), spawn_buffer(20, 20)])
        .expect("right commit");

    assert_eq!(left.strict_state_hash(), right.strict_state_hash());
    assert_eq!(left.live_entities(), right.live_entities());
}

#[test]
fn add_and_remove_component_migration_preserves_retained_bytes() {
    let mut world = EcsWorld::new(registry());
    let report = world
        .commit_structural(vec![spawn_buffer(1, 4)])
        .expect("spawn");
    let entity = report.spawned_entities()[0];
    let before = world
        .component_bytes(entity, ComponentTypeId::new(1))
        .expect("component 1")
        .to_vec();

    let mut add = StructuralCommandBuffer::new(JobId::new(2));
    add.add_component(entity, value(3, &[8, 9]));
    world.commit_structural(vec![add]).expect("add component");
    assert_eq!(
        world
            .component_bytes(entity, ComponentTypeId::new(1))
            .expect("retained component"),
        before
    );
    assert_eq!(
        world
            .component_bytes(entity, ComponentTypeId::new(3))
            .expect("added component"),
        &[8, 9]
    );

    let mut remove = StructuralCommandBuffer::new(JobId::new(3));
    remove.remove_component(entity, ComponentTypeId::new(2));
    world
        .commit_structural(vec![remove])
        .expect("remove component");
    assert_eq!(
        world
            .component_bytes(entity, ComponentTypeId::new(1))
            .expect("retained after remove"),
        before
    );
    assert!(world
        .component_bytes(entity, ComponentTypeId::new(2))
        .is_err());
}

#[test]
fn swap_removal_repairs_moved_entity_location() {
    let mut world = EcsWorld::new(registry());
    let report = world
        .commit_structural(vec![spawn_buffer(1, 1), spawn_buffer(2, 2)])
        .expect("spawn");
    let first = report.spawned_entities()[0];
    let second = report.spawned_entities()[1];
    let second_before = world.location(second).expect("second location").clone();

    let mut despawn = StructuralCommandBuffer::new(JobId::new(3));
    despawn.despawn(first);
    world.commit_structural(vec![despawn]).expect("despawn");

    let second_after = world.location(second).expect("second location");
    assert_eq!(second_after.row_index(), 0);
    assert!(second_after.row_index() <= second_before.row_index());
    assert_eq!(
        world
            .component_bytes(second, ComponentTypeId::new(1))
            .expect("second still readable"),
        &[2, 3, 4, 5]
    );
}

#[test]
fn despawned_guid_becomes_stale_and_reused_slot_increments_generation() {
    let mut world = EcsWorld::new(registry());
    let report = world
        .commit_structural(vec![spawn_buffer(1, 5)])
        .expect("spawn");
    let old = report.spawned_entities()[0];

    let mut despawn = StructuralCommandBuffer::new(JobId::new(2));
    despawn.despawn(old);
    world.commit_structural(vec![despawn]).expect("despawn");
    assert!(!world.is_alive(old));
    assert!(world
        .component_bytes(old, ComponentTypeId::new(1))
        .is_err());

    let report = world
        .commit_structural(vec![spawn_buffer(3, 7)])
        .expect("respawn");
    let new = report.spawned_entities()[0];
    assert_eq!(new.index, old.index);
    assert_eq!(new.generation, old.generation + 1);
}

#[test]
fn structural_epoch_advances_once_per_successful_commit() {
    let mut world = EcsWorld::new(registry());
    assert_eq!(world.structural_epoch(), 0);
    world
        .commit_structural(vec![spawn_buffer(1, 1)])
        .expect("commit");
    assert_eq!(world.structural_epoch(), 1);
}
