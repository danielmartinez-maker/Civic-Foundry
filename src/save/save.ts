import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { hydrateCore as hydrateCoreV4, serializeCore as serializeCoreV4 } from './saveLegacy.ts';
import { hydrateCoreV5, serializeCoreV5 } from './saveV5.ts';
import { hydrateCoreV6, serializeCoreV6, type SaveV6 } from './saveV6.ts';

export type { SaveTrafficVehicle, SaveV3, SaveV4 } from './saveLegacy.ts';
export type { SaveV5 } from './saveV5.ts';
export type { SaveV6 } from './saveV6.ts';
export { hydrateCoreV4, serializeCoreV4, hydrateCoreV5, serializeCoreV5, hydrateCoreV6, serializeCoreV6 };

export function serializeCore(core: SimulationCore): SaveV6 { return serializeCoreV6(core); }
export function hydrateCore(input: unknown): SimulationCore { return hydrateCoreV6(input); }
