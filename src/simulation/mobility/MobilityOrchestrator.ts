import { MobilityChoiceSystem } from './MobilityChoiceSystem.ts';
import {
  MobilityProviderRegistry,
  type MobilityAlternativeProvider,
  type MobilityRuntimeContext,
} from './MobilityProvider.ts';
import type {
  MobilityAlternative,
  MobilityChoiceOutcome,
  MobilityJourneyRequest,
} from './MobilityTypes.ts';

const unmet = (): MobilityChoiceOutcome => Object.freeze({ outcome: 'unmet', alternative: null });

export class MobilityOrchestrator {
  readonly providers: MobilityProviderRegistry;
  private readonly choice: MobilityChoiceSystem;

  constructor(
    providers: MobilityProviderRegistry,
    choice: MobilityChoiceSystem = new MobilityChoiceSystem(),
  ) {
    this.providers = providers;
    this.choice = choice;
  }

  resolveAndExecute(request: MobilityJourneyRequest, context: MobilityRuntimeContext): MobilityChoiceOutcome {
    for (let attempt = 0; attempt < 2; attempt++) {
      const alternatives: MobilityAlternative[] = [];
      for (const provider of this.providers.list()) {
        for (const alternative of provider.buildAlternatives(request, context)) {
          this.validateAlternative(provider, alternative);
          alternatives.push(alternative);
        }
      }

      const outcome = this.choice.choose(alternatives);
      if (!outcome.alternative) return outcome;
      const provider = this.providers.get(outcome.alternative.providerId);
      if (!provider) throw new Error(`unknown mobility provider: ${outcome.alternative.providerId}`);
      if (provider.execute(outcome.alternative, request, context)) return outcome;
    }
    return unmet();
  }

  private validateAlternative(provider: MobilityAlternativeProvider, alternative: MobilityAlternative): void {
    if (alternative.providerId !== provider.id) {
      throw new Error(`mobility alternative provider mismatch: ${alternative.id}`);
    }
    if (alternative.providerPriority !== provider.priority) {
      throw new Error(`mobility alternative priority mismatch: ${alternative.id}`);
    }
    if (!provider.modes.includes(alternative.mode)) {
      throw new Error(`mobility provider ${provider.id} does not own mode ${alternative.mode}`);
    }
    if (!Number.isFinite(alternative.cost.generalizedCost) || alternative.cost.generalizedCost < 0) {
      throw new Error(`invalid mobility alternative cost: ${alternative.id}`);
    }
  }
}
