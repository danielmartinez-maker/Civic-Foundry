use std::fmt;

use crate::entity::{EntityRegistry, EntityRegistryError};
use crate::jobs::{JobGraph, JobGraphError, JobId, JobSpec, ResourceId};
use crate::memory::{AlignedBlock, CACHE_LINE_BYTES};
use crate::PRISM_VERSION;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BootstrapReport {
    pub entity_generation: u64,
    pub alignment_bytes: usize,
    pub compiled_jobs: usize,
}

impl fmt::Display for BootstrapReport {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "PRISM_BOOTSTRAP version={} entity_generation={} alignment={} compiled_jobs={}",
            PRISM_VERSION, self.entity_generation, self.alignment_bytes, self.compiled_jobs
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BootstrapError {
    Entity(EntityRegistryError),
    Job(JobGraphError),
}

impl From<EntityRegistryError> for BootstrapError {
    fn from(value: EntityRegistryError) -> Self {
        Self::Entity(value)
    }
}

impl From<JobGraphError> for BootstrapError {
    fn from(value: JobGraphError) -> Self {
        Self::Job(value)
    }
}

pub fn run_bootstrap_probe() -> Result<BootstrapReport, BootstrapError> {
    let mut entities = EntityRegistry::new();
    let first = entities.spawn()?;
    entities.despawn(first)?;
    let recycled = entities.spawn()?;

    let memory = AlignedBlock::new(128);
    debug_assert_eq!((memory.as_ptr() as usize) % CACHE_LINE_BYTES, 0);

    let state = ResourceId::new(1);
    let mut jobs = JobGraph::new();
    jobs.add_job(JobSpec::new(JobId::new(1), 0).write(state))?;
    jobs.add_job(JobSpec::new(JobId::new(2), 0).read(state).after(JobId::new(1)))?;
    let compiled = jobs.compile()?;

    Ok(BootstrapReport {
        entity_generation: recycled.generation,
        alignment_bytes: CACHE_LINE_BYTES,
        compiled_jobs: compiled.ordered_jobs().len(),
    })
}
