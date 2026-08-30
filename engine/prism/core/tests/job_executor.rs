use std::thread;
use std::time::Duration;

use prism_core::ecs::StructuralCommandBuffer;
use prism_core::jobs::{
    ExecutableJob, ExecutionEpoch, ExecutorError, JobGraph, JobId, JobOutput, JobSpec,
    PrismExecutor,
};

fn independent_graph() -> prism_core::jobs::CompiledJobGraph {
    let mut graph = JobGraph::new();
    graph
        .add_job(JobSpec::new(JobId::new(20), 10))
        .expect("job 20");
    graph
        .add_job(JobSpec::new(JobId::new(10), 20))
        .expect("job 10");
    graph.compile().expect("compiled")
}

fn jobs() -> Vec<ExecutableJob> {
    vec![
        ExecutableJob::new(JobId::new(20), || {
            thread::sleep(Duration::from_millis(20));
            let mut commands = StructuralCommandBuffer::new(JobId::new(20));
            commands.note();
            JobOutput::new(200).with_structural_commands(commands)
        }),
        ExecutableJob::new(JobId::new(10), || JobOutput::new(100)),
    ]
}

#[test]
fn executor_returns_graph_order_not_worker_completion_order() {
    let graph = independent_graph();
    let mut executor = PrismExecutor::new(2).expect("executor");
    let report = executor.execute(&graph, &jobs()).expect("execution");

    assert_eq!(report.epoch(), ExecutionEpoch::new(0));
    assert_eq!(report.ordered_jobs()[0].job_id(), JobId::new(20));
    assert_eq!(report.ordered_jobs()[1].job_id(), JobId::new(10));
    assert_eq!(report.ordered_jobs()[0].output().deterministic_value(), 200);
    assert_eq!(report.ordered_jobs()[1].output().deterministic_value(), 100);
}

#[test]
fn epoch_advances_once_per_completed_graph() {
    let graph = independent_graph();
    let mut executor = PrismExecutor::new(2).expect("executor");

    assert_eq!(
        executor.execute(&graph, &jobs()).expect("first").epoch(),
        ExecutionEpoch::new(0)
    );
    assert_eq!(
        executor.execute(&graph, &jobs()).expect("second").epoch(),
        ExecutionEpoch::new(1)
    );
}

#[test]
fn executor_rejects_missing_executable_job_before_dispatch() {
    let graph = independent_graph();
    let mut executor = PrismExecutor::new(2).expect("executor");
    let partial = vec![ExecutableJob::new(JobId::new(20), || JobOutput::new(1))];

    assert!(matches!(
        executor.execute(&graph, &partial),
        Err(ExecutorError::MissingJob(id)) if id == JobId::new(10)
    ));
}

#[test]
fn executor_rejects_structural_buffer_with_forged_issuer() {
    let graph = independent_graph();
    let mut executor = PrismExecutor::new(2).expect("executor");
    let malicious = vec![
        ExecutableJob::new(JobId::new(20), || {
            let mut commands = StructuralCommandBuffer::new(JobId::new(999));
            commands.note();
            JobOutput::new(200).with_structural_commands(commands)
        }),
        ExecutableJob::new(JobId::new(10), || JobOutput::new(100)),
    ];

    assert!(matches!(
        executor.execute(&graph, &malicious),
        Err(ExecutorError::StructuralIssuerMismatch { job, issuer })
            if job == JobId::new(20) && issuer == JobId::new(999)
    ));
}

#[test]
fn profiling_is_stable_by_job_identity_and_tracks_command_counts() {
    let graph = independent_graph();
    let mut executor = PrismExecutor::new(2).expect("executor");
    executor.execute(&graph, &jobs()).expect("execution");

    let snapshot = executor.profiler().snapshot();
    assert_eq!(snapshot.len(), 2);
    assert_eq!(snapshot[0].job_id(), JobId::new(10));
    assert_eq!(snapshot[1].job_id(), JobId::new(20));
    assert_eq!(snapshot[0].invocations(), 1);
    assert_eq!(snapshot[1].invocations(), 1);
    assert_eq!(snapshot[0].total_structural_commands(), 0);
    assert_eq!(snapshot[1].total_structural_commands(), 1);
}
