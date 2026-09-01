use std::cmp::Reverse;
use std::collections::BinaryHeap;

use super::EntityGuid;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntityRegistryError {
    StaleGuid(EntityGuid),
    GenerationOverflow(u64),
}

#[derive(Clone, Debug, Default)]
pub struct EntityRegistry {
    generations: Vec<u64>,
    alive: Vec<bool>,
    free: BinaryHeap<Reverse<u64>>,
    alive_count: usize,
}

impl EntityRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn spawn(&mut self) -> Result<EntityGuid, EntityRegistryError> {
        if let Some(Reverse(index)) = self.free.pop() {
            let slot = usize::try_from(index).expect("entity index must fit usize");
            let next = self.generations[slot]
                .checked_add(1)
                .ok_or(EntityRegistryError::GenerationOverflow(index));
            let generation = match next {
                Ok(value) => value,
                Err(error) => {
                    self.free.push(Reverse(index));
                    return Err(error);
                }
            };
            self.generations[slot] = generation;
            self.alive[slot] = true;
            self.alive_count += 1;
            return Ok(EntityGuid::new(index, generation));
        }

        let index =
            u64::try_from(self.generations.len()).expect("entity registry exceeded u64 slots");
        self.generations.push(0);
        self.alive.push(true);
        self.alive_count += 1;
        Ok(EntityGuid::new(index, 0))
    }

    pub fn despawn(&mut self, guid: EntityGuid) -> Result<(), EntityRegistryError> {
        let Ok(slot) = usize::try_from(guid.index) else {
            return Err(EntityRegistryError::StaleGuid(guid));
        };
        let Some(&generation) = self.generations.get(slot) else {
            return Err(EntityRegistryError::StaleGuid(guid));
        };
        if generation != guid.generation || !self.alive[slot] {
            return Err(EntityRegistryError::StaleGuid(guid));
        }

        self.alive[slot] = false;
        self.alive_count -= 1;
        self.free.push(Reverse(guid.index));
        Ok(())
    }

    #[must_use]
    pub fn is_alive(&self, guid: EntityGuid) -> bool {
        let Ok(slot) = usize::try_from(guid.index) else {
            return false;
        };
        self.generations.get(slot).copied() == Some(guid.generation)
            && self.alive.get(slot).copied() == Some(true)
    }

    #[must_use]
    pub const fn alive_count(&self) -> usize {
        self.alive_count
    }

    #[must_use]
    pub fn slot_count(&self) -> usize {
        self.generations.len()
    }
}
