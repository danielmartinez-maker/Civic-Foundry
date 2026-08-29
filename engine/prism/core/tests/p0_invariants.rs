use prism_core::entity::{EntityGuid, EntityRegistry};
use prism_core::jobs::{JobGraph, JobId, JobSpec, ResourceId};
use prism_core::memory::{AlignedBlock, CACHE_LINE_BYTES};

#[test]
fn registry_recycles_one_hundred_thousand_slots_without_growth() {
    const COUNT: usize = 100_000;
    let mut registry = EntityRegistry::new();
    let first_generation: Vec<_> = (0..COUNT).map(|_| registry.spawn().unwrap()).collect();
    assert_eq!(registry.slot_count(), COUNT);

    for guid in first_generation.iter().rev().copied() {
        registry.despawn(guid).unwrap();
    }

    let second_generation: Vec<_> = (0..COUNT).map(|_| registry.spawn().unwrap()).collect();
    assert_eq!(registry.slot_count(), COUNT);
    assert_eq!(registry.alive_count(), COUNT);
    assert_eq!(second_generation[0], EntityGuid::new(0, 1));
    assert_eq!(
        second_generation[COUNT - 1],
        EntityGuid::new((COUNT - 1) as u64, 1)
    );
}

#[test]
fn four_hundred_job_chain_compiles_identically_in_reverse_registration_order() {
    const JOBS: u64 = 400;
    let resource = ResourceId::new(9);

    fn build(reverse: bool, resource: ResourceId) -> Vec<JobId> {
        let mut specs = Vec::new();
        for index in 0..JOBS {
            let mut spec = if index % 2 == 0 {
                JobSpec::new(JobId::new(index), (index % 7) as i32).write(resource)
            } else {
                JobSpec::new(JobId::new(index), (index % 7) as i32).read(resource)
            };
            if index > 0 {
                spec = spec.after(JobId::new(index - 1));
            }
            specs.push(spec);
        }
        if reverse {
            specs.reverse();
        }

        let mut graph = JobGraph::new();
        for spec in specs {
            graph.add_job(spec).unwrap();
        }
        graph.compile().unwrap().ordered_jobs().to_vec()
    }

    assert_eq!(build(false, resource), build(true, resource));
}

#[test]
fn one_mebibyte_aligned_block_preserves_logical_bounds_and_data() {
    let mut block = AlignedBlock::new(1024 * 1024);
    assert_eq!((block.as_ptr() as usize) % CACHE_LINE_BYTES, 0);
    assert_eq!(block.capacity_bytes(), 1024 * 1024);

    for index in (0..block.len_bytes()).step_by(4096) {
        block.write_byte(index, (index / 4096) as u8).unwrap();
    }
    for index in (0..block.len_bytes()).step_by(4096) {
        assert_eq!(block.read_byte(index).unwrap(), (index / 4096) as u8);
    }
}
