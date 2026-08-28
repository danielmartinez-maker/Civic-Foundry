use prism_core::jobs::{JobGraph, JobGraphError, JobId, JobSpec, ResourceId};

const WORLD: ResourceId = ResourceId::new(1);
const ECONOMY: ResourceId = ResourceId::new(2);

#[test]
fn compile_order_is_independent_of_registration_order() {
    let specs = [
        JobSpec::new(JobId::new(30), 0).read(WORLD).after(JobId::new(10)),
        JobSpec::new(JobId::new(10), 0).write(WORLD),
        JobSpec::new(JobId::new(20), -1).read(ECONOMY),
    ];

    let mut forward = JobGraph::new();
    for spec in specs.clone() {
        forward.add_job(spec).unwrap();
    }

    let mut reverse = JobGraph::new();
    for spec in specs.into_iter().rev() {
        reverse.add_job(spec).unwrap();
    }

    assert_eq!(
        forward.compile().unwrap().ordered_jobs(),
        reverse.compile().unwrap().ordered_jobs()
    );
    assert_eq!(
        forward.compile().unwrap().ordered_jobs(),
        &[JobId::new(20), JobId::new(10), JobId::new(30)]
    );
}

#[test]
fn unordered_writer_reader_hazard_is_rejected() {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(1), 0).write(WORLD))
        .unwrap();
    graph
        .add_job(JobSpec::new(JobId::new(2), 0).read(WORLD))
        .unwrap();

    assert_eq!(
        graph.compile(),
        Err(JobGraphError::UnorderedHazard {
            resource: WORLD,
            left: JobId::new(1),
            right: JobId::new(2),
        })
    );
}

#[test]
fn explicit_dependency_orders_a_shared_resource() {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(1), 0).write(WORLD))
        .unwrap();
    graph
        .add_job(
            JobSpec::new(JobId::new(2), 0)
                .read(WORLD)
                .after(JobId::new(1)),
        )
        .unwrap();

    assert_eq!(
        graph.compile().unwrap().ordered_jobs(),
        &[JobId::new(1), JobId::new(2)]
    );
}

#[test]
fn dependency_cycle_is_rejected() {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(1), 0).after(JobId::new(2)))
        .unwrap();
    graph
        .add_job(JobSpec::new(JobId::new(2), 0).after(JobId::new(1)))
        .unwrap();

    assert!(matches!(graph.compile(), Err(JobGraphError::Cycle(_))));
}
