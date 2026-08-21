import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCore as hydrateCoreV4, serializeCore as serializeCoreV4 } from './saveLegacy.ts';
import { hydrateCoreV5, serializeCoreV5, type SaveV5 } from './saveV5.ts';

export type { SaveTrafficVehicle, SaveV3, SaveV4 } from './saveLegacy.ts';
export type { SaveV5 } from './saveV5.ts';
export { hydrateCoreV4, serializeCoreV4, hydrateCoreV5, serializeCoreV5 };

export function serializeCore(core: SimulationCore): SaveV5 {
  return serializeCoreV5(core);
}

export function hydrateCore(input: unknown): SimulationCore {
  return hydrateCoreV5(input);
}
