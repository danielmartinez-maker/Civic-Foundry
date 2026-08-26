export type PersonId = `person:${number}`;
export type HouseholdId = `household:${number}`;

export type PersonHistoryProvenance =
  | 'bootstrap_background'
  | 'simulated_event'
  | 'imported_fact';

export type PersonLifeStage = 'child' | 'teen' | 'adult' | 'senior';

export type PersonLocationState =
  | Readonly<{ kind: 'unknown' }>
  | Readonly<{ kind: 'building'; entityId: string }>
  | Readonly<{ kind: 'network'; entityId: string }>;

export type PersonRecord = Readonly<{
  id: PersonId;
  displayName: string;
  birthTick: number;
  alive: boolean;
  resident: boolean;
  householdId: HouseholdId | null;
  homeEntityId: string | null;
  location: PersonLocationState;
  lifeStage: PersonLifeStage;
  provenance: PersonHistoryProvenance;
}>;

export type PersonCreateInput = PersonRecord;

const PERSON_ID_PATTERN = /^person:[1-9]\d*$/;
const HOUSEHOLD_ID_PATTERN = /^household:[1-9]\d*$/;

export function createPersonId(sequence: number): PersonId {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error('person sequence must be a positive integer');
  }
  return `person:${sequence}`;
}

export function personSequence(id: PersonId): number {
  if (!PERSON_ID_PATTERN.test(id)) throw new Error('invalid person id');
  return Number(id.slice('person:'.length));
}

function normalizeOptionalEntityId(value: string | null, label: string): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${label} must be non-empty when present`);
  return normalized;
}

function normalizeLocation(location: PersonLocationState): PersonLocationState {
  if (location.kind === 'unknown') return Object.freeze({ kind: 'unknown' });
  const entityId = location.entityId.trim();
  if (entityId.length === 0) throw new Error('location entityId must be non-empty');
  return Object.freeze({ kind: location.kind, entityId });
}

export function normalizePersonCreateInput(input: PersonCreateInput): PersonRecord {
  if (!PERSON_ID_PATTERN.test(input.id)) throw new Error('invalid person id');
  if (!Number.isFinite(input.birthTick)) throw new Error('birthTick must be finite');

  const displayName = input.displayName.trim();
  if (displayName.length === 0) throw new Error('displayName must be non-empty');

  if (input.householdId !== null && !HOUSEHOLD_ID_PATTERN.test(input.householdId)) {
    throw new Error('invalid household id');
  }

  return Object.freeze({
    id: input.id,
    displayName,
    birthTick: input.birthTick,
    alive: input.alive,
    resident: input.resident,
    householdId: input.householdId,
    homeEntityId: normalizeOptionalEntityId(input.homeEntityId, 'homeEntityId'),
    location: normalizeLocation(input.location),
    lifeStage: input.lifeStage,
    provenance: input.provenance,
  });
}
