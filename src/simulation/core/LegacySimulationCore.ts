import { LegacySimulationCore as LegacySimulationCoreBase } from './LegacySimulationCoreBase.ts';

export type { LegacySimulationCoreOptions } from './LegacySimulationCoreBase.ts';

export class LegacySimulationCore extends LegacySimulationCoreBase {
  constructor(...args: ConstructorParameters<typeof LegacySimulationCoreBase>) {
    super(...args);
    this.tripGeneration.setDemandWeightMode('legacy-rounded');
  }
}
