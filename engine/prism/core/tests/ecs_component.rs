use prism_core::ecs::{
    ComponentLayout, ComponentRegistry, ComponentTemperature, ComponentTypeId, ComponentValue,
};

#[test]
fn component_value_requires_exact_registered_width() {
    let layout = ComponentLayout::new(ComponentTypeId::new(7), 4, 4, ComponentTemperature::Hot)
        .expect("valid layout");

    assert!(ComponentValue::new(layout.type_id(), vec![1, 2, 3], &layout).is_err());
    let value =
        ComponentValue::new(layout.type_id(), vec![1, 2, 3, 4], &layout).expect("matching payload");
    assert_eq!(value.bytes(), &[1, 2, 3, 4]);
}

#[test]
fn component_registry_is_idempotent_but_rejects_conflicts() {
    let mut registry = ComponentRegistry::new();
    let first = ComponentLayout::new(ComponentTypeId::new(9), 8, 8, ComponentTemperature::Medium)
        .expect("valid layout");
    let conflicting =
        ComponentLayout::new(ComponentTypeId::new(9), 4, 4, ComponentTemperature::Cold)
            .expect("valid layout");

    registry.register(first).expect("initial registration");
    registry
        .register(first)
        .expect("identical registration is idempotent");
    assert!(registry.register(conflicting).is_err());
    assert_eq!(registry.get(ComponentTypeId::new(9)), Some(&first));
}

#[test]
fn component_layout_rejects_invalid_storage_contracts() {
    assert!(
        ComponentLayout::new(ComponentTypeId::new(1), 0, 1, ComponentTemperature::Hot,).is_err()
    );
    assert!(
        ComponentLayout::new(ComponentTypeId::new(1), 4, 3, ComponentTemperature::Hot,).is_err()
    );
    assert!(
        ComponentLayout::new(ComponentTypeId::new(1), 4, 128, ComponentTemperature::Hot,).is_err()
    );
}
