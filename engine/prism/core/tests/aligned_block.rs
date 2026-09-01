use prism_core::memory::{AlignedBlock, CACHE_LINE_BYTES, MemoryError};

#[test]
fn block_is_cache_line_aligned_and_rounds_capacity() {
    let block = AlignedBlock::new(65);
    assert_eq!((block.as_ptr() as usize) % CACHE_LINE_BYTES, 0);
    assert_eq!(block.len_bytes(), 65);
    assert_eq!(block.capacity_bytes(), 128);
}

#[test]
fn block_is_zero_initialized_and_supports_safe_byte_access() {
    let mut block = AlignedBlock::new(96);
    assert_eq!(block.read_byte(5), Ok(0));
    block.write_byte(5, 0xAB).unwrap();
    assert_eq!(block.read_byte(5), Ok(0xAB));
}

#[test]
fn logical_bounds_are_enforced_even_when_capacity_is_padded() {
    let mut block = AlignedBlock::new(65);
    assert_eq!(
        block.read_byte(65),
        Err(MemoryError::OutOfBounds { index: 65, len: 65 })
    );
    assert_eq!(
        block.write_byte(127, 1),
        Err(MemoryError::OutOfBounds {
            index: 127,
            len: 65
        })
    );
}
