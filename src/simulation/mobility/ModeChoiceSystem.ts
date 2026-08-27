import type { JourneyPlan } from '../transit/JourneyPlanner.ts';

export type ChosenTravelMode = 'car' | 'transit' | 'unmet';
export type ModeChoiceContext = Readonly<{ crowdingPenaltyTicks?: number }>;
export type ModeChoiceResult = Readonly<{ mode: ChosenTravelMode; carCost: number; transitCost: number; chosenCost: number }>;

export class ModeChoiceSystem {
  choose(carPlan: JourneyPlan | null, transitPlan: JourneyPlan | null, context: ModeChoiceContext = {}): ModeChoiceResult {
    const carCost = carPlan ? Math.max(0, carPlan.totalGeneralizedCost) : Number.POSITIVE_INFINITY;
    const crowding = Math.max(0, Number.isFinite(context.crowdingPenaltyTicks) ? (context.crowdingPenaltyTicks ?? 0) : 0);
    const transitCost = transitPlan ? Math.max(0, transitPlan.totalGeneralizedCost) + crowding : Number.POSITIVE_INFINITY;
    if (!Number.isFinite(carCost) && !Number.isFinite(transitCost)) return { mode: 'unmet', carCost, transitCost, chosenCost: Number.POSITIVE_INFINITY };
    if (transitCost < carCost - 1e-9) return { mode: 'transit', carCost, transitCost, chosenCost: transitCost };
    return { mode: 'car', carCost, transitCost, chosenCost: carCost };
  }
}
