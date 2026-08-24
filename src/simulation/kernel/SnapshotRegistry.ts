export type SnapshotProvider = () => unknown;

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function isolate(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(isolate);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source)) output[key] = isolate(source[key]);
    return output;
  }
  return value;
}

export class SnapshotRegistry {
  private readonly providers = new Map<string, SnapshotProvider>();

  register(id: string, provider: SnapshotProvider): void {
    if (id.trim().length === 0) throw new Error('snapshot provider id must not be empty');
    if (this.providers.has(id)) throw new Error(`duplicate snapshot provider: ${id}`);
    this.providers.set(id, provider);
  }

  capture(id: string): unknown {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`unknown snapshot provider: ${id}`);
    return isolate(provider());
  }

  captureAll(): Readonly<Record<string, unknown>> {
    const output: Record<string, unknown> = {};
    for (const id of this.listIds()) output[id] = this.capture(id);
    return Object.freeze(output);
  }

  listIds(): readonly string[] {
    return Object.freeze([...this.providers.keys()].sort(ordinalCompare));
  }
}
