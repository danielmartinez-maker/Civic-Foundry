#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EntityGuid {
    pub index: u64,
    pub generation: u64,
}

impl EntityGuid {
    #[must_use]
    pub const fn new(index: u64, generation: u64) -> Self {
        Self { index, generation }
    }
}
