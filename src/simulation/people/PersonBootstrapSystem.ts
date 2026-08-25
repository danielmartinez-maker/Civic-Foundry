import { SeededRandom } from '../core/SeededRandom.ts';
import {
  createPersonId,
  type PersonCreateInput,
  type PersonLifeStage,
} from './PersonTypes.ts';

export type PersonBootstrapInput = Readonly<{
  population: number;
  simulationStartTick: number;
}>;

const FIRST_NAMES = Object.freeze([
  'Ana',
  'Mateo',
  'Sofia',
  'Daniel',
  'Lucia',
  'Tomas',
  'Elena',
  'Marco',
  'Isabel',
  'Rafael',
  'Camila',
  'Luis',
  'Maya',
  'Noah',
  'Aisha',
  'David',
]);

const LAST_NAMES = Object.freeze([
  'Torres',
  'Rivera',
  'Chen',
  'Patel',
  'Johnson',
  'Garcia',
  'Kim',
  'Nguyen',
  'Martinez',
  'Williams',
  'Lopez',
  'Singh',
  'Brown',
  'Hernandez',
  'Wilson',
  'Santos',
]);

function lifeStageFromRoll(roll: number): PersonLifeStage {
  if (roll < 18) return 'child';
  if (roll < 25) return 'teen';
  if (roll < 82) return 'adult';
  return 'senior';
}

export class PersonBootstrapSystem {
  private readonly seed: number;

  constructor(seed: number) {
    if (!Number.isFinite(seed)) throw new Error('seed must be finite');
    this.seed = seed;
  }

  bootstrapPopulation(input: PersonBootstrapInput): readonly PersonCreateInput[] {
    if (!Number.isInteger(input.population) || input.population < 0) {
      throw new Error('population must be a non-negative integer');
    }
    if (!Number.isInteger(input.simulationStartTick) || input.simulationStartTick < 0) {
      throw new Error('simulationStartTick must be a non-negative integer');
    }

    const random = new SeededRandom(this.seed);
    const people: PersonCreateInput[] = [];

    for (let sequence = 1; sequence <= input.population; sequence += 1) {
      const firstName = FIRST_NAMES[random.nextInt(FIRST_NAMES.length)] ?? FIRST_NAMES[0];
      const lastName = LAST_NAMES[random.nextInt(LAST_NAMES.length)] ?? LAST_NAMES[0];
      const lifeStage = lifeStageFromRoll(random.nextInt(100));

      // Phase 3R has an abstract tick clock, not a calendar. This value gives
      // bootstrap residents deterministic pre-start chronology only. It must
      // not be interpreted as an age duration; Phase 6R owns calendar-aware
      // scheduling and can migrate bootstrap chronology into calendar facts.
      const chronologyOffset = 1 + random.nextInt(1000);

      people.push({
        id: createPersonId(sequence),
        displayName: `${firstName} ${lastName}`,
        birthTick: input.simulationStartTick - chronologyOffset,
        alive: true,
        resident: true,
        householdId: null,
        homeEntityId: null,
        location: { kind: 'unknown' },
        lifeStage,
        provenance: 'bootstrap_background',
      });
    }

    return Object.freeze(people);
  }
}
