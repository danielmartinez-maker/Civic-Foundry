use prism_core::jobs::{JobGraph, JobGraphError, JobId, JobSpec, ResourceId};

fn diamond_graph(reverse: bool) -> JobGraph {
    let specs = vec![
        JobSpec::new(JobId::new(1), 10).write(ResourceId::new(1)),
        JobSpec::new(JobId::new(2), 20)
            .read(ResourceId::new(1))
            .write(ResourceId::new(2))
            .after(JobId::new(1)),
        JobSpec::new(JobId::new(3), 20)
            .read(ResourceId::new(1))
            .write(ResourceId::new(3))
            .after(JobId::new(1)),
        JobSpec::new(JobId::new(4), 30)
            .read(ResourceId::new(2))
            .read(ResourceId::new(3))
            .after(JobId::new(2))
            .after(JobId::new(3)),
    ];
    let mut graph = JobGraph::new();
    if reverse {
        for spec in specs.into_iter().rev() {
            graph.add_job(spec).expect("job");
        }
    } else {
        for spec in specs {
            graph.add_job(spec).expect("job");
        }
    }
    graph
}

#[test]
fn diamond_graph_compiles_into_parallel_middle_wave() {
    let compiled = diamond_graph(false).compile().expect("compiled");
    assert_eq!(
        compiled.waves(),
        &[
            vec![JobId::new(1)],
            vec![JobId::new(2), JobId::new(3)],
            vec![JobId::new(4)],
        ]
    );
}

#[test]
fn reversed_registration_order_cannot_change_waves() {
    assert_eq!(
        diamond_graph(false).compile().expect("forward").waves(),
        diamond_graph(true).compile().expect("reverse").waves()
    );
}

#[test]
fn unordered_write_hazard_is_still_rejected() {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(1), 0).write(ResourceId::new(8)))
        .expect("job");
    graph
        .add_job(JobSpec::new(JobId::new(2), 0).read(ResourceId::new(8)))
        .expect("job");

    assert!(matches!(
        graph.compile(),
        Err(JobGraphError::UnorderedHazard { .. })
    ));
}
