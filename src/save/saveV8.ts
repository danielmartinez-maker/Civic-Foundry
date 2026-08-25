import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PersonSavePayload } from '../simulation/people/PersonPersistence.ts';
import { hydrateCoreV7, serializeCoreV7, type SaveV7 } from './saveV7.ts';

export type SaveV8 = Omit<SaveV7, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 8;
  gameVersion: '0.8.0-personhood';
  personhood: PersonSavePayload;
};

export function serializeCoreV8(core: SimulationCore): SaveV8 {
  if (!core.isPersonhoodAuthorityEnabled()) throw new Error('Save V8 requires Personhood authority');
  const v7 = serializeCoreV7(core);
  return {
    ...v7,
    saveVersion: 8,
    gameVersion: '0.8.0-personhood',
    personhood: core.getPersonSavePayload(),
  };
}

export function hydrateCoreV8(input: unknown): SimulationCore {
  if (!isRecord(input)) throw new Error('save must be an object');

  if (input.saveVersion === 7) {
    const core = hydrateCoreV7(input);
    core.enablePersonhoodAuthority();
    return core;
  }
  if (input.saveVersion !== 8) throw new Error('Save V8 migration requires Save V7 or Save V8');
  if (input.gameVersion !== '0.8.0-personhood') throw new Error('invalid V8 game version');

  const save = input as unknown as SaveV8;
  const v7: SaveV7 = {
    ...save,
    saveVersion: 7,
    gameVersion: '0.7.0-metropolitan',
  };
  const core = hydrateCoreV7(v7);
  core.restorePersonhoodAuthority(save.personhood);
  return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
