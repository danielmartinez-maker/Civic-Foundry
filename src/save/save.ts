import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCore as hydrateCoreV4, serializeCore as serializeCoreV4 } from './saveLegacy.ts';
import { hydrateCoreV5, serializeCoreV5 } from './saveV5.ts';
import { hydrateCoreV6, serializeCoreV6 } from './saveV6.ts';
import { hydrateCoreV7, serializeCoreV7, type SaveV7 } from './saveV7.ts';

export type { SaveTrafficVehicle, SaveV3, SaveV4 } from './saveLegacy.ts';
export type { SaveV5 } from './saveV5.ts';
export type { SaveV6 } from './saveV6.ts';
export type { SaveV7 } from './saveV7.ts';
export {
  hydrateCoreV4,
  serializeCoreV4,
  hydrateCoreV5,
  serializeCoreV5,
  hydrateCoreV6,
  serializeCoreV6,
  hydrateCoreV7,
  serializeCoreV7,
};

export function serializeCore(core: SimulationCore): SaveV7 { return serializeCoreV7(core); }
export function hydrateCore(input: unknown): SimulationCore { return hydrateCoreV7(input); }
