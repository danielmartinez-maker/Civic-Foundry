import type { CommandBus } from "./CommandBus.ts";
import type { DomainEventJournal } from "./DomainEventJournal.ts";
import type { RandomStreamRegistry } from "./RandomStreamRegistry.ts";
import type { SnapshotRegistry } from "./SnapshotRegistry.ts";

export type DomainKey = string;
export type KernelSystemId = string;
export type CommandType = string;
export type EventType = string;

export type SystemCadence = Readonly<{
  every: number;
  offset?: number;
}>;

export function validateCadence(cadence: SystemCadence, owner: string): void {
  if (!Number.isInteger(cadence.every) || cadence.every <= 0)
    throw new Error(`invalid cadence for ${owner}`);
  const offset = cadence.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= cadence.every)
    throw new Error(`invalid cadence for ${owner}`);
}

export function isDue(cadence: SystemCadence, tick: number): boolean {
  const offset = cadence.offset ?? 0;
  return tick >= offset && (tick - offset) % cadence.every === 0;
}

export type KernelStepContext = Readonly<{
  tick: number;
  commands: CommandBus;
  events: DomainEventJournal;
  random: RandomStreamRegistry;
  snapshots: SnapshotRegistry;
}>;

export type KernelSystemDefinition = Readonly<{
  id: KernelSystemId;
  reads: readonly DomainKey[];
  writes: readonly DomainKey[];
  cadence: SystemCadence;
  after?: readonly KernelSystemId[];
  before?: readonly KernelSystemId[];
  order?: number;
  rngStreams?: readonly string[];
  emits?: readonly EventType[];
  invariants?: readonly string[];
  performanceBudgetMs?: number;
  execute(context: KernelStepContext): void;
}>;

export type KernelCommand<TPayload = unknown> = Readonly<{
  type: CommandType;
  payload: TPayload;
}>;

export type SequencedCommand = Readonly<{
  sequence: number;
  enqueuedTick: number;
  command: KernelCommand;
}>;

export type CommandHandler = (
  command: SequencedCommand,
  context: KernelStepContext,
) => void;

export type DomainEvent<TPayload = unknown> = Readonly<{
  type: EventType;
  source: string;
  payload: TPayload;
}>;

export type JournaledDomainEvent = DomainEvent &
  Readonly<{
    sequence: number;
    tick: number;
  }>;

export type KernelInvariant = Readonly<{
  id: string;
  cadence: SystemCadence;
  check(context: KernelStepContext): void;
}>;
