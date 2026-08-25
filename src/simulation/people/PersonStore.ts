import {
  normalizePersonCreateInput,
  personSequence,
  type PersonCreateInput,
  type PersonId,
  type PersonRecord,
} from './PersonTypes.ts';

export class PersonStore {
  private readonly people = new Map<PersonId, PersonRecord>();

  create(input: PersonCreateInput): PersonRecord {
    const person = normalizePersonCreateInput(input);
    if (this.people.has(person.id)) throw new Error(`duplicate person: ${person.id}`);
    this.people.set(person.id, person);
    return person;
  }

  get(id: PersonId): PersonRecord | undefined {
    return this.people.get(id);
  }

  require(id: PersonId): PersonRecord {
    const person = this.people.get(id);
    if (!person) throw new Error(`missing person: ${id}`);
    return person;
  }

  update(id: PersonId, patch: Partial<Omit<PersonRecord, 'id'>>): PersonRecord {
    const current = this.require(id);
    const next = normalizePersonCreateInput({ ...current, ...patch, id });
    this.people.set(id, next);
    return next;
  }

  markDead(id: PersonId): PersonRecord {
    return this.update(id, { alive: false, resident: false });
  }

  list(): readonly PersonRecord[] {
    return Object.freeze(
      [...this.people.values()].sort((a, b) => personSequence(a.id) - personSequence(b.id)),
    );
  }

  livingResidents(): readonly PersonRecord[] {
    return Object.freeze(this.list().filter((person) => person.alive && person.resident));
  }

  size(): number {
    return this.people.size;
  }
}
