import { SimulationClock } from '../core/SimulationClock.ts';
import { CommandBus, type CommandBusSnapshot } from './CommandBus.ts';
import { DomainEventJournal, type DomainEventJournalSnapshot } from './DomainEventJournal.ts';
import { InvariantRunner } from './InvariantRunner.ts';
import { RandomStreamRegistry, type RandomStreamSnapshot } from './RandomStreamRegistry.ts';
import { SnapshotRegistry } from './SnapshotRegistry.ts';
import { SystemScheduler } from './SystemScheduler.ts';
import type { KernelStepContext, KernelSystemDefinition } from './KernelTypes.ts';

export type SimulationKernelOptions = Readonly<{ clock: SimulationClock; seed: number }>;
export type KernelTransactionParticipant<T = unknown> = Readonly<{
  id: string;
  snapshot: () => T;
  restore: (snapshot: T) => void;
}>;

type KernelCheckpoint = Readonly<{
  tick: number;
  speed: SimulationClock['speed'];
  commands: CommandBusSnapshot;
  events: DomainEventJournalSnapshot;
  random: RandomStreamSnapshot;
  participants: readonly Readonly<{ id: string; snapshot: unknown }>[];
}>;

export type KernelDiagnosticSnapshot = Readonly<{
  tick: number;
  systems: readonly string[];
  pendingCommands: number;
  nextCommandSequence: number;
  retainedEvents: number;
  nextEventSequence: number;
  randomStreams: Readonly<Record<string, number>>;
  faulted: boolean;
}>;

export class SimulationKernel {
  readonly clock: SimulationClock;
  readonly scheduler = new SystemScheduler();
  readonly commands = new CommandBus();
  readonly events = new DomainEventJournal();
  readonly random: RandomStreamRegistry;
  readonly invariants = new InvariantRunner();
  readonly snapshots = new SnapshotRegistry();

  private readonly transactionParticipants = new Map<string, KernelTransactionParticipant>();
  private dirty = true;
  private fault: Error | null = null;

  constructor(options: SimulationKernelOptions) {
    this.clock = options.clock;
    this.random = new RandomStreamRegistry(options.seed);
    this.invariants.register({
      id: 'kernel-clock-valid', cadence: { every: 1 },
      check: ({ tick }) => { if (!Number.isInteger(tick) || tick < 0) throw new Error('clock tick must be a non-negative integer'); },
    });
    this.snapshots.register('kernel', () => this.captureKernelDiagnostics());
  }

  registerSystem(system: KernelSystemDefinition): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    this.scheduler.register(system);
    this.dirty = true;
  }

  registerTransactionParticipant<T>(participant: KernelTransactionParticipant<T>): void {
    if (!participant.id || participant.id.trim().length === 0) throw new Error('transaction participant id must not be empty');
    if (this.transactionParticipants.has(participant.id)) throw new Error(`duplicate transaction participant: ${participant.id}`);
    this.transactionParticipants.set(participant.id, participant as KernelTransactionParticipant);
  }

  compile(): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    this.scheduler.compile();
    this.dirty = false;
  }

  step(ticks = 1): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    if (!Number.isInteger(ticks) || !Number.isFinite(ticks) || ticks < 0) throw new Error('ticks must be a non-negative integer');
    if (ticks === 0) return;
    if (this.dirty) this.compile();

    for (let index = 0; index < ticks; index++) {
      const checkpoint = this.captureCheckpoint();
      try {
        this.clock.step(1);
        const context: KernelStepContext = Object.freeze({ tick: this.clock.tick, commands: this.commands, events: this.events, random: this.random, snapshots: this.snapshots });
        this.commands.dispatchReady(this.clock.tick, context);
        for (const system of this.scheduler.dueSystems(this.clock.tick)) system.execute(context);
        this.invariants.runDue(this.clock.tick, context);
      } catch (error) {
        const fault = error instanceof Error ? error : new Error(String(error));
        try {
          this.restoreCheckpoint(checkpoint);
        } catch (rollbackError) {
          const rollback = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
          this.fault = new Error(`${fault.message}; kernel rollback failed: ${rollback.message}`, { cause: fault });
          throw this.fault;
        }
        this.fault = fault;
        throw error;
      }
    }
  }

  diagnosticSnapshot(): KernelDiagnosticSnapshot { return this.captureKernelDiagnostics(); }

  private captureCheckpoint(): KernelCheckpoint {
    const participants = [...this.transactionParticipants.values()]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((participant) => Object.freeze({ id: participant.id, snapshot: participant.snapshot() }));
    return Object.freeze({
      tick: this.clock.tick,
      speed: this.clock.speed,
      commands: this.commands.snapshot(),
      events: this.events.snapshot(),
      random: this.random.snapshot(),
      participants: Object.freeze(participants),
    });
  }

  private restoreCheckpoint(checkpoint: KernelCheckpoint): void {
    for (const saved of [...checkpoint.participants].reverse()) {
      const participant = this.transactionParticipants.get(saved.id);
      if (!participant) throw new Error(`missing transaction participant during rollback: ${saved.id}`);
      participant.restore(saved.snapshot);
    }
    this.random.restore(checkpoint.random);
    this.events.restore(checkpoint.events);
    this.commands.restore(checkpoint.commands);
    this.clock.restore(checkpoint.tick, checkpoint.speed);
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
      faulted: this.fault !== null,
    });
  }
}
