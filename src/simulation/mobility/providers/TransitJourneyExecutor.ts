import type { MobilityJourneyRequest } from '../MobilityTypes.ts';
import type { JourneyPlan } from '../../transit/JourneyPlanner.ts';
import type { TransitNetworkSystem } from '../../transit/TransitNetworkSystem.ts';
import {
  type PassengerQueueSystem,
  type TransitPassengerCohort,
  type TransitTransferLeg,
} from '../../transit/PassengerQueueSystem.ts';

export class TransitJourneyExecutor {
  enqueue(
    request: MobilityJourneyRequest,
    plan: JourneyPlan,
    transit: TransitNetworkSystem,
    passengers: PassengerQueueSystem,
  ): boolean {
    const boardingLegs = plan.legs.filter((leg) => leg.kind === 'board' && leg.lineId);
    const alightLegs = plan.legs.filter((leg) => leg.kind === 'alight' && leg.lineId);
    if (boardingLegs.length === 0 || boardingLegs.length !== alightLegs.length) return false;

    const transfers: TransitTransferLeg[] = [];
    for (let i = 1; i < boardingLegs.length; i++) {
      const board = boardingLegs[i];
      const alight = alightLegs[i];
      if (!board?.lineId || !alight?.lineId || board.lineId !== alight.lineId) return false;
      transfers.push(Object.freeze({
        lineId: board.lineId,
        directionKey: this.directionForPlan(plan, transit, board.lineId, board.to),
        boardingStopId: this.stopIdFromNode(board.from),
        alightingStopId: this.stopIdFromNode(alight.to),
      }));
    }

    const firstBoard = boardingLegs[0];
    const firstAlight = alightLegs[0];
    if (!firstBoard?.lineId || !firstAlight?.lineId
      || firstBoard.lineId !== firstAlight.lineId
      || !request.destinationRoadNodeId) return false;

    const cohort: TransitPassengerCohort = Object.freeze({
      id: `transit-passenger:${request.id}`,
      personTripId: request.id,
      travelerWeight: request.travelerWeight,
      lineId: firstBoard.lineId,
      directionKey: this.directionForPlan(plan, transit, firstBoard.lineId, firstBoard.to),
      boardingStopId: this.stopIdFromNode(firstBoard.from),
      alightingStopId: this.stopIdFromNode(firstAlight.to),
      destinationRoadNodeId: request.destinationRoadNodeId,
      enqueuedTick: request.departureTick,
      transferLegs: Object.freeze(transfers),
    });
    return passengers.enqueue(cohort.boardingStopId, cohort.lineId, cohort.directionKey, cohort);
  }

  private directionForPlan(
    plan: JourneyPlan,
    transit: TransitNetworkSystem,
    lineId: string,
    platformFrom: string,
  ): 'forward' | 'reverse' {
    const ride = plan.legs.find((leg) => leg.kind === 'ride' && leg.lineId === lineId && leg.from === platformFrom);
    if (!ride) return 'forward';
    const line = transit.getLine(lineId);
    if (!line) return 'forward';
    const fromStop = this.stopIdFromPlatform(ride.from);
    const toStop = this.stopIdFromPlatform(ride.to);
    const fromIndex = line.stopIds.indexOf(fromStop);
    const toIndex = line.stopIds.indexOf(toStop);
    if (fromIndex < 0 || toIndex < 0) return 'forward';
    return toIndex >= fromIndex ? 'forward' : 'reverse';
  }

  private stopIdFromNode(nodeId: string): string {
    return nodeId.startsWith('stop:') ? nodeId.slice(5) : nodeId;
  }

  private stopIdFromPlatform(nodeId: string): string {
    const parts = nodeId.split(':');
    return parts.slice(2).join(':');
  }
}
