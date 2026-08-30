use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::thread;
use std::time::Duration;

use prism_core::jobs::{WorkerPool, WorkerTask, WorkerTaskKey};

#[test]
fn zero_workers_are_rejected() {
    assert!(WorkerPool::new(0).is_err());
}

#[test]
fn batch_executes_every_task_exactly_once_and_sorts_results() {
    let pool = WorkerPool::new(4).expect("pool");
    let hits = Arc::new(AtomicUsize::new(0));
    let tasks = (0_u64..64)
        .rev()
        .map(|key| {
            let hits = Arc::clone(&hits);
            WorkerTask::new(WorkerTaskKey::new(key), move || {
                hits.fetch_add(1, Ordering::SeqCst);
                key * 2
            })
        })
        .collect();

    let results = pool.execute_batch(tasks).expect("batch");
    assert_eq!(hits.load(Ordering::SeqCst), 64);
    assert_eq!(results.len(), 64);
    for (expected, result) in results.iter().enumerate() {
        assert_eq!(result.key(), WorkerTaskKey::new(expected as u64));
        assert_eq!(*result.value(), expected as u64 * 2);
    }
}

#[test]
fn completion_timing_cannot_change_result_order() {
    let pool = WorkerPool::new(2).expect("pool");
    let tasks = vec![
        WorkerTask::new(WorkerTaskKey::new(1), || {
            thread::sleep(Duration::from_millis(25));
            10_u64
        }),
        WorkerTask::new(WorkerTaskKey::new(2), || 20_u64),
    ];

    let results = pool.execute_batch(tasks).expect("batch");
    assert_eq!(results[0].key(), WorkerTaskKey::new(1));
    assert_eq!(results[1].key(), WorkerTaskKey::new(2));
    assert_eq!(*results[0].value(), 10);
    assert_eq!(*results[1].value(), 20);
}

#[test]
fn same_pool_executes_multiple_barriered_batches() {
    let pool = WorkerPool::new(3).expect("pool");
    let first = pool
        .execute_batch(vec![WorkerTask::new(WorkerTaskKey::new(1), || 1_u64)])
        .expect("first batch");
    let second = pool
        .execute_batch(vec![WorkerTask::new(WorkerTaskKey::new(2), || 2_u64)])
        .expect("second batch");

    assert_eq!(*first[0].value(), 1);
    assert_eq!(*second[0].value(), 2);
}
