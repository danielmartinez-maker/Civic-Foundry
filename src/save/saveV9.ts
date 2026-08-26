import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PersonSavePayload } from '../simulation/people/PersonPersistence.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-personhood';
  personhood: PersonSavePayload;
}>;

export function serializeCoreV9(
  core: SimulationCore,
  baseV8: SaveV8 = serializeCoreV8(core),
): SaveV9 {
  if (!core.isPersonhoodAuthorityEnabled()) {
    throw new Error('Save V9 requires Personhood authority');
  }

  return {
    ...baseV8,
    saveVersion: 9,
    gameVersion: '0.9.0-personhood',
    personhood: core.getPersonSavePayload(),
  };
}

export function hydrateCoreV9(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 9) {
    const core = hydrateCoreV8(input);
    core.enablePersonhoodAuthority();
    return core;
  }

  if (input.gameVersion !== '0.9.0-personhood') {
    throw new Error('invalid V9 game version');
  }
  if (!isRecord(input.personhood)) {
    throw new Error('personhood must be an object');
  }

  const save = input as unknown as SaveV9;
  const { personhood, ...withoutPersonhood } = save;
  const v8: SaveV8 = {
    ...withoutPersonhood,
    saveVersion: 8,
    gameVersion: '0.8.0-world-foundation',
  };

  const core = hydrateCoreV8(v8);
  core.restorePersonhoodAuthority(personhood);
  return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
