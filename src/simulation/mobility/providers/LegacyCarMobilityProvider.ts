import { buildMobilityCost } from '../MobilityCost.ts';
import type { MobilityAlternative, MobilityJourneyRequest } from '../MobilityTypes.ts';
import type { MobilityAlternativeProvider, MobilityRuntimeContext } from '../MobilityProvider.ts';
import type { RouteResult } from '../../traffic/PathfindingSystem.ts';

type LegacyCarExecution = Readonly<{
  kind: 'legacy-car';
  route: RouteResult;
  roadRevision: number;
  costEpoch: number;
}>;

export class LegacyCarMobilityProvider implements MobilityAlternativeProvider {
  readonly id = 'legacy-car';
  readonly priority = 10;
  readonly modes = Object.freeze(['car'] as const);

  buildAlternatives(request: MobilityJourneyRequest, context: MobilityRuntimeContext): readonly MobilityAlternative[] {
    if (!request.capabilities.privateVehicleAccess || !request.capabilities.licensedDriver) return [];
    const start = request.originRoadNodeId;
    const end = request.destinationRoadNodeId;
    if (!start || !end) return [];

    const route = context.pathfinding.findRoute(context.roadGraph, start, end, {
      edgeCost: context.roadTravelTime,
      costKey: `mobility-car:${context.costEpoch}`,
    });
    if (!route) return [];

    const cost = buildMobilityCost({
      accessEgressTicks: 0,
      expectedWaitTicks: 0,
      movementTicks: route.totalCost,
      transferPenaltyTicks: 0,
      fareImpedanceTicks: 0,
      parkingImpedanceTicks: 0,
      congestionDelayTicks: 0,
      crowdingPenaltyTicks: 0,
      reliabilityPenaltyTicks: 0,
      switchingPenaltyTicks: 0,
    });
    if (!cost) return [];

    const execution: LegacyCarExecution = Object.freeze({
      kind: 'legacy-car',
      route,
      roadRevision: context.roadGraph.revision,
      costEpoch: context.costEpoch,
    });
    return Object.freeze([Object.freeze({
      id: `${this.id}:${request.id}`,
      mode: 'car',
      providerId: this.id,
      providerPriority: this.priority,
      cost,
      expectedArrivalTick: request.departureTick + cost.generalizedCost,
      execution,
    })]);
  }

  execute(alternative: MobilityAlternative, request: MobilityJourneyRequest, context: MobilityRuntimeContext): boolean {
    const execution = alternative.execution as Partial<LegacyCarExecution> | null;
    if (!execution || execution.kind !== 'legacy-car' || !execution.route) return false;
    if (execution.roadRevision !== context.roadGraph.revision || execution.costEpoch !== context.costEpoch) return false;
    if (execution.route.nodeIds[0] !== request.originRoadNodeId
      || execution.route.nodeIds[execution.route.nodeIds.length - 1] !== request.destinationRoadNodeId) return false;
    if (execution.route.edgeIds.length > 0) {
      context.submitLegacyCarTrip(request.sourceTripId, request.travelerWeight, execution.route);
    }
    return true;
  }
}
