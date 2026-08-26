import { buildMobilityCost } from '../MobilityCost.ts';
import type { MobilityAlternative, MobilityJourneyRequest, MobilityModeId } from '../MobilityTypes.ts';
import type { MobilityAlternativeProvider, MobilityRuntimeContext } from '../MobilityProvider.ts';
import type { JourneyPlan } from '../../transit/JourneyPlanner.ts';
import { TransitJourneyExecutor } from './TransitJourneyExecutor.ts';

const LEGACY_TRANSIT_MODES = Object.freeze(['bus', 'brt', 'tram', 'metro'] as const);
type LegacyTransitMode = (typeof LEGACY_TRANSIT_MODES)[number];

type LegacyTransitExecution = Readonly<{
  kind: 'legacy-transit';
  plan: JourneyPlan;
  transitRevision: number;
  multimodalRevision: number;
  costEpoch: number;
}>;

export class LegacyTransitMobilityProvider implements MobilityAlternativeProvider {
  readonly id = 'legacy-transit';
  readonly priority = 20;
  readonly modes: readonly MobilityModeId[] = LEGACY_TRANSIT_MODES;
  private readonly executor = new TransitJourneyExecutor();

  buildAlternatives(request: MobilityJourneyRequest, context: MobilityRuntimeContext): readonly MobilityAlternative[] {
    const start = request.originRoadNodeId;
    const end = request.destinationRoadNodeId;
    if (!start || !end) return [];

    const plan = context.journeyPlanner.plan(context.multimodalGraph, start, end, {
      mode: 'transit',
      transferPenaltyTicks: 20,
      fareWeightTicksPerCurrency: 4,
      costKey: `mobility-transit:${context.costEpoch}`,
    });
    if (!plan) return [];

    const mode = this.dominantTransitMode(plan);
    if (!mode) return [];
    const fareImpedanceTicks = plan.fare * 4;
    const knownComponents = plan.walkingTicks
      + plan.expectedWaitTicks
      + plan.transferPenaltyTicks
      + fareImpedanceTicks;
    const movementTicks = Math.max(0, plan.totalGeneralizedCost - knownComponents);
    const cost = buildMobilityCost({
      accessEgressTicks: plan.walkingTicks,
      expectedWaitTicks: plan.expectedWaitTicks,
      movementTicks,
      transferPenaltyTicks: plan.transferPenaltyTicks,
      fareImpedanceTicks,
      parkingImpedanceTicks: 0,
      congestionDelayTicks: 0,
      crowdingPenaltyTicks: context.crowdingPenaltyTicks,
      reliabilityPenaltyTicks: 0,
      switchingPenaltyTicks: 0,
    });
    if (!cost) return [];

    const execution: LegacyTransitExecution = Object.freeze({
      kind: 'legacy-transit',
      plan,
      transitRevision: context.transit.revision,
      multimodalRevision: context.multimodalGraph.revision,
      costEpoch: context.costEpoch,
    });
    return Object.freeze([Object.freeze({
      id: `${this.id}:${request.id}:${mode}`,
      mode,
      providerId: this.id,
      providerPriority: this.priority,
      cost,
      expectedArrivalTick: request.departureTick + cost.generalizedCost,
      execution,
    })]);
  }

  execute(alternative: MobilityAlternative, request: MobilityJourneyRequest, context: MobilityRuntimeContext): boolean {
    const execution = alternative.execution as Partial<LegacyTransitExecution> | null;
    if (!execution || execution.kind !== 'legacy-transit' || !execution.plan) return false;
    if (execution.transitRevision !== context.transit.revision
      || execution.multimodalRevision !== context.multimodalGraph.revision
      || execution.costEpoch !== context.costEpoch) return false;
    if (this.dominantTransitMode(execution.plan) !== alternative.mode) return false;
    return this.executor.enqueue(request, execution.plan, context.transit, context.passengers);
  }

  private dominantTransitMode(plan: JourneyPlan): LegacyTransitMode | null {
    const ticks = new Map<LegacyTransitMode, number>();
    for (const leg of plan.legs) {
      if (leg.kind !== 'ride' || !leg.mode || !LEGACY_TRANSIT_MODES.includes(leg.mode)) continue;
      const mode = leg.mode as LegacyTransitMode;
      ticks.set(mode, (ticks.get(mode) ?? 0) + leg.ticks);
    }
    if (ticks.size === 0) return null;
    return [...ticks.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  }
}
