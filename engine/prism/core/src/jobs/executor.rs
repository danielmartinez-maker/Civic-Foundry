use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

use crate::ecs::StructuralCommandBuffer;
use crate::profiling::{JobProfileSample, Profiler};

use super::{CompiledJobGraph, JobId, WorkerPool, WorkerPoolError, WorkerTask, WorkerTaskKey};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ExecutionEpoch(u64);

impl ExecutionEpoch {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn value(self) -> u64 {
        self.0
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobOutput {
    deterministic_value: u64,
    structural_commands: Option<StructuralCommandBuffer>,
}

impl JobOutput {
    #[must_use]
    pub const fn new(deterministic_value: u64) -> Self {
        Self {
            deterministic_value,
            structural_commands: None,
        }
    }

    #[must_use]
    pub fn with_structural_commands(mut self, commands: StructuralCommandBuffer) -> Self {
        self.structural_commands = Some(commands);
        self
    }

    #[must_use]
    pub const fn deterministic_value(&self) -> u64 {
        self.deterministic_value
    }

    #[must_use]
    pub fn structural_commands(&self) -> Option<&StructuralCommandBuffer> {
        self.structural_commands.as_ref()
    }
}

#[derive(Clone)]
pub struct ExecutableJob {
    id: JobId,
    run: Arc<dyn Fn() -> JobOutput + Send + Sync + 'static>,
}

impl ExecutableJob {
    pub fn new<F>(id: JobId, run: F) -> Self
    where
        F: Fn() -> JobOutput + Send + Sync + 'static,
    {
        Self {
            id,
            run: Arc::new(run),
        }
    }

    #[must_use]
    pub const fn id(&self) -> JobId {
        self.id
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompletedJob {
    job_id: JobId,
    worker_index: usize,
    elapsed_ns: u128,
    output: JobOutput,
}

impl CompletedJob {
    #[must_use]
    pub const fn job_id(&self) -> JobId {
        self.job_id
    }

    #[must_use]
    pub const fn worker_index(&self) -> usize {
        self.worker_index
    }

    #[must_use]
    pub const fn elapsed_ns(&self) -> u128 {
        self.elapsed_ns
    }

    #[must_use]
    pub const fn output(&self) -> &JobOutput {
        &self.output
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionReport {
    epoch: ExecutionEpoch,
    ordered_jobs: Vec<CompletedJob>,
}

impl ExecutionReport {
    #[must_use]
    pub const fn epoch(&self) -> ExecutionEpoch {
        self.epoch
    }

    #[must_use]
    pub fn ordered_jobs(&self) -> &[CompletedJob] {
        &self.ordered_jobs
    }

    #[must_use]
    pub fn structural_buffers(&self) -> Vec<StructuralCommandBuffer> {
        self.ordered_jobs
            .iter()
            .filter_map(|job| job.output.structural_commands.clone())
            .collect()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutorError {
    WorkerPool(WorkerPoolError),
    DuplicateExecutableJob(JobId),
    MissingJob(JobId),
    StructuralIssuerMismatch { job: JobId, issuer: JobId },
    EpochOverflow,
    TaskOrdinalOverflow,
}

impl From<WorkerPoolError> for ExecutorError {
    fn from(value: WorkerPoolError) -> Self {
        Self::WorkerPool(value)
    }
}

pub struct PrismExecutor {
    pool: WorkerPool,
    next_epoch: u64,
    profiler: Profiler,
}

impl PrismExecutor {
    pub fn new(worker_count: usize) -> Result<Self, ExecutorError> {
        Ok(Self {
            pool: WorkerPool::new(worker_count)?,
            next_epoch: 0,
            profiler: Profiler::new(),
        })
    }

    #[must_use]
    pub const fn profiler(&self) -> &Profiler {
        &self.profiler
    }

    #[must_use]
    pub fn worker_count(&self) -> usize {
        self.pool.worker_count()
    }

    pub fn execute(
        &mut self,
        graph: &CompiledJobGraph,
        jobs: &[ExecutableJob],
    ) -> Result<ExecutionReport, ExecutorError> {
        let mut registry = BTreeMap::new();
        for job in jobs {
            if registry.insert(job.id(), Arc::clone(&job.run)).is_some() {
                return Err(ExecutorError::DuplicateExecutableJob(job.id()));
            }
        }
        for job_id in graph.ordered_jobs() {
            if !registry.contains_key(job_id) {
                return Err(ExecutorError::MissingJob(*job_id));
            }
        }

        let epoch = ExecutionEpoch::new(self.next_epoch);
        let mut task_ordinal = 0_u64;
        let mut completed = Vec::with_capacity(graph.ordered_jobs().len());
        let mut profile_samples = Vec::with_capacity(graph.ordered_jobs().len());

        for wave in graph.waves() {
            let mut tasks = Vec::with_capacity(wave.len());
            for job_id in wave {
                let run = Arc::clone(&registry[job_id]);
                let id = *job_id;
                let key = WorkerTaskKey::new(task_ordinal);
                task_ordinal = task_ordinal
                    .checked_add(1)
                    .ok_or(ExecutorError::TaskOrdinalOverflow)?;
                tasks.push(WorkerTask::new(key, move || {
                    let started = Instant::now();
                    let output = run();
                    RawJobResult {
                        job_id: id,
                        elapsed_ns: started.elapsed().as_nanos(),
                        output,
                    }
                }));
            }

            let results = self.pool.execute_batch(tasks)?;
            for result in results {
                let worker_index = result.worker_index();
                let raw = result.into_value();
                if let Some(commands) = raw.output.structural_commands()
                    && commands.issuer() != raw.job_id
                {
                    return Err(ExecutorError::StructuralIssuerMismatch {
                        job: raw.job_id,
                        issuer: commands.issuer(),
                    });
                }
                let structural_commands = raw
                    .output
                    .structural_commands()
                    .map_or(0, StructuralCommandBuffer::command_count);
                profile_samples.push(JobProfileSample::new(
                    raw.job_id,
                    epoch,
                    worker_index,
                    raw.elapsed_ns,
                    structural_commands,
                ));
                completed.push(CompletedJob {
                    job_id: raw.job_id,
                    worker_index,
                    elapsed_ns: raw.elapsed_ns,
                    output: raw.output,
                });
            }
        }

        self.next_epoch = self
            .next_epoch
            .checked_add(1)
            .ok_or(ExecutorError::EpochOverflow)?;
        for sample in profile_samples {
            self.profiler.record(sample);
        }
        Ok(ExecutionReport {
            epoch,
            ordered_jobs: completed,
        })
    }
}

struct RawJobResult {
    job_id: JobId,
    elapsed_ns: u128,
    output: JobOutput,
}
