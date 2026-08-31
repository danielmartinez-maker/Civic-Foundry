import type { DomainEvent, JournaledDomainEvent } from './KernelTypes.ts';

export type DomainEventJournalSnapshot = Readonly<{
  events: readonly JournaledDomainEvent[];
  nextSequence: number;
}>;

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new Error('event tick must be a non-negative integer');
}

function validateIdentity(label: 'type' | 'source', value: string): void {
  if (value.trim().length === 0) throw new Error(`event ${label} must not be empty`);
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

function cloneEvent(event: JournaledDomainEvent): JournaledDomainEvent {
  return Object.freeze({
    type: event.type,
    source: event.source,
    payload: isolate(event.payload),
    sequence: event.sequence,
    tick: event.tick,
  });
}

export class DomainEventJournal {
  private readonly events: JournaledDomainEvent[] = [];
  private nextSequence = 1;

  append<TPayload>(tick: number, event: DomainEvent<TPayload>): JournaledDomainEvent {
    validateTick(tick);
    validateIdentity('type', event.type);
    validateIdentity('source', event.source);
    const journaled: JournaledDomainEvent = Object.freeze({
      type: event.type,
      source: event.source,
      payload: isolate(event.payload),
      sequence: this.nextSequence++,
      tick,
    });
    this.events.push(journaled);
    return journaled;
  }

  list(): readonly JournaledDomainEvent[] {
    return Object.freeze(this.events.slice());
  }

  since(sequenceExclusive: number): readonly JournaledDomainEvent[] {
    if (!Number.isInteger(sequenceExclusive) || sequenceExclusive < 0) throw new Error('event sequence must be a non-negative integer');
    return Object.freeze(this.events.filter((event) => event.sequence > sequenceExclusive));
  }

  snapshot(): DomainEventJournalSnapshot {
    return Object.freeze({ events: Object.freeze(this.events.map(cloneEvent)), nextSequence: this.nextSequence });
  }

  restore(snapshot: DomainEventJournalSnapshot): void {
    if (!snapshot || !Array.isArray(snapshot.events) || !Number.isInteger(snapshot.nextSequence) || snapshot.nextSequence < 1) {
      throw new Error('invalid event journal snapshot');
    }
    const seen = new Set<number>();
    const restored = snapshot.events.map((event) => {
      validateTick(event.tick);
      validateIdentity('type', event.type);
      validateIdentity('source', event.source);
      if (!Number.isInteger(event.sequence) || event.sequence < 1 || seen.has(event.sequence)) throw new Error('invalid event sequence');
      seen.add(event.sequence);
      return cloneEvent(event);
    }).sort((a, b) => a.sequence - b.sequence);
    if (restored.some((event) => event.sequence >= snapshot.nextSequence)) throw new Error('event sequence exceeds next sequence');
    this.events.length = 0;
    this.events.push(...restored);
    this.nextSequence = snapshot.nextSequence;
  }

  clearDiagnosticHistory(): void {
    this.events.length = 0;
  }

  getNextSequence(): number {
    return this.nextSequence;
  }
}
