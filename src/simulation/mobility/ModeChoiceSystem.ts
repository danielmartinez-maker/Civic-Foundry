import type { JourneyPlan } from '../transit/JourneyPlanner.ts';
import { MobilityChoiceSystem } from './MobilityChoiceSystem.ts';
import { buildMobilityCost } from './MobilityCost.ts';
import type { MobilityAlternative, MobilityModeId } from './MobilityTypes.ts';

export type ChosenTravelMode = 'car' | 'transit' | 'unmet';
export type ModeChoiceContext = Readonly<{ crowdingPenaltyTicks?: number }>;
export type ModeChoiceResult = Readonly<{ mode: ChosenTravelMode; carCost: number; transitCost: number; chosenCost: number }>;

const alternative = (
  mode: MobilityModeId,
  providerId: string,
  providerPriority: number,
  cost: number,
): MobilityAlternative | null => {
  const breakdown = buildMobilityCost({
    accessEgressTicks: 0,
    expectedWaitTicks: 0,
    movementTicks: cost,
    transferPenaltyTicks: 0,
    fareImpedanceTicks: 0,
    parkingImpedanceTicks: 0,
    congestionDelayTicks: 0,
    crowdingPenaltyTicks: 0,
    reliabilityPenaltyTicks: 0,
    switchingPenaltyTicks: 0,
  });
  if (!breakdown) return null;
  return Object.freeze({
    id: `${providerId}:compatibility`,
    mode,
    providerId,
    providerPriority,
    cost: breakdown,
    expectedArrivalTick: cost,
    execution: null,
  });
};

export class ModeChoiceSystem {
  private readonly choice = new MobilityChoiceSystem();

  choose(carPlan: JourneyPlan | null, transitPlan: JourneyPlan | null, context: ModeChoiceContext = {}): ModeChoiceResult {
    const carCost = carPlan ? Math.max(0, carPlan.totalGeneralizedCost) : Number.POSITIVE_INFINITY;
    const crowding = Math.max(0, Number.isFinite(context.crowdingPenaltyTicks) ? (context.crowdingPenaltyTicks ?? 0) : 0);
    const transitCost = transitPlan ? Math.max(0, transitPlan.totalGeneralizedCost) + crowding : Number.POSITIVE_INFINITY;

    if (!Number.isFinite(carCost) && !Number.isFinite(transitCost)) {
      return { mode: 'unmet', carCost, transitCost, chosenCost: Number.POSITIVE_INFINITY };
    }
    if (Number.isFinite(carCost) && Number.isFinite(transitCost) && Math.abs(carCost - transitCost) <= 1e-9) {
      return { mode: 'car', carCost, transitCost, chosenCost: carCost };
    }

    const alternatives = [
      Number.isFinite(carCost) ? alternative('car', 'legacy-car-choice', 10, carCost) : null,
      Number.isFinite(transitCost) ? alternative('bus', 'legacy-transit-choice', 20, transitCost) : null,
    ].filter((item): item is MobilityAlternative => item !== null);
    const outcome = this.choice.choose(alternatives);
    if (!outcome.alternative) {
      return { mode: 'unmet', carCost, transitCost, chosenCost: Number.POSITIVE_INFINITY };
    }
    if (outcome.outcome === 'car') return { mode: 'car', carCost, transitCost, chosenCost: carCost };
    return { mode: 'transit', carCost, transitCost, chosenCost: transitCost };
  }
}
