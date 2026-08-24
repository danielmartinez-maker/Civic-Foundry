import { isDue, validateCadence, type KernelInvariant, type KernelStepContext } from './KernelTypes.ts';

function ordinalCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class InvariantRunner {
  private readonly invariants = new Map<string, KernelInvariant>();

  register(invariant: KernelInvariant): void {
    if (invariant.id.trim().length === 0) throw new Error('invariant id must not be empty');
    if (this.invariants.has(invariant.id)) throw new Error(`duplicate invariant: ${invariant.id}`);
    validateCadence(invariant.cadence, `invariant ${invariant.id}`);
    this.invariants.set(invariant.id, Object.freeze({
      ...invariant,
      cadence: Object.freeze({ ...invariant.cadence }),
    }));
  }

  runDue(tick: number, context: KernelStepContext): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error('invariant tick must be a non-negative integer');
    for (const invariant of this.list()) {
      if (!isDue(invariant.cadence, tick)) continue;
      try {
        invariant.check(context);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`invariant failed [${invariant.id}] at tick ${tick}: ${detail}`, { cause: error });
      }
    }
  }

  list(): readonly KernelInvariant[] {
    return Object.freeze([...this.invariants.values()].sort((a, b) => ordinalCompare(a.id, b.id)));
  }
}
