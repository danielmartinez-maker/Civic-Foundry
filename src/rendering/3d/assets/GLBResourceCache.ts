type ResourceRecord<T> = {
  readonly resource: T;
  refs: number;
};

export class GLBResourceCache<T> {
  private readonly resources = new Map<string, ResourceRecord<T>>();

  get size(): number {
    return this.resources.size;
  }

  has(key: string): boolean {
    return this.resources.has(key);
  }

  get(key: string): T | undefined {
    return this.resources.get(key)?.resource;
  }

  set(key: string, resource: T): void {
    const existing = this.resources.get(key);
    if (existing) {
      if (existing.resource !== resource) throw new Error(`Resource cache key '${key}' is already occupied`);
      return;
    }
    this.resources.set(key, { resource, refs: 0 });
  }

  acquire(key: string): T {
    const entry = this.resources.get(key);
    if (!entry) throw new Error(`Resource '${key}' is not resident`);
    entry.refs += 1;
    return entry.resource;
  }

  release(key: string): number {
    const entry = this.resources.get(key);
    if (!entry) throw new Error(`Resource '${key}' is not resident`);
    if (entry.refs === 0) throw new Error(`Resource '${key}' refcount is already zero`);
    entry.refs -= 1;
    return entry.refs;
  }

  refCount(key: string): number {
    return this.resources.get(key)?.refs ?? 0;
  }

  evict(key: string): T | undefined {
    const entry = this.resources.get(key);
    if (!entry) return undefined;
    if (entry.refs !== 0) throw new Error(`Cannot evict referenced resource '${key}'`);
    this.resources.delete(key);
    return entry.resource;
  }

  clear(): void {
    for (const [key, entry] of this.resources) {
      if (entry.refs !== 0) throw new Error(`Cannot clear referenced resource '${key}'`);
    }
    this.resources.clear();
  }
}
