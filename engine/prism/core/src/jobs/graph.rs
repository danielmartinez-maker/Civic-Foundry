use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct JobId(u32);

impl JobId {
    pub const fn new(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ResourceId(u32);

impl ResourceId {
    pub const fn new(value: u32) -> Self {
        Self(value)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JobSpec {
    pub id: JobId,
    pub priority: i32,
    reads: BTreeSet<ResourceId>,
    writes: BTreeSet<ResourceId>,
    after: BTreeSet<JobId>,
}

impl JobSpec {
    pub fn new(id: JobId, priority: i32) -> Self {
        Self {
            id,
            priority,
            reads: BTreeSet::new(),
            writes: BTreeSet::new(),
            after: BTreeSet::new(),
        }
    }

    pub fn read(mut self, resource: ResourceId) -> Self {
        self.reads.insert(resource);
        self
    }

    pub fn write(mut self, resource: ResourceId) -> Self {
        self.writes.insert(resource);
        self
    }

    pub fn after(mut self, dependency: JobId) -> Self {
        self.after.insert(dependency);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompiledJobGraph {
    ordered: Vec<JobId>,
}

impl CompiledJobGraph {
    pub fn ordered_jobs(&self) -> &[JobId] {
        &self.ordered
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JobGraphError {
    DuplicateJob(JobId),
    MissingDependency { job: JobId, dependency: JobId },
    Cycle(Vec<JobId>),
    UnorderedHazard {
        resource: ResourceId,
        left: JobId,
        right: JobId,
    },
}

#[derive(Default)]
pub struct JobGraph {
    jobs: BTreeMap<JobId, JobSpec>,
}

impl JobGraph {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_job(&mut self, spec: JobSpec) -> Result<(), JobGraphError> {
        if self.jobs.contains_key(&spec.id) {
            return Err(JobGraphError::DuplicateJob(spec.id));
        }
        self.jobs.insert(spec.id, spec);
        Ok(())
    }

    pub fn compile(&self) -> Result<CompiledJobGraph, JobGraphError> {
        let mut outgoing = BTreeMap::<JobId, BTreeSet<JobId>>::new();
        let mut indegree = BTreeMap::<JobId, usize>::new();

        for job in self.jobs.values() {
            outgoing.entry(job.id).or_default();
            indegree.entry(job.id).or_insert(0);
        }

        for job in self.jobs.values() {
            for dependency in &job.after {
                if !self.jobs.contains_key(dependency) {
                    return Err(JobGraphError::MissingDependency {
                        job: job.id,
                        dependency: *dependency,
                    });
                }
                if outgoing.entry(*dependency).or_default().insert(job.id) {
                    *indegree.entry(job.id).or_insert(0) += 1;
                }
            }
        }

        self.validate_resource_hazards(&outgoing)?;

        let mut ready = BinaryHeap::new();
        for (&job_id, &degree) in &indegree {
            if degree == 0 {
                let priority = self.jobs[&job_id].priority;
                ready.push(Reverse((priority, job_id)));
            }
        }

        let mut ordered = Vec::with_capacity(self.jobs.len());
        while let Some(Reverse((_priority, job_id))) = ready.pop() {
            ordered.push(job_id);
            if let Some(next_jobs) = outgoing.get(&job_id) {
                for next in next_jobs {
                    let degree = indegree
                        .get_mut(next)
                        .expect("compiled job must have indegree");
                    *degree -= 1;
                    if *degree == 0 {
                        ready.push(Reverse((self.jobs[next].priority, *next)));
                    }
                }
            }
        }

        if ordered.len() != self.jobs.len() {
            let cycle_nodes = indegree
                .into_iter()
                .filter_map(|(job_id, degree)| (degree > 0).then_some(job_id))
                .collect();
            return Err(JobGraphError::Cycle(cycle_nodes));
        }

        Ok(CompiledJobGraph { ordered })
    }

    fn validate_resource_hazards(
        &self,
        outgoing: &BTreeMap<JobId, BTreeSet<JobId>>,
    ) -> Result<(), JobGraphError> {
        let job_ids: Vec<_> = self.jobs.keys().copied().collect();
        for (offset, &left_id) in job_ids.iter().enumerate() {
            for &right_id in &job_ids[offset + 1..] {
                let left = &self.jobs[&left_id];
                let right = &self.jobs[&right_id];

                for resource in left
                    .writes
                    .iter()
                    .copied()
                    .filter(|resource| {
                        right.reads.contains(resource) || right.writes.contains(resource)
                    })
                    .chain(right.writes.iter().copied().filter(|resource| {
                        left.reads.contains(resource) || left.writes.contains(resource)
                    }))
                {
                    if !has_path(left_id, right_id, outgoing)
                        && !has_path(right_id, left_id, outgoing)
                    {
                        return Err(JobGraphError::UnorderedHazard {
                            resource,
                            left: left_id,
                            right: right_id,
                        });
                    }
                }
            }
        }
        Ok(())
    }
}

fn has_path(from: JobId, to: JobId, outgoing: &BTreeMap<JobId, BTreeSet<JobId>>) -> bool {
    let mut stack = vec![from];
    let mut visited = BTreeSet::new();

    while let Some(current) = stack.pop() {
        if !visited.insert(current) {
            continue;
        }
        if current == to {
            return true;
        }
        if let Some(next) = outgoing.get(&current) {
            stack.extend(next.iter().rev().copied());
        }
    }

    false
}
