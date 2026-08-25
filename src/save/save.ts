import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCore as hydrateCoreV4, serializeCore as serializeCoreV4 } from './saveLegacy.ts';
import { hydrateCoreV5, serializeCoreV5 } from './saveV5.ts';
import { hydrateCoreV6, serializeCoreV6 } from './saveV6.ts';
import { hydrateCoreV7, serializeCoreV7, type SaveV7 } from './saveV7.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type { SaveTrafficVehicle, SaveV3, SaveV4 } from './saveLegacy.ts';
export type { SaveV5 } from './saveV5.ts';
export type { SaveV6 } from './saveV6.ts';
export type { SaveV7 } from './saveV7.ts';
export type { SaveV8 } from './saveV8.ts';
export {
  hydrateCoreV4,
  serializeCoreV4,
  hydrateCoreV5,
  serializeCoreV5,
  hydrateCoreV6,
  serializeCoreV6,
  hydrateCoreV7,
  serializeCoreV7,
  hydrateCoreV8,
  serializeCoreV8,
};

export function serializeCore(core: SimulationCore): SaveV7 | SaveV8 {
  return core.isPersonhoodAuthorityEnabled() ? serializeCoreV8(core) : serializeCoreV7(core);
}

export function hydrateCore(input: unknown): SimulationCore {
  return isV8(input) ? hydrateCoreV8(input) : hydrateCoreV7(input);
}

function isV8(input: unknown): boolean {
  return typeof input === 'object'
    && input !== null
    && !Array.isArray(input)
    && (input as Record<string, unknown>).saveVersion === 8;
}
