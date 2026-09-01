pub const CACHE_LINE_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MemoryError {
    OutOfBounds { index: usize, len: usize },
}

#[derive(Clone)]
#[repr(C, align(64))]
struct CacheLine([u8; CACHE_LINE_BYTES]);

#[derive(Clone)]
pub struct AlignedBlock {
    lines: Box<[CacheLine]>,
    len_bytes: usize,
}

impl AlignedBlock {
    #[must_use]
    pub fn new(len_bytes: usize) -> Self {
        let line_count = len_bytes.div_ceil(CACHE_LINE_BYTES);
        let lines = vec![CacheLine([0; CACHE_LINE_BYTES]); line_count].into_boxed_slice();
        Self { lines, len_bytes }
    }

    #[must_use]
    pub fn as_ptr(&self) -> *const u8 {
        self.lines.as_ptr().cast::<u8>()
    }

    #[must_use]
    pub const fn len_bytes(&self) -> usize {
        self.len_bytes
    }

    #[must_use]
    pub fn capacity_bytes(&self) -> usize {
        self.lines.len() * CACHE_LINE_BYTES
    }

    pub fn read_byte(&self, index: usize) -> Result<u8, MemoryError> {
        self.check_index(index)?;
        Ok(self.lines[index / CACHE_LINE_BYTES].0[index % CACHE_LINE_BYTES])
    }

    pub fn write_byte(&mut self, index: usize, value: u8) -> Result<(), MemoryError> {
        self.check_index(index)?;
        self.lines[index / CACHE_LINE_BYTES].0[index % CACHE_LINE_BYTES] = value;
        Ok(())
    }

    fn check_index(&self, index: usize) -> Result<(), MemoryError> {
        if index < self.len_bytes {
            Ok(())
        } else {
            Err(MemoryError::OutOfBounds {
                index,
                len: self.len_bytes,
            })
        }
    }
}
