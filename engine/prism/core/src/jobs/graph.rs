use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct JobId(u64);

impl JobId {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct ResourceId(u64);

impl ResourceId {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AccessKind {
    Read,
    Write,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ResourceAccess {
    resource: ResourceId,
    kind: AccessKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct JobSpec {
    id: JobId,
    order: i32,
    accesses: Vec<ResourceAccess>,
    after: Vec<JobId>,
}

impl JobSpec {
    #[must_use]
    pub fn new(id: JobId, order: i32) -> Self {
        Self {
            id,
            order,
            accesses: Vec::new(),
            after: Vec::new(),
        }
    }

    #[must_use]
    pub fn read(mut self, resource: ResourceId) -> Self {
        self.accesses.push(ResourceAccess {
            resource,
            kind: AccessKind::Read,
        });
        self
    }

    #[must_use]
    pub fn write(mut self, resource: ResourceId) -> Self {
        self.accesses.push(ResourceAccess {
            resource,
            kind: AccessKind::Write,
        });
        self
    }

    #[must_use]
    pub fn after(mut self, predecessor: JobId) -> Self {
        self.after.push(predecessor);
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobGraphError {
    DuplicateJob(JobId),
    DuplicateResourceAccess {
        job: JobId,
        resource: ResourceId,
    },
    UnknownDependency {
        job: JobId,
        dependency: JobId,
    },
    Cycle(Vec<JobId>),
    UnorderedHazard {
        resource: ResourceId,
        left: JobId,
        right: JobId,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CompiledJobGraph {
    ordered: Vec<JobId>,
}

impl CompiledJobGraph {
    #[must_use]
    pub fn ordered_jobs(&self) -> &[JobId] {
        &self.ordered
    }
}

#[derive(Default)]
pub struct JobGraph {
    jobs: BTreeMap<JobId, JobSpec>,
}

impl JobGraph {
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_job(&mut self, spec: JobSpec) -> Result<(), JobGraphError> {
        if self.jobs.contains_key(&spec.id) {
            return Err(JobGraphError::DuplicateJob(spec.id));
        }

        let mut resources = BTreeSet::new();
        for access in &spec.accesses {
            if !resources.insert(access.resource) {
                return Err(JobGraphError::DuplicateResourceAccess {
                    job: spec.id,
                    resource: access.resource,
                });
            }
        }

        self.jobs.insert(spec.id, spec);
        Ok(())
    }

    pub fn compile(&self) -> Result<CompiledJobGraph, JobGraphError> {
        let mut outgoing = BTreeMap::<JobId, BTreeSet<JobId>>::new();
        let mut indegree = BTreeMap::<JobId, usize>::new();

        for id in self.jobs.keys().copied() {
            outgoing.insert(id, BTreeSet::new());
            indegree.insert(id, 0);
        }

        for spec in self.jobs.values() {
            for dependency in &spec.after {
                if !self.jobs.contains_key(dependency) {
                    return Err(JobGraphError::UnknownDependency {
                        job: spec.id,
                        dependency: *dependency,
                    });
                }
                if outgoing.get_mut(dependency).unwrap().insert(spec.id) {
                    *indegree.get_mut(&spec.id).unwrap() += 1;
                }
            }
        }

        let mut available = BTreeSet::<(i32, JobId)>::new();
        for (id, degree) in &indegree {
            if *degree == 0 {
                available.insert((self.jobs[id].order, *id));
            }
        }

        let mut ordered = Vec::with_capacity(self.jobs.len());
        let mut remaining = indegree.clone();
        while let Some(&(order, id)) = available.first() {
            available.remove(&(order, id));
            ordered.push(id);
            for next in outgoing[&id].iter().copied() {
                let degree = remaining.get_mut(&next).unwrap();
                *degree -= 1;
                if *degree == 0 {
                    available.insert((self.jobs[&next].order, next));
                }
            }
        }

        if ordered.len() != self.jobs.len() {
            let participants = remaining
                .into_iter()
                .filter_map(|(id, degree)| (degree > 0).then_some(id))
                .collect();
            return Err(JobGraphError::Cycle(participants));
        }

        let ids: Vec<_> = self.jobs.keys().copied().collect();
        for (offset, left) in ids.iter().copied().enumerate() {
            for right in ids.iter().copied().skip(offset + 1) {
                if let Some(resource) = conflicting_resource(&self.jobs[&left], &self.jobs[&right])
                    && !reaches(left, right, &outgoing)
                    && !reaches(right, left, &outgoing)
                {
                    return Err(JobGraphError::UnorderedHazard {
                        resource,
                        left,
                        right,
                    });
                }
            }
        }

        Ok(CompiledJobGraph { ordered })
    }
}

fn conflicting_resource(left: &JobSpec, right: &JobSpec) -> Option<ResourceId> {
    for left_access in &left.accesses {
        for right_access in &right.accesses {
            if left_access.resource == right_access.resource
                && (left_access.kind == AccessKind::Write || right_access.kind == AccessKind::Write)
            {
                return Some(left_access.resource);
            }
        }
    }
    None
}

fn reaches(start: JobId, target: JobId, outgoing: &BTreeMap<JobId, BTreeSet<JobId>>) -> bool {
    let mut stack: Vec<_> = outgoing[&start].iter().rev().copied().collect();
    let mut seen = BTreeSet::new();
    while let Some(id) = stack.pop() {
        if id == target {
            return true;
        }
        if !seen.insert(id) {
            continue;
        }
        stack.extend(outgoing[&id].iter().rev().copied());
    }
    false
}
