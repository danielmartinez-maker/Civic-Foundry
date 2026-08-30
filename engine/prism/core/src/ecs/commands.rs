use crate::entity::EntityGuid;
use crate::jobs::JobId;

use super::{ComponentTypeId, ComponentValue};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct StructuralCommandKey {
    issuer: JobId,
    sequence: u64,
}

impl StructuralCommandKey {
    #[must_use]
    pub const fn new(issuer: JobId, sequence: u64) -> Self {
        Self { issuer, sequence }
    }

    #[must_use]
    pub const fn issuer(self) -> JobId {
        self.issuer
    }

    #[must_use]
    pub const fn sequence(self) -> u64 {
        self.sequence
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StructuralCommand {
    Spawn {
        components: Vec<ComponentValue>,
    },
    Despawn {
        entity: EntityGuid,
    },
    AddComponent {
        entity: EntityGuid,
        component: ComponentValue,
    },
    RemoveComponent {
        entity: EntityGuid,
        component_type: ComponentTypeId,
    },
    Note,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct KeyedStructuralCommand {
    pub key: StructuralCommandKey,
    pub command: StructuralCommand,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StructuralCommandBuffer {
    issuer: JobId,
    next_sequence: u64,
    commands: Vec<KeyedStructuralCommand>,
}

impl StructuralCommandBuffer {
    #[must_use]
    pub const fn new(issuer: JobId) -> Self {
        Self {
            issuer,
            next_sequence: 0,
            commands: Vec::new(),
        }
    }

    #[must_use]
    pub const fn issuer(&self) -> JobId {
        self.issuer
    }

    #[must_use]
    pub fn command_count(&self) -> usize {
        self.commands.len()
    }

    pub fn spawn(&mut self, components: Vec<ComponentValue>) {
        self.push(StructuralCommand::Spawn { components });
    }

    pub fn despawn(&mut self, entity: EntityGuid) {
        self.push(StructuralCommand::Despawn { entity });
    }

    pub fn add_component(&mut self, entity: EntityGuid, component: ComponentValue) {
        self.push(StructuralCommand::AddComponent { entity, component });
    }

    pub fn remove_component(&mut self, entity: EntityGuid, component_type: ComponentTypeId) {
        self.push(StructuralCommand::RemoveComponent {
            entity,
            component_type,
        });
    }

    pub fn note(&mut self) {
        self.push(StructuralCommand::Note);
    }

    fn push(&mut self, command: StructuralCommand) {
        let key = StructuralCommandKey::new(self.issuer, self.next_sequence);
        self.next_sequence = self
            .next_sequence
            .checked_add(1)
            .expect("structural command sequence overflow");
        self.commands.push(KeyedStructuralCommand { key, command });
    }

    pub(crate) fn into_commands(self) -> Vec<KeyedStructuralCommand> {
        self.commands
    }
}
