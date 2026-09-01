export type CausalTraceInput = Readonly<{
  code: string;
  domain: string;
  operation: string;
  tick: number;
  parentSequence?: number;
  entityIds?: readonly string[];
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type CausalTraceEntry = CausalTraceInput &
  Readonly<{
    sequence: number;
  }>;

export class CausalTraceBuffer {
  private readonly entries: CausalTraceEntry[] = [];
  private nextSequence = 1;

  constructor(readonly capacity = 256) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new Error("causal trace capacity must be a positive integer");
    }
  }

  append(input: CausalTraceInput): CausalTraceEntry {
    const entry = Object.freeze({
      ...input,
      sequence: this.nextSequence++,
      entityIds:
        input.entityIds === undefined
          ? undefined
          : Object.freeze([...input.entityIds]),
      details:
        input.details === undefined
          ? undefined
          : Object.freeze(
              Object.fromEntries(
                Object.entries(input.details).sort(([a], [b]) =>
                  a.localeCompare(b),
                ),
              ),
            ),
    });
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    return entry;
  }

  list(): readonly CausalTraceEntry[] {
    return Object.freeze(this.entries.slice());
  }

  clear(): void {
    this.entries.length = 0;
  }

  snapshot(): Readonly<{
    capacity: number;
    nextSequence: number;
    entries: readonly CausalTraceEntry[];
  }> {
    return Object.freeze({
      capacity: this.capacity,
      nextSequence: this.nextSequence,
      entries: this.list(),
    });
  }
}
