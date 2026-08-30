use std::collections::BTreeMap;

use crate::memory::CACHE_LINE_BYTES;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ComponentTypeId(u64);

impl ComponentTypeId {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn value(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ComponentTemperature {
    Hot,
    Medium,
    Cold,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ComponentLayout {
    type_id: ComponentTypeId,
    size_bytes: usize,
    alignment_bytes: usize,
    temperature: ComponentTemperature,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ComponentError {
    ZeroSize(ComponentTypeId),
    InvalidAlignment {
        type_id: ComponentTypeId,
        alignment_bytes: usize,
    },
    TypeMismatch {
        expected: ComponentTypeId,
        actual: ComponentTypeId,
    },
    PayloadSizeMismatch {
        type_id: ComponentTypeId,
        expected: usize,
        actual: usize,
    },
    ConflictingRegistration(ComponentTypeId),
}

impl ComponentLayout {
    pub fn new(
        type_id: ComponentTypeId,
        size_bytes: usize,
        alignment_bytes: usize,
        temperature: ComponentTemperature,
    ) -> Result<Self, ComponentError> {
        if size_bytes == 0 {
            return Err(ComponentError::ZeroSize(type_id));
        }
        if alignment_bytes == 0
            || !alignment_bytes.is_power_of_two()
            || alignment_bytes > CACHE_LINE_BYTES
        {
            return Err(ComponentError::InvalidAlignment {
                type_id,
                alignment_bytes,
            });
        }
        Ok(Self {
            type_id,
            size_bytes,
            alignment_bytes,
            temperature,
        })
    }

    #[must_use]
    pub const fn type_id(&self) -> ComponentTypeId {
        self.type_id
    }

    #[must_use]
    pub const fn size_bytes(self) -> usize {
        self.size_bytes
    }

    #[must_use]
    pub const fn alignment_bytes(self) -> usize {
        self.alignment_bytes
    }

    #[must_use]
    pub const fn temperature(self) -> ComponentTemperature {
        self.temperature
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ComponentValue {
    type_id: ComponentTypeId,
    bytes: Vec<u8>,
}

impl ComponentValue {
    pub fn new(
        type_id: ComponentTypeId,
        bytes: Vec<u8>,
        layout: &ComponentLayout,
    ) -> Result<Self, ComponentError> {
        if type_id != layout.type_id() {
            return Err(ComponentError::TypeMismatch {
                expected: layout.type_id(),
                actual: type_id,
            });
        }
        if bytes.len() != layout.size_bytes() {
            return Err(ComponentError::PayloadSizeMismatch {
                type_id,
                expected: layout.size_bytes(),
                actual: bytes.len(),
            });
        }
        Ok(Self { type_id, bytes })
    }

    #[must_use]
    pub const fn type_id(&self) -> ComponentTypeId {
        self.type_id
    }

    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn validate_against(
        &self,
        layout: &ComponentLayout,
    ) -> Result<(), ComponentError> {
        if self.type_id != layout.type_id() {
            return Err(ComponentError::TypeMismatch {
                expected: layout.type_id(),
                actual: self.type_id,
            });
        }
        if self.bytes.len() != layout.size_bytes() {
            return Err(ComponentError::PayloadSizeMismatch {
                type_id: self.type_id,
                expected: layout.size_bytes(),
                actual: self.bytes.len(),
            });
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ComponentRegistry {
    layouts: BTreeMap<ComponentTypeId, ComponentLayout>,
}

impl ComponentRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, layout: ComponentLayout) -> Result<(), ComponentError> {
        match self.layouts.get(&layout.type_id()) {
            Some(existing) if existing == &layout => Ok(()),
            Some(_) => Err(ComponentError::ConflictingRegistration(layout.type_id())),
            None => {
                self.layouts.insert(layout.type_id(), layout);
                Ok(())
            }
        }
    }

    #[must_use]
    pub fn get(&self, type_id: ComponentTypeId) -> Option<&ComponentLayout> {
        self.layouts.get(&type_id)
    }

    #[must_use]
    pub fn contains(&self, type_id: ComponentTypeId) -> bool {
        self.layouts.contains_key(&type_id)
    }
}
