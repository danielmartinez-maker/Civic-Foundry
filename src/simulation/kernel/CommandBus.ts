import type { CommandHandler, CommandType, KernelCommand, KernelStepContext, SequencedCommand } from './KernelTypes.ts';

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new Error('command tick must be a non-negative integer');
}

function validateType(type: string): void {
  if (type.trim().length === 0) throw new Error('command type must not be empty');
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
      command: Object.freeze({ ...command }),
    });
    this.queue.push(item);
    return sequence;
  }

  dispatchReady(tick: number, context: KernelStepContext): readonly SequencedCommand[] {
    validateTick(tick);
    const ready = this.queue
      .filter((item) => item.enqueuedTick <= tick)
      .sort((a, b) => a.sequence - b.sequence);
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
        if (undispatched.length > 0) {
          this.queue = [...undispatched, ...this.queue].sort((a, b) => a.sequence - b.sequence);
        }
        throw error;
      }
    }

    return Object.freeze(dispatched.slice());
  }

  pending(): readonly SequencedCommand[] {
    return Object.freeze(this.queue.slice().sort((a, b) => a.sequence - b.sequence));
  }

  getNextSequence(): number {
    return this.nextSequence;
  }
}
