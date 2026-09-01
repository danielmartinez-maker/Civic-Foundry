type PerformanceRecord = {
  readonly durations: number[];
  budgetMs?: number;
  cacheHits: number;
  cacheMisses: number;
};

export type PerformanceMetric = Readonly<{
  calls: number;
  averageMs: number;
  p95Ms: number;
  maxMs: number;
  overBudget: number;
  cacheHitRate: number | null;
}>;

export type PerformanceRecordOptions = Readonly<{
  budgetMs?: number;
  cache?: "hit" | "miss";
}>;

export class PerformanceAttribution {
  private readonly records = new Map<string, PerformanceRecord>();

  record(operation: string, durationMs: number, options: PerformanceRecordOptions = {}): void {
    if (!operation || operation.trim().length === 0) throw new Error("performance operation must not be empty");
    if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error(`invalid duration for ${operation}`);
    if (options.budgetMs !== undefined && (!Number.isFinite(options.budgetMs) || options.budgetMs < 0)) {
      throw new Error(`invalid performance budget for ${operation}`);
    }
    let record = this.records.get(operation);
    if (record === undefined) {
      record = { durations: [], budgetMs: options.budgetMs, cacheHits: 0, cacheMisses: 0 };
      this.records.set(operation, record);
    } else if (options.budgetMs !== undefined) {
      record.budgetMs = options.budgetMs;
    }
    record.durations.push(durationMs);
    if (options.cache === "hit") record.cacheHits += 1;
    if (options.cache === "miss") record.cacheMisses += 1;
  }

  snapshot(): Readonly<Record<string, PerformanceMetric>> {
    const result: Record<string, PerformanceMetric> = {};
    for (const [operation, record] of [...this.records.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const durations = record.durations.slice().sort((a, b) => a - b);
      const calls = durations.length;
      const total = durations.reduce((sum, value) => sum + value, 0);
      const p95Index = Math.max(0, Math.ceil(calls * 0.95) - 1);
      const cacheSamples = record.cacheHits + record.cacheMisses;
      result[operation] = Object.freeze({
        calls,
        averageMs: calls === 0 ? 0 : total / calls,
        p95Ms: calls === 0 ? 0 : durations[p95Index]!,
        maxMs: calls === 0 ? 0 : durations[calls - 1]!,
        overBudget:
          record.budgetMs === undefined
            ? 0
            : durations.filter((value) => value > record.budgetMs!).length,
        cacheHitRate: cacheSamples === 0 ? null : record.cacheHits / cacheSamples,
      });
    }
    return Object.freeze(result);
  }

  reset(): void {
    this.records.clear();
  }
}
