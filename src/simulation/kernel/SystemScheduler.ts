import { isDue, validateCadence, type KernelSystemDefinition, type SystemCadence } from './KernelTypes.ts';

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

function cadencesOverlap(a: SystemCadence, b: SystemCadence): boolean {
  const ao = a.offset ?? 0;
  const bo = b.offset ?? 0;
  return (ao - bo) % gcd(a.every, b.every) === 0;
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

function normalized(system: KernelSystemDefinition): KernelSystemDefinition {
  const id = system.id;
  if (id.trim().length === 0) throw new Error('kernel system id must not be empty');
  validateCadence(system.cadence, `system ${id}`);
  if (system.order !== undefined && !Number.isFinite(system.order)) throw new Error(`invalid order for system ${id}`);

  const reads = [...system.reads];
  const writes = [...system.writes];
  const after = [...(system.after ?? [])];
  const before = [...(system.before ?? [])];

  const duplicateRead = duplicate(reads);
  if (duplicateRead !== undefined) throw new Error(`duplicate read domain for system ${id}: ${duplicateRead}`);
  const duplicateWrite = duplicate(writes);
  if (duplicateWrite !== undefined) throw new Error(`duplicate write domain for system ${id}: ${duplicateWrite}`);

  const readSet = new Set(reads);
  const readWrite = writes.find((value) => readSet.has(value));
  if (readWrite !== undefined) throw new Error(`domain declared as read and write for system ${id}: ${readWrite}`);
  if (after.includes(id) || before.includes(id)) throw new Error(`self dependency for kernel system ${id}`);

  return Object.freeze({
    ...system,
    reads: Object.freeze(reads),
    writes: Object.freeze(writes),
    cadence: Object.freeze({ ...system.cadence }),
    after: Object.freeze(after),
    before: Object.freeze(before),
  });
}

export class SystemScheduler {
  private readonly systems = new Map<string, KernelSystemDefinition>();
  private compiled: readonly KernelSystemDefinition[] | null = null;

  register(system: KernelSystemDefinition): void {
    const value = normalized(system);
    if (this.systems.has(value.id)) throw new Error(`duplicate kernel system: ${value.id}`);
    this.systems.set(value.id, value);
    this.compiled = null;
  }

  compile(): readonly KernelSystemDefinition[] {
    const ids = [...this.systems.keys()].sort(ordinalCompare);
    const outgoing = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
    const indegree = new Map<string, number>(ids.map((id) => [id, 0]));

    const addEdge = (from: string, to: string): void => {
      if (!this.systems.has(from) || !this.systems.has(to)) throw new Error(`unknown kernel dependency: ${from} -> ${to}`);
      const edges = outgoing.get(from)!;
      if (edges.has(to)) return;
      edges.add(to);
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    };

    for (const id of ids) {
      const system = this.systems.get(id)!;
      for (const dependency of system.after ?? []) addEdge(dependency, id);
      for (const dependency of system.before ?? []) addEdge(id, dependency);
    }

    const reaches = (start: string, target: string): boolean => {
      const stack = [...(outgoing.get(start) ?? [])];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (id === target) return true;
        if (seen.has(id)) continue;
        seen.add(id);
        for (const next of outgoing.get(id) ?? []) stack.push(next);
      }
      return false;
    };

    for (let i = 0; i < ids.length; i++) {
      const a = this.systems.get(ids[i]!)!;
      for (let j = i + 1; j < ids.length; j++) {
        const b = this.systems.get(ids[j]!)!;
        if (!cadencesOverlap(a.cadence, b.cadence)) continue;
        const ordered = reaches(a.id, b.id) || reaches(b.id, a.id);
        const sharedWrite = a.writes.find((domain) => b.writes.includes(domain));
        if (sharedWrite !== undefined && !ordered) {
          throw new Error(`ambiguous write conflict on domain ${sharedWrite}: ${a.id}, ${b.id}`);
        }
        const aWriteBRead = a.writes.find((domain) => b.reads.includes(domain));
        const bWriteARead = b.writes.find((domain) => a.reads.includes(domain));
        const readWriteDomain = aWriteBRead ?? bWriteARead;
        if (readWriteDomain !== undefined && !ordered) {
          throw new Error(`ambiguous read/write conflict on domain ${readWriteDomain}: ${a.id}, ${b.id}`);
        }
      }
    }

    const priorityCompare = (a: string, b: string): number => {
      const sa = this.systems.get(a)!;
      const sb = this.systems.get(b)!;
      const order = (sa.order ?? 0) - (sb.order ?? 0);
      return order !== 0 ? order : ordinalCompare(a, b);
    };

    const available = ids.filter((id) => indegree.get(id) === 0).sort(priorityCompare);
    const result: KernelSystemDefinition[] = [];
    while (available.length > 0) {
      const id = available.shift()!;
      result.push(this.systems.get(id)!);
      const nextIds = [...(outgoing.get(id) ?? [])].sort(ordinalCompare);
      for (const next of nextIds) {
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) {
          available.push(next);
          available.sort(priorityCompare);
        }
      }
    }

    if (result.length !== ids.length) {
      const participants = ids.filter((id) => (indegree.get(id) ?? 0) > 0).sort(ordinalCompare);
      throw new Error(`kernel dependency cycle: ${participants.join(' -> ')}`);
    }

    this.compiled = Object.freeze(result.slice());
    return this.compiled;
  }

  dueSystems(tick: number): readonly KernelSystemDefinition[] {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('kernel tick must be a non-negative integer');
    const ordered = this.compiled ?? this.compile();
    return Object.freeze(ordered.filter((system) => isDue(system.cadence, tick)));
  }

  listSystems(): readonly KernelSystemDefinition[] {
    return Object.freeze([...this.systems.values()].sort((a, b) => ordinalCompare(a.id, b.id)));
  }
}
