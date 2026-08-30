use std::collections::{BTreeMap, BTreeSet};

use crate::entity::EntityGuid;
use crate::memory::{AlignedBlock, MemoryError};

use super::{ComponentError, ComponentLayout, ComponentTypeId, ComponentValue};

pub const DEFAULT_CHUNK_TARGET_BYTES: usize = 32 * 1024;

#[derive(Clone, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ArchetypeKey(Vec<ComponentTypeId>);

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ArchetypeError {
    EmptySignature,
    DuplicateComponent(ComponentTypeId),
    MissingComponent(ComponentTypeId),
    UnexpectedComponent(ComponentTypeId),
    RowOutOfBounds { row: usize, len: usize },
    ChunkFull,
    SizeOverflow,
    Component(ComponentError),
    Memory(MemoryError),
}

impl From<ComponentError> for ArchetypeError {
    fn from(value: ComponentError) -> Self {
        Self::Component(value)
    }
}

impl From<MemoryError> for ArchetypeError {
    fn from(value: MemoryError) -> Self {
        Self::Memory(value)
    }
}

impl ArchetypeKey {
    pub fn new(mut component_types: Vec<ComponentTypeId>) -> Result<Self, ArchetypeError> {
        if component_types.is_empty() {
            return Err(ArchetypeError::EmptySignature);
        }
        component_types.sort_unstable();
        for pair in component_types.windows(2) {
            if pair[0] == pair[1] {
                return Err(ArchetypeError::DuplicateComponent(pair[0]));
            }
        }
        Ok(Self(component_types))
    }

    #[must_use]
    pub fn component_types(&self) -> &[ComponentTypeId] {
        &self.0
    }

    #[must_use]
    pub fn contains(&self, type_id: ComponentTypeId) -> bool {
        self.0.binary_search(&type_id).is_ok()
    }
}

#[derive(Clone)]
struct ComponentColumn {
    layout: ComponentLayout,
    storage: AlignedBlock,
}

impl ComponentColumn {
    fn new(layout: ComponentLayout, capacity_rows: usize) -> Result<Self, ArchetypeError> {
        let bytes = layout
            .size_bytes()
            .checked_mul(capacity_rows)
            .ok_or(ArchetypeError::SizeOverflow)?;
        Ok(Self {
            layout,
            storage: AlignedBlock::new(bytes),
        })
    }

    fn write(&mut self, row: usize, value: &ComponentValue) -> Result<(), ArchetypeError> {
        value.validate_against(&self.layout)?;
        let start = row
            .checked_mul(self.layout.size_bytes())
            .ok_or(ArchetypeError::SizeOverflow)?;
        for (offset, byte) in value.bytes().iter().copied().enumerate() {
            self.storage.write_byte(start + offset, byte)?;
        }
        Ok(())
    }

    fn read(&self, row: usize) -> Result<Vec<u8>, ArchetypeError> {
        let start = row
            .checked_mul(self.layout.size_bytes())
            .ok_or(ArchetypeError::SizeOverflow)?;
        let mut bytes = Vec::with_capacity(self.layout.size_bytes());
        for offset in 0..self.layout.size_bytes() {
            bytes.push(self.storage.read_byte(start + offset)?);
        }
        Ok(bytes)
    }

    fn copy_row(&mut self, source: usize, target: usize) -> Result<(), ArchetypeError> {
        if source == target {
            return Ok(());
        }
        let bytes = self.read(source)?;
        let start = target
            .checked_mul(self.layout.size_bytes())
            .ok_or(ArchetypeError::SizeOverflow)?;
        for (offset, byte) in bytes.into_iter().enumerate() {
            self.storage.write_byte(start + offset, byte)?;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SwapRemoveResult {
    removed_entity: EntityGuid,
    moved_entity: Option<EntityGuid>,
}

impl SwapRemoveResult {
    #[must_use]
    pub const fn removed_entity(self) -> EntityGuid {
        self.removed_entity
    }

    #[must_use]
    pub const fn moved_entity(self) -> Option<EntityGuid> {
        self.moved_entity
    }
}

#[derive(Clone)]
pub struct ArchetypeChunk {
    layouts: BTreeMap<ComponentTypeId, ComponentLayout>,
    columns: BTreeMap<ComponentTypeId, ComponentColumn>,
    entities: Vec<EntityGuid>,
    capacity_rows: usize,
}

impl ArchetypeChunk {
    pub fn new(layouts: &[ComponentLayout]) -> Result<Self, ArchetypeError> {
        if layouts.is_empty() {
            return Err(ArchetypeError::EmptySignature);
        }
        let mut layout_map = BTreeMap::new();
        let mut row_bytes = 0_usize;
        for layout in layouts.iter().copied() {
            if layout_map.insert(layout.type_id(), layout).is_some() {
                return Err(ArchetypeError::DuplicateComponent(layout.type_id()));
            }
            row_bytes = row_bytes
                .checked_add(layout.size_bytes())
                .ok_or(ArchetypeError::SizeOverflow)?;
        }
        let capacity_rows = (DEFAULT_CHUNK_TARGET_BYTES / row_bytes).max(1);
        let mut columns = BTreeMap::new();
        for layout in layout_map.values().copied() {
            columns.insert(layout.type_id(), ComponentColumn::new(layout, capacity_rows)?);
        }
        Ok(Self {
            layouts: layout_map,
            columns,
            entities: Vec::with_capacity(capacity_rows),
            capacity_rows,
        })
    }

    #[must_use]
    pub const fn capacity_rows(&self) -> usize {
        self.capacity_rows
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.entities.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.entities.is_empty()
    }

    #[must_use]
    pub fn is_full(&self) -> bool {
        self.entities.len() >= self.capacity_rows
    }

    #[must_use]
    pub fn column_ptrs(&self) -> Vec<*const u8> {
        self.columns
            .values()
            .map(|column| column.storage.as_ptr())
            .collect()
    }

    #[must_use]
    pub fn entity_at(&self, row: usize) -> Option<EntityGuid> {
        self.entities.get(row).copied()
    }

    pub fn push(
        &mut self,
        entity: EntityGuid,
        values: &BTreeMap<ComponentTypeId, ComponentValue>,
    ) -> Result<usize, ArchetypeError> {
        if self.is_full() {
            return Err(ArchetypeError::ChunkFull);
        }
        for type_id in self.layouts.keys().copied() {
            if !values.contains_key(&type_id) {
                return Err(ArchetypeError::MissingComponent(type_id));
            }
        }
        for type_id in values.keys().copied() {
            if !self.layouts.contains_key(&type_id) {
                return Err(ArchetypeError::UnexpectedComponent(type_id));
            }
        }
        let row = self.entities.len();
        for (type_id, column) in &mut self.columns {
            column.write(row, &values[type_id])?;
        }
        self.entities.push(entity);
        Ok(row)
    }

    pub fn read_component(
        &self,
        row: usize,
        type_id: ComponentTypeId,
    ) -> Result<Vec<u8>, ArchetypeError> {
        if row >= self.entities.len() {
            return Err(ArchetypeError::RowOutOfBounds {
                row,
                len: self.entities.len(),
            });
        }
        let column = self
            .columns
            .get(&type_id)
            .ok_or(ArchetypeError::MissingComponent(type_id))?;
        column.read(row)
    }

    pub fn read_row(
        &self,
        row: usize,
    ) -> Result<BTreeMap<ComponentTypeId, ComponentValue>, ArchetypeError> {
        if row >= self.entities.len() {
            return Err(ArchetypeError::RowOutOfBounds {
                row,
                len: self.entities.len(),
            });
        }
        let mut values = BTreeMap::new();
        for (type_id, layout) in &self.layouts {
            let bytes = self.columns[type_id].read(row)?;
            values.insert(*type_id, ComponentValue::new(*type_id, bytes, layout)?);
        }
        Ok(values)
    }

    pub fn remove_swap(&mut self, row: usize) -> Result<SwapRemoveResult, ArchetypeError> {
        let len = self.entities.len();
        if row >= len {
            return Err(ArchetypeError::RowOutOfBounds { row, len });
        }
        let last = len - 1;
        let removed_entity = self.entities[row];
        let moved_entity = if row == last {
            None
        } else {
            for column in self.columns.values_mut() {
                column.copy_row(last, row)?;
            }
            let moved = self.entities[last];
            self.entities[row] = moved;
            Some(moved)
        };
        self.entities.pop();
        Ok(SwapRemoveResult {
            removed_entity,
            moved_entity,
        })
    }
}

#[derive(Clone)]
pub struct Archetype {
    key: ArchetypeKey,
    layouts: Vec<ComponentLayout>,
    chunks: Vec<ArchetypeChunk>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArchetypeInsertLocation {
    pub chunk_index: usize,
    pub row_index: usize,
}

impl Archetype {
    pub fn new(key: ArchetypeKey, mut layouts: Vec<ComponentLayout>) -> Result<Self, ArchetypeError> {
        layouts.sort_unstable_by_key(ComponentLayout::type_id);
        let layout_types: BTreeSet<_> = layouts.iter().map(|layout| layout.type_id()).collect();
        let key_types: BTreeSet<_> = key.component_types().iter().copied().collect();
        if layout_types != key_types || layouts.len() != key.component_types().len() {
            return Err(ArchetypeError::UnexpectedComponent(
                key.component_types()[0],
            ));
        }
        Ok(Self {
            key,
            layouts,
            chunks: Vec::new(),
        })
    }

    #[must_use]
    pub fn key(&self) -> &ArchetypeKey {
        &self.key
    }

    #[must_use]
    pub fn chunks(&self) -> &[ArchetypeChunk] {
        &self.chunks
    }

    pub fn insert(
        &mut self,
        entity: EntityGuid,
        values: &BTreeMap<ComponentTypeId, ComponentValue>,
    ) -> Result<ArchetypeInsertLocation, ArchetypeError> {
        for (chunk_index, chunk) in self.chunks.iter_mut().enumerate() {
            if !chunk.is_full() {
                let row_index = chunk.push(entity, values)?;
                return Ok(ArchetypeInsertLocation {
                    chunk_index,
                    row_index,
                });
            }
        }
        let mut chunk = ArchetypeChunk::new(&self.layouts)?;
        let row_index = chunk.push(entity, values)?;
        self.chunks.push(chunk);
        Ok(ArchetypeInsertLocation {
            chunk_index: self.chunks.len() - 1,
            row_index,
        })
    }

    pub fn read_component(
        &self,
        chunk_index: usize,
        row_index: usize,
        type_id: ComponentTypeId,
    ) -> Result<Vec<u8>, ArchetypeError> {
        let chunk = self
            .chunks
            .get(chunk_index)
            .ok_or(ArchetypeError::RowOutOfBounds {
                row: row_index,
                len: 0,
            })?;
        chunk.read_component(row_index, type_id)
    }

    pub fn read_row(
        &self,
        chunk_index: usize,
        row_index: usize,
    ) -> Result<BTreeMap<ComponentTypeId, ComponentValue>, ArchetypeError> {
        let chunk = self
            .chunks
            .get(chunk_index)
            .ok_or(ArchetypeError::RowOutOfBounds {
                row: row_index,
                len: 0,
            })?;
        chunk.read_row(row_index)
    }

    pub fn remove(
        &mut self,
        chunk_index: usize,
        row_index: usize,
    ) -> Result<SwapRemoveResult, ArchetypeError> {
        let chunk = self
            .chunks
            .get_mut(chunk_index)
            .ok_or(ArchetypeError::RowOutOfBounds {
                row: row_index,
                len: 0,
            })?;
        let result = chunk.remove_swap(row_index)?;
        while self.chunks.last().is_some_and(ArchetypeChunk::is_empty) {
            self.chunks.pop();
        }
        Ok(result)
    }
}
