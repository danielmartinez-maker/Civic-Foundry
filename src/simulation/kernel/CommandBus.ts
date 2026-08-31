import type { CommandHandler, CommandType, KernelCommand, KernelStepContext, SequencedCommand } from './KernelTypes.ts';

export type CommandBusSnapshot = Readonly<{
  queue: readonly SequencedCommand[];
  nextSequence: number;
}>;

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new Error('command tick must be a non-negative integer');
}

function validateType(type: string): void {
  if (type.trim().length === 0) throw new Error('command type must not be empty');
}

function isolate(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(isolate));
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(source)) output[key] = isolate(source[key]);
    return Object.freeze(output);
  }
  return value;
}

function cloneSequencedCommand(item: SequencedCommand): SequencedCommand {
  return Object.freeze({
    sequence: item.sequence,
    enqueuedTick: item.enqueuedTick,
    command: Object.freeze({ type: item.command.type, payload: isolate(item.command.payload) }),
  });
}

export class CommandBus {
  private readonly handlers = new Map<CommandType, CommandHandler>();
  private queue: SequencedCommand[] = [];
  private nextSequence = 1;

  registerHandler(type: CommandType, handler: CommandHandler): void {
    validateType(type);
    if (this.handlers.has(type)) throw new Error(`duplicate command handler: ${type}`);
    this.handlers.set(type, handler);
  }

  enqueue(command: KernelCommand, enqueuedTick: number): number {
    validateType(command.type);
    validateTick(enqueuedTick);
    const sequence = this.nextSequence++;
    const item: SequencedCommand = Object.freeze({
      sequence,
      enqueuedTick,
      command: Object.freeze({ type: command.type, payload: isolate(command.payload) }),
    });
    this.queue.push(item);
    return sequence;
  }

  dispatchReady(tick: number, context: KernelStepContext): readonly SequencedCommand[] {
    validateTick(tick);
    const ready = this.queue.filter((item) => item.enqueuedTick <= tick).sort((a, b) => a.sequence - b.sequence);
    if (ready.length === 0) return Object.freeze([]);

    const readySequences = new Set(ready.map((item) => item.sequence));
    this.queue = this.queue.filter((item) => !readySequences.has(item.sequence));
    const dispatched: SequencedCommand[] = [];
    for (let index = 0; index < ready.length; index++) {
      const command = ready[index]!;
      const handler = this.handlers.get(command.command.type);
      try {
        if (!handler) throw new Error(`no command handler: ${command.command.type}`);
        handler(command, context);
        dispatched.push(command);
      } catch (error) {
        const undispatched = ready.slice(index + 1);
        if (undispatched.length > 0) this.queue = [...undispatched, ...this.queue].sort((a, b) => a.sequence - b.sequence);
        throw error;
      }
    }
    return Object.freeze(dispatched.slice());
  }

  snapshot(): CommandBusSnapshot {
    return Object.freeze({
      queue: Object.freeze(this.queue.slice().sort((a, b) => a.sequence - b.sequence).map(cloneSequencedCommand)),
      nextSequence: this.nextSequence,
    });
  }

  restore(snapshot: CommandBusSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.queue) || !Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
      throw new Error('invalid command bus snapshot');
    }
    const seen = new Set<number>();
    const queue = snapshot.queue.map((item) => {
      if (!Number.isInteger(item.sequence) || item.sequence < 1 || seen.has(item.sequence)) throw new Error('invalid command sequence');
      validateTick(item.enqueuedTick);
      validateType(item.command.type);
      seen.add(item.sequence);
      return cloneSequencedCommand(item);
    }).sort((a, b) => a.sequence - b.sequence);
    if (queue.some((item) => item.sequence >= snapshot.nextSequence)) throw new Error('command sequence exceeds next sequence');
    this.queue = queue;
    this.nextSequence = snapshot.nextSequence;
  }

  pending(): readonly SequencedCommand[] {
    return Object.freeze(this.queue.slice().sort((a, b) => a.sequence - b.sequence));
  }

  getNextSequence(): number {
    return this.nextSequence;
  }
}
