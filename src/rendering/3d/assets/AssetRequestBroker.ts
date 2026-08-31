export type AssetRequestPriority = 0 | 1 | 2 | 3 | 4;

type QueueItem<T> = {
  readonly key: string;
  readonly priority: AssetRequestPriority;
  readonly sequence: number;
  readonly run: () => Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
  readonly promise: Promise<T>;
};

export class AssetRequestBroker<T> {
  private readonly maxConcurrent: number;
  private readonly queue: QueueItem<T>[] = [];
  private readonly shared = new Map<string, Promise<T>>();
  private sequence = 0;
  private active = 0;

  constructor(maxConcurrent = 4) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error('maxConcurrent must be a positive integer');
    }
    this.maxConcurrent = maxConcurrent;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get activeLoads(): number {
    return this.active;
  }

  enqueue(key: string, priority: AssetRequestPriority, run: () => Promise<T>): Promise<T> {
    const existing = this.shared.get(key);
    if (existing) return existing;

    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const item: QueueItem<T> = {
      key,
      priority,
      sequence: this.sequence,
      run,
      resolve,
      reject,
      promise,
    };
    this.sequence += 1;
    this.shared.set(key, promise);
    this.queue.push(item);
    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.pump();
    return promise;
  }

  private pump(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active += 1;
      void this.runItem(item);
    }
  }

  private async runItem(item: QueueItem<T>): Promise<void> {
    try {
      item.resolve(await item.run());
    } catch (error) {
      item.reject(error);
    } finally {
      this.active -= 1;
      if (this.shared.get(item.key) === item.promise) this.shared.delete(item.key);
      this.pump();
    }
  }
}
