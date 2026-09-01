import { SimulationClock } from "../core/SimulationClock.ts";
import {
  normalizeEngineFailure,
  type EngineFailure,
} from "../diagnostics/EngineFailure.ts";
import {
  PerformanceAttribution,
  type PerformanceMetric,
} from "../diagnostics/PerformanceAttribution.ts";
import {
  TransactionCoordinator,
  type TransactionCheckpoint,
  type TransactionParticipant,
} from "../transactions/TransactionCoordinator.ts";
import { CommandBus, type CommandBusSnapshot } from "./CommandBus.ts";
import {
  DomainEventJournal,
  type DomainEventJournalSnapshot,
} from "./DomainEventJournal.ts";
import { InvariantRunner } from "./InvariantRunner.ts";
import {
  RandomStreamRegistry,
  type RandomStreamSnapshot,
} from "./RandomStreamRegistry.ts";
import { SnapshotRegistry } from "./SnapshotRegistry.ts";
import { SystemScheduler } from "./SystemScheduler.ts";
import type {
  KernelStepContext,
  KernelSystemDefinition,
} from "./KernelTypes.ts";

export type SimulationKernelOptions = Readonly<{
  clock: SimulationClock;
  seed: number;
  now?: () => number;
}>;
export type KernelTransactionParticipant<T = unknown> = TransactionParticipant<T>;

type KernelCheckpoint = Readonly<{
  tick: number;
  speed: SimulationClock["speed"];
  commands: CommandBusSnapshot;
  events: DomainEventJournalSnapshot;
  random: RandomStreamSnapshot;
  participants: TransactionCheckpoint;
}>;

export type KernelSchedulerManifestEntry = Readonly<{
  id: string;
  cadence: Readonly<{ every: number; offset: number }>;
  reads: readonly string[];
  writes: readonly string[];
  rngStreams: readonly string[];
  emits: readonly string[];
  invariants: readonly string[];
  performanceBudgetMs?: number;
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
  transactionRollbacks: number;
  performance: Readonly<Record<string, PerformanceMetric>>;
  lastFailure: Readonly<Record<string, unknown>> | null;
}>;

export class SimulationKernel {
  readonly clock: SimulationClock;
  readonly scheduler = new SystemScheduler();
  readonly commands = new CommandBus();
  readonly events = new DomainEventJournal();
  readonly random: RandomStreamRegistry;
  readonly invariants = new InvariantRunner();
  readonly snapshots = new SnapshotRegistry();
  readonly performance = new PerformanceAttribution();

  private readonly transactions = new TransactionCoordinator();
  private readonly now: () => number;
  private dirty = true;
  private fault: Error | null = null;
  private structuredFailure: EngineFailure | null = null;
  private rollbackCount = 0;

  constructor(options: SimulationKernelOptions) {
    this.clock = options.clock;
    this.random = new RandomStreamRegistry(options.seed);
    this.now =
      options.now ??
      (() =>
        typeof globalThis.performance?.now === "function"
          ? globalThis.performance.now()
          : 0);
    this.invariants.register({
      id: "kernel-clock-valid",
      cadence: { every: 1 },
      check: ({ tick }) => {
        if (!Number.isInteger(tick) || tick < 0)
          throw new Error("clock tick must be a non-negative integer");
      },
    });
    this.snapshots.register("kernel", () => this.captureKernelDiagnostics());
  }

  registerSystem(system: KernelSystemDefinition): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    this.scheduler.register(system);
    this.dirty = true;
  }

  registerTransactionParticipant<T>(
    participant: KernelTransactionParticipant<T>,
  ): void {
    this.transactions.register(participant);
  }

  compile(): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    this.scheduler.compile();
    this.dirty = false;
  }

  step(ticks = 1): void {
    if (this.fault) throw new Error(`kernel is faulted: ${this.fault.message}`);
    if (!Number.isInteger(ticks) || !Number.isFinite(ticks) || ticks < 0)
      throw new Error("ticks must be a non-negative integer");
    if (ticks === 0) return;
    if (this.dirty) this.compile();

    for (let index = 0; index < ticks; index++) {
      const checkpoint = this.captureCheckpoint();
      try {
        this.clock.step(1);
        const context: KernelStepContext = Object.freeze({
          tick: this.clock.tick,
          commands: this.commands,
          events: this.events,
          random: this.random,
          snapshots: this.snapshots,
        });
        this.commands.dispatchReady(this.clock.tick, context);
        for (const system of this.scheduler.dueSystems(this.clock.tick)) {
          const started = this.now();
          try {
            system.execute(context);
          } finally {
            const duration = this.now() - started;
            if (Number.isFinite(duration) && duration >= 0) {
              this.performance.record(
                system.id,
                duration,
                system.performanceBudgetMs === undefined
                  ? {}
                  : { budgetMs: system.performanceBudgetMs },
              );
            }
          }
        }
        this.invariants.runDue(this.clock.tick, context);
      } catch (error) {
        const fault = error instanceof Error ? error : new Error(String(error));
        const failureTick = this.clock.tick;
        this.structuredFailure = normalizeEngineFailure(error, {
          code: "kernel-step-failed",
          category: "SchedulingFailure",
          domain: "kernel",
          operation: "step",
          tick: failureTick,
        });
        try {
          this.restoreCheckpoint(checkpoint);
          this.rollbackCount += 1;
        } catch (rollbackError) {
          const rollback =
            rollbackError instanceof Error
              ? rollbackError
              : new Error(String(rollbackError));
          this.structuredFailure = normalizeEngineFailure(rollbackError, {
            code: "kernel-rollback-failed",
            category: "TransactionFailure",
            domain: "kernel",
            operation: "rollback-step",
            tick: checkpoint.tick,
          });
          this.fault = new Error(
            `${fault.message}; kernel rollback failed: ${rollback.message}`,
            { cause: fault },
          );
          throw this.fault;
        }
        this.fault = fault;
        throw error;
      }
    }
  }

  schedulerManifest(): readonly KernelSchedulerManifestEntry[] {
    const manifest = this.scheduler.executionOrder().map((system) => {
      const value: KernelSchedulerManifestEntry = Object.freeze({
        id: system.id,
        cadence: Object.freeze({
          every: system.cadence.every,
          offset: system.cadence.offset ?? 0,
        }),
        reads: Object.freeze([...(system.reads ?? [])]),
        writes: Object.freeze([...(system.writes ?? [])]),
        rngStreams: Object.freeze([...(system.rngStreams ?? [])]),
        emits: Object.freeze([...(system.emits ?? [])]),
        invariants: Object.freeze([...(system.invariants ?? [])]),
        ...(system.performanceBudgetMs === undefined
          ? {}
          : { performanceBudgetMs: system.performanceBudgetMs }),
      });
      return value;
    });
    return Object.freeze(manifest);
  }

  lastFailure(): EngineFailure | null {
    return this.structuredFailure;
  }

  diagnosticSnapshot(): KernelDiagnosticSnapshot {
    return this.captureKernelDiagnostics();
  }

  private captureCheckpoint(): KernelCheckpoint {
    return Object.freeze({
      tick: this.clock.tick,
      speed: this.clock.speed,
      commands: this.commands.snapshot(),
      events: this.events.snapshot(),
      random: this.random.snapshot(),
      participants: this.transactions.capture(),
    });
  }

  private restoreCheckpoint(checkpoint: KernelCheckpoint): void {
    this.transactions.rollback(checkpoint.participants);
    this.random.restore(checkpoint.random);
    this.events.restore(checkpoint.events);
    this.commands.restore(checkpoint.commands);
    this.clock.restore(checkpoint.tick, checkpoint.speed);
  }

  private captureKernelDiagnostics(): KernelDiagnosticSnapshot {
    return Object.freeze({
      tick: this.clock.tick,
      systems: Object.freeze(
        this.scheduler.listSystems().map((system) => system.id),
      ),
      pendingCommands: this.commands.pending().length,
      nextCommandSequence: this.commands.getNextSequence(),
      retainedEvents: this.events.list().length,
      nextEventSequence: this.events.getNextSequence(),
      randomStreams: this.random.snapshot(),
      faulted: this.fault !== null,
      transactionRollbacks: this.rollbackCount,
      performance: this.performance.snapshot(),
      lastFailure: this.structuredFailure?.toJSON() ?? null,
    });
  }
}
