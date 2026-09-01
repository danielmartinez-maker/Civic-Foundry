use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, mpsc};
use std::thread::{self, JoinHandle};

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct WorkerTaskKey(u64);

impl WorkerTaskKey {
    #[must_use]
    pub const fn new(value: u64) -> Self {
        Self(value)
    }

    #[must_use]
    pub const fn value(self) -> u64 {
        self.0
    }
}

pub struct WorkerTask<R> {
    key: WorkerTaskKey,
    work: Box<dyn FnOnce() -> R + Send + 'static>,
}

impl<R> WorkerTask<R> {
    pub fn new<F>(key: WorkerTaskKey, work: F) -> Self
    where
        F: FnOnce() -> R + Send + 'static,
    {
        Self {
            key,
            work: Box::new(work),
        }
    }
}

#[derive(Debug)]
pub struct WorkerTaskResult<R> {
    key: WorkerTaskKey,
    worker_index: usize,
    value: R,
}

impl<R> WorkerTaskResult<R> {
    #[must_use]
    pub const fn key(&self) -> WorkerTaskKey {
        self.key
    }

    #[must_use]
    pub const fn worker_index(&self) -> usize {
        self.worker_index
    }

    #[must_use]
    pub const fn value(&self) -> &R {
        &self.value
    }

    #[must_use]
    pub fn into_value(self) -> R {
        self.value
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkerPoolError {
    ZeroWorkers,
    DuplicateTaskKey(WorkerTaskKey),
    WorkerDisconnected,
}

struct WorkEnvelope {
    run: Box<dyn FnOnce(usize) + Send + 'static>,
}

#[derive(Default)]
struct PoolState {
    queued: usize,
    shutdown: bool,
}

struct SharedPool {
    queues: Vec<Mutex<VecDeque<WorkEnvelope>>>,
    state: Mutex<PoolState>,
    wake: Condvar,
}

pub struct WorkerPool {
    shared: Arc<SharedPool>,
    workers: Vec<JoinHandle<()>>,
    batch_lock: Mutex<()>,
}

impl WorkerPool {
    pub fn new(worker_count: usize) -> Result<Self, WorkerPoolError> {
        if worker_count == 0 {
            return Err(WorkerPoolError::ZeroWorkers);
        }
        let shared = Arc::new(SharedPool {
            queues: (0..worker_count)
                .map(|_| Mutex::new(VecDeque::new()))
                .collect(),
            state: Mutex::new(PoolState::default()),
            wake: Condvar::new(),
        });
        let mut workers = Vec::with_capacity(worker_count);
        for worker_index in 0..worker_count {
            let shared = Arc::clone(&shared);
            workers.push(thread::spawn(move || worker_loop(shared, worker_index)));
        }
        Ok(Self {
            shared,
            workers,
            batch_lock: Mutex::new(()),
        })
    }

    #[must_use]
    pub fn worker_count(&self) -> usize {
        self.workers.len()
    }

    pub fn execute_batch<R>(
        &self,
        mut tasks: Vec<WorkerTask<R>>,
    ) -> Result<Vec<WorkerTaskResult<R>>, WorkerPoolError>
    where
        R: Send + 'static,
    {
        let _batch_guard = self.batch_lock.lock().expect("worker batch lock poisoned");
        tasks.sort_unstable_by_key(|task| task.key);
        for pair in tasks.windows(2) {
            if pair[0].key == pair[1].key {
                return Err(WorkerPoolError::DuplicateTaskKey(pair[0].key));
            }
        }
        if tasks.is_empty() {
            return Ok(Vec::new());
        }

        let task_count = tasks.len();
        let (sender, receiver) = mpsc::channel::<WorkerTaskResult<R>>();
        {
            let mut state = self
                .shared
                .state
                .lock()
                .expect("worker state lock poisoned");
            for (ordinal, task) in tasks.into_iter().enumerate() {
                let key = task.key;
                let work = task.work;
                let sender = sender.clone();
                let envelope = WorkEnvelope {
                    run: Box::new(move |worker_index| {
                        let value = work();
                        let _ = sender.send(WorkerTaskResult {
                            key,
                            worker_index,
                            value,
                        });
                    }),
                };
                let queue_index = ordinal % self.shared.queues.len();
                self.shared.queues[queue_index]
                    .lock()
                    .expect("worker queue lock poisoned")
                    .push_back(envelope);
            }
            state.queued = state
                .queued
                .checked_add(task_count)
                .expect("worker queued count overflow");
        }
        drop(sender);
        self.shared.wake.notify_all();

        let mut results = Vec::with_capacity(task_count);
        for _ in 0..task_count {
            results.push(
                receiver
                    .recv()
                    .map_err(|_| WorkerPoolError::WorkerDisconnected)?,
            );
        }
        results.sort_unstable_by_key(WorkerTaskResult::key);
        Ok(results)
    }
}

impl Drop for WorkerPool {
    fn drop(&mut self) {
        {
            let mut state = self
                .shared
                .state
                .lock()
                .expect("worker state lock poisoned");
            state.shutdown = true;
        }
        self.shared.wake.notify_all();
        for worker in self.workers.drain(..) {
            let _ = worker.join();
        }
    }
}

fn worker_loop(shared: Arc<SharedPool>, worker_index: usize) {
    loop {
        {
            let mut state = shared.state.lock().expect("worker state lock poisoned");
            while state.queued == 0 && !state.shutdown {
                state = shared.wake.wait(state).expect("worker state lock poisoned");
            }
            if state.shutdown && state.queued == 0 {
                return;
            }
        }

        let Some(envelope) = take_work(&shared, worker_index) else {
            thread::yield_now();
            continue;
        };
        {
            let mut state = shared.state.lock().expect("worker state lock poisoned");
            state.queued = state
                .queued
                .checked_sub(1)
                .expect("queued work must be positive when task is claimed");
        }
        (envelope.run)(worker_index);
    }
}

fn take_work(shared: &SharedPool, worker_index: usize) -> Option<WorkEnvelope> {
    if let Some(work) = shared.queues[worker_index]
        .lock()
        .expect("worker queue lock poisoned")
        .pop_front()
    {
        return Some(work);
    }
    for candidate in 0..shared.queues.len() {
        if candidate == worker_index {
            continue;
        }
        if let Some(work) = shared.queues[candidate]
            .lock()
            .expect("worker queue lock poisoned")
            .pop_back()
        {
            return Some(work);
        }
    }
    None
}
