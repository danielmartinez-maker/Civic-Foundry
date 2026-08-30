use std::collections::BTreeMap;

use crate::jobs::{ExecutionEpoch, JobId};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JobProfileSample {
    job_id: JobId,
    epoch: ExecutionEpoch,
    worker_index: usize,
    elapsed_ns: u128,
    structural_commands: usize,
}

impl JobProfileSample {
    #[must_use]
    pub const fn new(
        job_id: JobId,
        epoch: ExecutionEpoch,
        worker_index: usize,
        elapsed_ns: u128,
        structural_commands: usize,
    ) -> Self {
        Self {
            job_id,
            epoch,
            worker_index,
            elapsed_ns,
            structural_commands,
        }
    }

    #[must_use]
    pub const fn job_id(self) -> JobId {
        self.job_id
    }

    #[must_use]
    pub const fn epoch(self) -> ExecutionEpoch {
        self.epoch
    }

    #[must_use]
    pub const fn worker_index(self) -> usize {
        self.worker_index
    }

    #[must_use]
    pub const fn elapsed_ns(self) -> u128 {
        self.elapsed_ns
    }

    #[must_use]
    pub const fn structural_commands(self) -> usize {
        self.structural_commands
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct JobProfileAggregate {
    job_id: JobId,
    invocations: u64,
    total_elapsed_ns: u128,
    max_elapsed_ns: u128,
    total_structural_commands: u64,
}

impl JobProfileAggregate {
    #[must_use]
    pub const fn job_id(self) -> JobId {
        self.job_id
    }

    #[must_use]
    pub const fn invocations(self) -> u64 {
        self.invocations
    }

    #[must_use]
    pub const fn total_elapsed_ns(self) -> u128 {
        self.total_elapsed_ns
    }

    #[must_use]
    pub const fn max_elapsed_ns(self) -> u128 {
        self.max_elapsed_ns
    }

    #[must_use]
    pub const fn total_structural_commands(self) -> u64 {
        self.total_structural_commands
    }
}

#[derive(Default)]
pub struct Profiler {
    aggregates: BTreeMap<JobId, JobProfileAggregate>,
}

impl Profiler {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&mut self, sample: JobProfileSample) {
        let structural_commands = u64::try_from(sample.structural_commands())
            .expect("structural command count must fit u64");
        let aggregate = self
            .aggregates
            .entry(sample.job_id())
            .or_insert(JobProfileAggregate {
                job_id: sample.job_id(),
                invocations: 0,
                total_elapsed_ns: 0,
                max_elapsed_ns: 0,
                total_structural_commands: 0,
            });
        aggregate.invocations = aggregate
            .invocations
            .checked_add(1)
            .expect("profile invocation count overflow");
        aggregate.total_elapsed_ns = aggregate.total_elapsed_ns.saturating_add(sample.elapsed_ns());
        aggregate.max_elapsed_ns = aggregate.max_elapsed_ns.max(sample.elapsed_ns());
        aggregate.total_structural_commands = aggregate
            .total_structural_commands
            .saturating_add(structural_commands);
    }

    #[must_use]
    pub fn snapshot(&self) -> Vec<JobProfileAggregate> {
        self.aggregates.values().copied().collect()
    }
}
