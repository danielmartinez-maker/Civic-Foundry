type CacheState = {
  readonly dependencies: readonly string[];
  observed: Record<string, number>;
};

export type CacheRevisionStatus = Readonly<{
  cache: string;
  needsRebuild: boolean;
  dependencies: readonly string[];
  reason: string | null;
}>;

export class RevisionRegistry {
  private readonly revisions = new Map<string, number>();
  private readonly mutationReasons = new Map<string, string>();
  private readonly caches = new Map<string, CacheState>();

  ensure(authority: string): number {
    if (!authority || authority.trim().length === 0) {
      throw new Error("revision authority must not be empty");
    }
    if (!this.revisions.has(authority)) this.revisions.set(authority, 0);
    return this.revisions.get(authority)!;
  }

  current(authority: string): number {
    return this.ensure(authority);
  }

  recordMutation(authority: string, changed: boolean, reason: string): number {
    const current = this.ensure(authority);
    if (!changed) return current;
    const next = current + 1;
    this.revisions.set(authority, next);
    this.mutationReasons.set(authority, reason);
    return next;
  }

  declareCache(cache: string, dependencies: readonly string[]): void {
    if (!cache || cache.trim().length === 0) throw new Error("cache id must not be empty");
    if (this.caches.has(cache)) throw new Error(`duplicate revision cache: ${cache}`);
    const unique = [...new Set(dependencies)].sort((a, b) => a.localeCompare(b));
    for (const dependency of unique) this.ensure(dependency);
    this.caches.set(cache, { dependencies: Object.freeze(unique), observed: {} });
  }

  markRebuilt(cache: string): void {
    const state = this.requireCache(cache);
    state.observed = Object.fromEntries(
      state.dependencies.map((dependency) => [dependency, this.current(dependency)]),
    );
  }

  needsRebuild(cache: string): boolean {
    const state = this.requireCache(cache);
    return state.dependencies.some(
      (dependency) => (state.observed[dependency] ?? -1) !== this.current(dependency),
    );
  }

  cacheStatus(cache: string): CacheRevisionStatus {
    const state = this.requireCache(cache);
    const changed = state.dependencies.filter(
      (dependency) => (state.observed[dependency] ?? -1) !== this.current(dependency),
    );
    const reason =
      changed.length === 0
        ? null
        : (this.mutationReasons.get(changed[0]!) ?? `${changed[0]}-revision-changed`);
    return Object.freeze({
      cache,
      needsRebuild: changed.length > 0,
      dependencies: state.dependencies,
      reason,
    });
  }

  snapshot(): Readonly<Record<string, number>> {
    return Object.freeze(
      Object.fromEntries(
        [...this.revisions.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  }

  private requireCache(cache: string): CacheState {
    const state = this.caches.get(cache);
    if (state === undefined) throw new Error(`unknown revision cache: ${cache}`);
    return state;
  }
}
