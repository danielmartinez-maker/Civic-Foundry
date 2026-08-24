import { SimulationClock } from '../core/SimulationClock.ts';
import { CommandBus } from './CommandBus.ts';
import { DomainEventJournal } from './DomainEventJournal.ts';
import { InvariantRunner } from './InvariantRunner.ts';
import { RandomStreamRegistry } from './RandomStreamRegistry.ts';
import { SnapshotRegistry } from './SnapshotRegistry.ts';
import { SystemScheduler } from './SystemScheduler.ts';
import type { KernelStepContext, KernelSystemDefinition } from './KernelTypes.ts';

export type SimulationKernelOptions = Readonly<{
  clock: SimulationClock;
  seed: number;
}>;

export type KernelDiagnosticSnapshot = Readonly<{
  tick: number;
  systems: readonly string[];
  pendingCommands: number;
  nextCommandSequence: number;
  retainedEvents: number;
  nextEventSequence: number;
  randomStreams: Readonly<Record<string, number>>;
}>;

export class SimulationKernel {
  readonly clock: SimulationClock;
  readonly scheduler = new SystemScheduler();
  readonly commands = new CommandBus();
  readonly events = new DomainEventJournal();
  readonly random: RandomStreamRegistry;
  readonly invariants = new InvariantRunner();
  readonly snapshots = new SnapshotRegistry();

  private dirty = true;

  constructor(options: SimulationKernelOptions) {
    this.clock = options.clock;
    this.random = new RandomStreamRegistry(options.seed);

    this.invariants.register({
      id: 'kernel-clock-valid',
      cadence: { every: 1 },
      check: ({ tick }) => {
        if (!Number.isInteger(tick) || tick < 0) throw new Error('clock tick must be a non-negative integer');
      },
    });

    this.snapshots.register('kernel', () => this.captureKernelDiagnostics());
  }

  registerSystem(system: KernelSystemDefinition): void {
    this.scheduler.register(system);
    this.dirty = true;
  }

  compile(): void {
    this.scheduler.compile();
    this.dirty = false;
  }

  step(ticks = 1): void {
    if (!Number.isInteger(ticks) || !Number.isFinite(ticks) || ticks < 0) {
      throw new Error('ticks must be a non-negative integer');
    }
    if (ticks === 0) return;
    if (this.dirty) this.compile();

    for (let index = 0; index < ticks; index++) {
      this.clock.step(1);
      const context: KernelStepContext = Object.freeze({
        tick: this.clock.tick,
        commands: this.commands,
        events: this.events,
        random: this.random,
        snapshots: this.snapshots,
      });

      this.commands.dispatchReady(this.clock.tick, context);
      for (const system of this.scheduler.dueSystems(this.clock.tick)) system.execute(context);
      this.invariants.runDue(this.clock.tick, context);
    }
  }

  diagnosticSnapshot(): KernelDiagnosticSnapshot {
    return this.captureKernelDiagnostics();
  }

  private captureKernelDiagnostics(): KernelDiagnosticSnapshot {
    return Object.freeze({
      tick: this.clock.tick,
      systems: Object.freeze(this.scheduler.listSystems().map((system) => system.id)),
      pendingCommands: this.commands.pending().length,
      nextCommandSequence: this.commands.getNextSequence(),
      retainedEvents: this.events.list().length,
      nextEventSequence: this.events.getNextSequence(),
      randomStreams: this.random.snapshot(),
    });
  }
}
