use std::collections::{BTreeMap, BTreeSet};

use crate::entity::{EntityGuid, EntityRegistry, EntityRegistryError};

use super::archetype::{Archetype, ArchetypeError, ArchetypeKey};
use super::commands::{KeyedStructuralCommand, StructuralCommand, StructuralCommandBuffer};
use super::component::{
    ComponentError, ComponentLayout, ComponentRegistry, ComponentTypeId, ComponentValue,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EcsWorldError {
    Component(ComponentError),
    Archetype(ArchetypeError),
    EntityRegistry(EntityRegistryError),
    UnknownComponent(ComponentTypeId),
    StaleEntity(EntityGuid),
    DuplicateSpawnComponent(ComponentTypeId),
    ComponentAlreadyPresent {
        entity: EntityGuid,
        component_type: ComponentTypeId,
    },
    ComponentMissing {
        entity: EntityGuid,
        component_type: ComponentTypeId,
    },
    CannotRemoveLastComponent(EntityGuid),
    DuplicateStructuralCommandKey,
    StructuralEpochOverflow,
}

impl From<ComponentError> for EcsWorldError {
    fn from(value: ComponentError) -> Self {
        Self::Component(value)
    }
}

impl From<ArchetypeError> for EcsWorldError {
    fn from(value: ArchetypeError) -> Self {
        Self::Archetype(value)
    }
}

impl From<EntityRegistryError> for EcsWorldError {
    fn from(value: EntityRegistryError) -> Self {
        Self::EntityRegistry(value)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityLocation {
    archetype: ArchetypeKey,
    chunk_index: usize,
    row_index: usize,
}

impl EntityLocation {
    #[must_use]
    pub fn archetype(&self) -> &ArchetypeKey {
        &self.archetype
    }

    #[must_use]
    pub const fn chunk_index(&self) -> usize {
        self.chunk_index
    }

    #[must_use]
    pub const fn row_index(&self) -> usize {
        self.row_index
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StructuralCommitReport {
    spawned_entities: Vec<EntityGuid>,
    command_count: usize,
    structural_epoch: u64,
}

impl StructuralCommitReport {
    #[must_use]
    pub fn spawned_entities(&self) -> &[EntityGuid] {
        &self.spawned_entities
    }

    #[must_use]
    pub const fn command_count(&self) -> usize {
        self.command_count
    }

    #[must_use]
    pub const fn structural_epoch(&self) -> u64 {
        self.structural_epoch
    }
}

#[derive(Clone)]
pub struct EcsWorld {
    entity_registry: EntityRegistry,
    component_registry: ComponentRegistry,
    archetypes: BTreeMap<ArchetypeKey, Archetype>,
    locations: BTreeMap<EntityGuid, EntityLocation>,
    structural_epoch: u64,
}

impl EcsWorld {
    #[must_use]
    pub fn new(component_registry: ComponentRegistry) -> Self {
        Self {
            entity_registry: EntityRegistry::new(),
            component_registry,
            archetypes: BTreeMap::new(),
            locations: BTreeMap::new(),
            structural_epoch: 0,
        }
    }

    #[must_use]
    pub const fn structural_epoch(&self) -> u64 {
        self.structural_epoch
    }

    #[must_use]
    pub fn is_alive(&self, entity: EntityGuid) -> bool {
        self.entity_registry.is_alive(entity) && self.locations.contains_key(&entity)
    }

    #[must_use]
    pub fn live_entities(&self) -> Vec<EntityGuid> {
        self.locations.keys().copied().collect()
    }

    #[must_use]
    pub fn location(&self, entity: EntityGuid) -> Option<&EntityLocation> {
        self.locations.get(&entity)
    }

    pub fn component_bytes(
        &self,
        entity: EntityGuid,
        component_type: ComponentTypeId,
    ) -> Result<Vec<u8>, EcsWorldError> {
        if !self.entity_registry.is_alive(entity) {
            return Err(EcsWorldError::StaleEntity(entity));
        }
        let location = self
            .locations
            .get(&entity)
            .ok_or(EcsWorldError::StaleEntity(entity))?;
        self.archetypes[&location.archetype]
            .read_component(location.chunk_index, location.row_index, component_type)
            .map_err(Into::into)
    }

    pub fn commit_structural(
        &mut self,
        buffers: Vec<StructuralCommandBuffer>,
    ) -> Result<StructuralCommitReport, EcsWorldError> {
        let mut commands: Vec<KeyedStructuralCommand> = buffers
            .into_iter()
            .flat_map(StructuralCommandBuffer::into_commands)
            .collect();
        commands.sort_unstable_by_key(|entry| entry.key);
        if commands.windows(2).any(|pair| pair[0].key == pair[1].key) {
            return Err(EcsWorldError::DuplicateStructuralCommandKey);
        }

        let command_count = commands.len();
        let mut staged = self.clone();
        let mut spawned_entities = Vec::new();
        for entry in commands {
            if let Some(entity) = staged.apply_command(entry.command)? {
                spawned_entities.push(entity);
            }
        }
        staged.structural_epoch = staged
            .structural_epoch
            .checked_add(1)
            .ok_or(EcsWorldError::StructuralEpochOverflow)?;
        let structural_epoch = staged.structural_epoch;
        *self = staged;

        Ok(StructuralCommitReport {
            spawned_entities,
            command_count,
            structural_epoch,
        })
    }

    fn apply_command(
        &mut self,
        command: StructuralCommand,
    ) -> Result<Option<EntityGuid>, EcsWorldError> {
        match command {
            StructuralCommand::Spawn { components } => self.spawn(components).map(Some),
            StructuralCommand::Despawn { entity } => {
                self.despawn(entity)?;
                Ok(None)
            }
            StructuralCommand::AddComponent { entity, component } => {
                self.add_component(entity, component)?;
                Ok(None)
            }
            StructuralCommand::RemoveComponent {
                entity,
                component_type,
            } => {
                self.remove_component(entity, component_type)?;
                Ok(None)
            }
            StructuralCommand::Note => Ok(None),
        }
    }

    fn spawn(&mut self, components: Vec<ComponentValue>) -> Result<EntityGuid, EcsWorldError> {
        let values = self.validate_values(components)?;
        let key = ArchetypeKey::new(values.keys().copied().collect())?;
        self.ensure_archetype(&key)?;
        let entity = self.entity_registry.spawn()?;
        let inserted = self
            .archetypes
            .get_mut(&key)
            .expect("ensured archetype must exist")
            .insert(entity, &values)?;
        self.locations.insert(
            entity,
            EntityLocation {
                archetype: key,
                chunk_index: inserted.chunk_index,
                row_index: inserted.row_index,
            },
        );
        Ok(entity)
    }

    fn despawn(&mut self, entity: EntityGuid) -> Result<(), EcsWorldError> {
        self.ensure_alive(entity)?;
        let location = self.locations[&entity].clone();
        self.remove_from_location(entity, &location)?;
        self.entity_registry.despawn(entity)?;
        Ok(())
    }

    fn add_component(
        &mut self,
        entity: EntityGuid,
        component: ComponentValue,
    ) -> Result<(), EcsWorldError> {
        self.ensure_alive(entity)?;
        let source = self.locations[&entity].clone();
        if source.archetype.contains(component.type_id()) {
            return Err(EcsWorldError::ComponentAlreadyPresent {
                entity,
                component_type: component.type_id(),
            });
        }
        let layout = self
            .component_registry
            .get(component.type_id())
            .ok_or(EcsWorldError::UnknownComponent(component.type_id()))?;
        component.validate_against(layout)?;

        let mut values =
            self.archetypes[&source.archetype].read_row(source.chunk_index, source.row_index)?;
        values.insert(component.type_id(), component);
        self.migrate(entity, source, values)
    }

    fn remove_component(
        &mut self,
        entity: EntityGuid,
        component_type: ComponentTypeId,
    ) -> Result<(), EcsWorldError> {
        self.ensure_alive(entity)?;
        let source = self.locations[&entity].clone();
        if !source.archetype.contains(component_type) {
            return Err(EcsWorldError::ComponentMissing {
                entity,
                component_type,
            });
        }
        if source.archetype.component_types().len() == 1 {
            return Err(EcsWorldError::CannotRemoveLastComponent(entity));
        }
        let mut values =
            self.archetypes[&source.archetype].read_row(source.chunk_index, source.row_index)?;
        values.remove(&component_type);
        self.migrate(entity, source, values)
    }

    fn migrate(
        &mut self,
        entity: EntityGuid,
        source: EntityLocation,
        values: BTreeMap<ComponentTypeId, ComponentValue>,
    ) -> Result<(), EcsWorldError> {
        let target_key = ArchetypeKey::new(values.keys().copied().collect())?;
        self.ensure_archetype(&target_key)?;
        let inserted = self
            .archetypes
            .get_mut(&target_key)
            .expect("ensured target archetype must exist")
            .insert(entity, &values)?;
        self.remove_from_location(entity, &source)?;
        self.locations.insert(
            entity,
            EntityLocation {
                archetype: target_key,
                chunk_index: inserted.chunk_index,
                row_index: inserted.row_index,
            },
        );
        Ok(())
    }

    fn remove_from_location(
        &mut self,
        entity: EntityGuid,
        location: &EntityLocation,
    ) -> Result<(), EcsWorldError> {
        let result = self
            .archetypes
            .get_mut(&location.archetype)
            .expect("entity archetype must exist")
            .remove(location.chunk_index, location.row_index)?;
        debug_assert_eq!(result.removed_entity(), entity);
        self.locations.remove(&entity);
        if let Some(moved) = result.moved_entity() {
            self.locations.insert(
                moved,
                EntityLocation {
                    archetype: location.archetype.clone(),
                    chunk_index: location.chunk_index,
                    row_index: location.row_index,
                },
            );
        }
        Ok(())
    }

    fn ensure_alive(&self, entity: EntityGuid) -> Result<(), EcsWorldError> {
        if self.entity_registry.is_alive(entity) && self.locations.contains_key(&entity) {
            Ok(())
        } else {
            Err(EcsWorldError::StaleEntity(entity))
        }
    }

    fn validate_values(
        &self,
        components: Vec<ComponentValue>,
    ) -> Result<BTreeMap<ComponentTypeId, ComponentValue>, EcsWorldError> {
        let mut seen = BTreeSet::new();
        let mut values = BTreeMap::new();
        for component in components {
            let type_id = component.type_id();
            if !seen.insert(type_id) {
                return Err(EcsWorldError::DuplicateSpawnComponent(type_id));
            }
            let layout = self
                .component_registry
                .get(type_id)
                .ok_or(EcsWorldError::UnknownComponent(type_id))?;
            component.validate_against(layout)?;
            values.insert(type_id, component);
        }
        Ok(values)
    }

    fn ensure_archetype(&mut self, key: &ArchetypeKey) -> Result<(), EcsWorldError> {
        if self.archetypes.contains_key(key) {
            return Ok(());
        }
        let layouts: Vec<ComponentLayout> = key
            .component_types()
            .iter()
            .copied()
            .map(|type_id| {
                self.component_registry
                    .get(type_id)
                    .copied()
                    .ok_or(EcsWorldError::UnknownComponent(type_id))
            })
            .collect::<Result<_, _>>()?;
        let archetype = Archetype::new(key.clone(), layouts)?;
        self.archetypes.insert(key.clone(), archetype);
        Ok(())
    }

    #[must_use]
    pub fn strict_state_hash(&self) -> u64 {
        let mut hash = Fnv64::new();
        hash.write_u64(self.structural_epoch);
        hash.write_usize(self.locations.len());
        hash.write_usize(self.archetypes.len());
        for (key, archetype) in &self.archetypes {
            hash.write_usize(key.component_types().len());
            for type_id in key.component_types() {
                hash.write_u64(type_id.value());
            }
            hash.write_usize(archetype.chunks().len());
            for chunk in archetype.chunks() {
                hash.write_usize(chunk.len());
                for row in 0..chunk.len() {
                    let entity = chunk.entity_at(row).expect("dense row must have entity");
                    hash.write_u64(entity.index);
                    hash.write_u64(entity.generation);
                    for type_id in key.component_types() {
                        let bytes = chunk
                            .read_component(row, *type_id)
                            .expect("registered component must be readable");
                        hash.write_usize(bytes.len());
                        hash.write_bytes(&bytes);
                    }
                }
            }
        }
        hash.finish()
    }
}

struct Fnv64(u64);

impl Fnv64 {
    const OFFSET: u64 = 14_695_981_039_346_656_037;
    const PRIME: u64 = 1_099_511_628_211;

    const fn new() -> Self {
        Self(Self::OFFSET)
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    fn write_u64(&mut self, value: u64) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_usize(&mut self, value: usize) {
        self.write_u64(u64::try_from(value).expect("usize must fit u64 on supported targets"));
    }

    const fn finish(self) -> u64 {
        self.0
    }
}
