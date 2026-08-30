use prism_core::ecs::{
    ComponentLayout, ComponentRegistry, ComponentTemperature, ComponentTypeId, ComponentValue,
    EcsWorld, StructuralCommandBuffer,
};
use prism_core::jobs::{JobId, WorkerPool, WorkerTask, WorkerTaskKey};

fn registry() -> ComponentRegistry {
    let mut registry = ComponentRegistry::new();
    registry
        .register(
            ComponentLayout::new(
                ComponentTypeId::new(1),
                8,
                8,
                ComponentTemperature::Hot,
            )
            .expect("layout 1"),
        )
        .expect("register 1");
    registry
        .register(
            ComponentLayout::new(
                ComponentTypeId::new(2),
                4,
                4,
                ComponentTemperature::Medium,
            )
            .expect("layout 2"),
        )
        .expect("register 2");
    registry
}

fn value(registry: &ComponentRegistry, id: u64, bytes: Vec<u8>) -> ComponentValue {
    let type_id = ComponentTypeId::new(id);
    ComponentValue::new(type_id, bytes, registry.get(type_id).expect("layout")).expect("value")
}

fn spawn_buffers(registry: &ComponentRegistry) -> Vec<StructuralCommandBuffer> {
    (0_u64..4)
        .map(|job| {
            let mut buffer = StructuralCommandBuffer::new(JobId::new(job + 1));
            for local in 0_u64..2500 {
                let marker = (job * 2500 + local).to_le_bytes();
                buffer.spawn(vec![value(registry, 1, marker.to_vec())]);
            }
            buffer
        })
        .collect()
}

#[test]
fn ten_thousand_structural_operations_are_order_independent() {
    let registry = registry();
    let mut forward = EcsWorld::new(registry.clone());
    let mut reverse = EcsWorld::new(registry.clone());

    forward
        .commit_structural(spawn_buffers(&registry))
        .expect("forward spawn");
    let mut reversed = spawn_buffers(&registry);
    reversed.reverse();
    reverse
        .commit_structural(reversed)
        .expect("reverse spawn");

    assert_eq!(forward.live_entities().len(), 10_000);
    assert_eq!(forward.live_entities(), reverse.live_entities());
    assert_eq!(forward.strict_state_hash(), reverse.strict_state_hash());

    let entities = forward.live_entities()[..1000].to_vec();
    let mut forward_migrate = StructuralCommandBuffer::new(JobId::new(50));
    let mut reverse_migrate = StructuralCommandBuffer::new(JobId::new(50));
    for (index, entity) in entities.iter().copied().enumerate() {
        let bytes = (index as u32).to_le_bytes().to_vec();
        forward_migrate.add_component(entity, value(&registry, 2, bytes.clone()));
        reverse_migrate.add_component(entity, value(&registry, 2, bytes));
    }
    forward
        .commit_structural(vec![forward_migrate])
        .expect("forward add");
    reverse
        .commit_structural(vec![reverse_migrate])
        .expect("reverse add");

    let mut forward_remove = StructuralCommandBuffer::new(JobId::new(51));
    let mut reverse_remove = StructuralCommandBuffer::new(JobId::new(51));
    for entity in entities {
        forward_remove.remove_component(entity, ComponentTypeId::new(2));
        reverse_remove.remove_component(entity, ComponentTypeId::new(2));
    }
    forward
        .commit_structural(vec![forward_remove])
        .expect("forward remove");
    reverse
        .commit_structural(vec![reverse_remove])
        .expect("reverse remove");

    assert_eq!(forward.strict_state_hash(), reverse.strict_state_hash());
}

#[test]
fn four_worker_batches_are_deterministically_ordered_at_scale() {
    let pool = WorkerPool::new(4).expect("pool");
    let tasks = (0_u64..2048)
        .rev()
        .map(|key| WorkerTask::new(WorkerTaskKey::new(key), move || key.wrapping_mul(17)))
        .collect();
    let results = pool.execute_batch(tasks).expect("batch");

    assert_eq!(results.len(), 2048);
    for (index, result) in results.iter().enumerate() {
        assert_eq!(result.key(), WorkerTaskKey::new(index as u64));
        assert_eq!(*result.value(), (index as u64).wrapping_mul(17));
    }
}
