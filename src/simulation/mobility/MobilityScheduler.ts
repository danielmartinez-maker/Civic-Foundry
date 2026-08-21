import type { TransitMode } from '../../data/transit.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';
import { MultimodalRoutingGraph } from '../transit/MultimodalRoutingGraph.ts';
import { JourneyPlanner, type JourneyPlan } from '../transit/JourneyPlanner.ts';
import type { TransitNetworkSystem } from '../transit/TransitNetworkSystem.ts';
import { PassengerQueueSystem, type TransitPassengerCohort, type TransitTransferLeg, type PassengerQueueSnapshot } from '../transit/PassengerQueueSystem.ts';
import { TransitVehicleSystem, type TransitVehicleStateSnapshot } from '../transit/TransitVehicleSystem.ts';
import { TransitOperationsSystem, type TransitOperationsStateSnapshot } from '../transit/TransitOperationsSystem.ts';
import { ModeChoiceSystem } from './ModeChoiceSystem.ts';

export type MobilityPersonTrip = Readonly<{
  id: string;
  sourceTripId: string;
  originBuildingId: string;
  destinationBuildingId: string;
  originRoadNodeId: string | null;
  destinationRoadNodeId: string | null;
  departureTick: number;
  travelerWeight: number;
  purpose: 'commute' | 'shopping';
}>;

export type MobilityTickContext = Readonly<{
  tick: number;
  roadGraph: TransportationGraph;
  transit: TransitNetworkSystem;
  pathfinding: PathfindingSystem;
  roadTravelTime: (edge: TransportationEdge) => number;
  costEpoch?: number;
  generateTrips: () => readonly MobilityPersonTrip[];
  submitCarTrip: (trip: MobilityPersonTrip, travelerWeight: number, route: RouteResult) => void;
}>;

export type MobilitySnapshot = Readonly<{
  carModeShare: number;
  transitModeShare: number;
  unmetShare: number;
  personAccessibility: number;
  ridership: number;
  meanWaitTicks: number;
  reliability: number;
  crowding: number;
  transitOperatingCost: number;
  transitFareRevenue: number;
}>;

export type MobilityDecision = Readonly<{
  mode: 'car' | 'transit' | 'unmet';
  travelerWeight: number;
  purpose: MobilityPersonTrip['purpose'];
  chosenCost: number;
  expectedWaitTicks: number;
}>;

export type MobilityFiscalDelta = Readonly<{ operatingCost: number; fareRevenue: number }>;
export type MobilitySchedulerStateSnapshot = Readonly<{
  decisions: readonly MobilityDecision[];
  crowdingPenaltyTicks: number;
  fiscalOperatingCursor: number;
  fiscalFareCursor: number;
  passengers: PassengerQueueSnapshot;
  vehicles: TransitVehicleStateSnapshot;
  operations: TransitOperationsStateSnapshot;
}>;

const MAX_ACCEPTABLE: Readonly<Record<MobilityPersonTrip['purpose'], number>> = Object.freeze({ commute: 240, shopping: 180 });

export class MobilityScheduler {
  readonly multimodalGraph = new MultimodalRoutingGraph();
  readonly journeyPlanner = new JourneyPlanner();
  readonly modeChoice = new ModeChoiceSystem();
  readonly passengers = new PassengerQueueSystem();
  readonly vehicles = new TransitVehicleSystem();
  readonly operations = new TransitOperationsSystem();

  private readonly decisions: MobilityDecision[] = [];
  private crowdingPenaltyTicks = 0;
  private fiscalOperatingCursor = 0;
  private fiscalFareCursor = 0;

  setCrowdingPenaltyTicks(value: number): number {
    this.crowdingPenaltyTicks = Math.max(0, Number.isFinite(value) ? value : 0);
    return this.crowdingPenaltyTicks;
  }

  tick(context: MobilityTickContext): MobilitySnapshot {
    this.multimodalGraph.rebuild(
      context.roadGraph,
      context.transit,
      (lineId, fromStopId, toStopId, mode) => this.segmentTicks(lineId, fromStopId, toStopId, mode, context),
      context.costEpoch ?? Math.floor(context.tick / 10),
    );

    this.operations.step(
      context.tick,
      context.transit,
      this.vehicles,
      this.passengers,
      context.roadGraph,
      context.pathfinding,
      context.roadTravelTime,
    );

    for (const trip of context.generateTrips()) this.routeTrip(trip, context);
    return this.snapshot();
  }

  snapshot(): MobilitySnapshot {
    const totalDecisionWeight = this.decisions.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const modeWeight = (mode: MobilityDecision['mode']): number => this.decisions.filter((decision) => decision.mode === mode).reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const successful = this.decisions.filter((decision) => decision.mode !== 'unmet' && Number.isFinite(decision.chosenCost));
    const successfulWeight = successful.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const weightedAccessibility = successful.reduce((sum, decision) => {
      const max = MAX_ACCEPTABLE[decision.purpose];
      const quality = Math.max(0, Math.min(1, 1 - decision.chosenCost / max));
      return sum + quality * decision.travelerWeight;
    }, 0);
    const transitDecisions = this.decisions.filter((decision) => decision.mode === 'transit');
    const transitWeight = transitDecisions.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const meanWaitTicks = transitWeight <= 0 ? 0 : transitDecisions.reduce((sum, decision) => sum + decision.expectedWaitTicks * decision.travelerWeight, 0) / transitWeight;

    const lineIds = this.operations.listLineIds();
    let ridership = 0;
    let reliabilityWeight = 0;
    let reliabilityNumerator = 0;
    let transitOperatingCost = 0;
    let transitFareRevenue = 0;
    for (const lineId of lineIds) {
      const line = this.operations.snapshotLineWithVehicles(lineId, this.vehicles);
      ridership += line.completedPassengerWeight;
      transitOperatingCost += line.operatingCost;
      transitFareRevenue += line.fareRevenue;
      const weight = Math.max(1, line.vehicleTicks);
      reliabilityNumerator += line.reliability * weight;
      reliabilityWeight += weight;
    }
    const onboard = this.vehicles.listVehicles().reduce((sum, vehicle) => sum + vehicle.onboard.reduce((inner, cohort) => inner + cohort.travelerWeight, 0), 0);
    const totalCapacity = this.vehicles.listVehicles().reduce((sum, vehicle) => sum + vehicle.capacity, 0);
    const crowding = totalCapacity <= 0 ? 0 : Math.max(0, Math.min(1, onboard / totalCapacity));

    return Object.freeze({
      carModeShare: totalDecisionWeight <= 0 ? 0 : modeWeight('car') / totalDecisionWeight,
      transitModeShare: totalDecisionWeight <= 0 ? 0 : modeWeight('transit') / totalDecisionWeight,
      unmetShare: totalDecisionWeight <= 0 ? 0 : modeWeight('unmet') / totalDecisionWeight,
      personAccessibility: totalDecisionWeight <= 0 ? 1 : (successfulWeight <= 0 ? 0 : weightedAccessibility / totalDecisionWeight),
      ridership,
      meanWaitTicks,
      reliability: reliabilityWeight <= 0 ? 1 : reliabilityNumerator / reliabilityWeight,
      crowding,
      transitOperatingCost,
      transitFareRevenue,
    });
  }

  consumeFiscalDelta(): MobilityFiscalDelta {
    const snapshot = this.snapshot();
    const operatingCost = Math.max(0, snapshot.transitOperatingCost - this.fiscalOperatingCursor);
    const fareRevenue = Math.max(0, snapshot.transitFareRevenue - this.fiscalFareCursor);
    this.fiscalOperatingCursor = snapshot.transitOperatingCost;
    this.fiscalFareCursor = snapshot.transitFareRevenue;
    return Object.freeze({ operatingCost, fareRevenue });
  }

  snapshotState(): MobilitySchedulerStateSnapshot {
    return Object.freeze({
      decisions: Object.freeze(this.decisions.map((decision) => Object.freeze({ ...decision }))),
      crowdingPenaltyTicks: this.crowdingPenaltyTicks,
      fiscalOperatingCursor: this.fiscalOperatingCursor,
      fiscalFareCursor: this.fiscalFareCursor,
      passengers: this.passengers.snapshot(),
      vehicles: this.vehicles.snapshotState(),
      operations: this.operations.snapshotState(),
    });
  }

  restoreState(state: MobilitySchedulerStateSnapshot): void {
    if (!Number.isFinite(state.crowdingPenaltyTicks) || state.crowdingPenaltyTicks < 0
      || !Number.isFinite(state.fiscalOperatingCursor) || state.fiscalOperatingCursor < 0
      || !Number.isFinite(state.fiscalFareCursor) || state.fiscalFareCursor < 0) {
      throw new Error('invalid mobility scheduler state');
    }
    this.decisions.length = 0;
    this.decisions.push(...state.decisions.map((decision) => Object.freeze({ ...decision })));
    this.crowdingPenaltyTicks = state.crowdingPenaltyTicks;
    this.fiscalOperatingCursor = state.fiscalOperatingCursor;
    this.fiscalFareCursor = state.fiscalFareCursor;
    this.passengers.restore(state.passengers);
    this.vehicles.restoreState(state.vehicles);
    this.operations.restoreState(state.operations);
    this.journeyPlanner.clearCache();
    this.multimodalGraph.sourceRoadRevision = -1;
    this.multimodalGraph.sourceTransitRevision = -1;
    this.multimodalGraph.sourceCostEpoch = -1;
  }

  private routeTrip(trip: MobilityPersonTrip, context: MobilityTickContext): void {
    const start = trip.originRoadNodeId;
    const end = trip.destinationRoadNodeId;
    if (!start || !end || start === end) {
      this.record({ mode: 'unmet', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: Number.POSITIVE_INFINITY, expectedWaitTicks: 0 });
      return;
    }

    const carRoute = context.pathfinding.findRoute(context.roadGraph, start, end, {
      edgeCost: context.roadTravelTime,
      costKey: `mobility-car:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
    });
    const carPlan = this.carJourneyPlan(carRoute);
    const transitPlan = this.journeyPlanner.plan(this.multimodalGraph, start, end, {
      mode: 'transit',
      transferPenaltyTicks: 20,
      fareWeightTicksPerCurrency: 4,
      costKey: `mobility-transit:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
    });
    const choice = this.modeChoice.choose(carPlan, transitPlan, { crowdingPenaltyTicks: this.crowdingPenaltyTicks });

    if (choice.mode === 'car' && carRoute) {
      context.submitCarTrip(trip, trip.travelerWeight, carRoute);
      this.record({ mode: 'car', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.chosenCost, expectedWaitTicks: 0 });
      return;
    }
    if (choice.mode === 'transit' && transitPlan && this.enqueueTransitTrip(trip, transitPlan)) {
      this.record({ mode: 'transit', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.chosenCost, expectedWaitTicks: transitPlan.expectedWaitTicks });
      return;
    }
    this.record({ mode: 'unmet', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: Number.POSITIVE_INFINITY, expectedWaitTicks: 0 });
  }

  private carJourneyPlan(route: RouteResult | null): JourneyPlan | null {
    if (!route) return null;
    return Object.freeze({
      mode: 'car',
      nodeIds: Object.freeze([...route.nodeIds]),
      legs: Object.freeze([]),
      totalGeneralizedCost: route.totalCost,
      walkingTicks: 0,
      expectedWaitTicks: 0,
      inVehicleTicks: route.totalCost,
      transferPenaltyTicks: 0,
      fare: 0,
      boardings: 0,
      transfers: 0,
    });
  }

  private enqueueTransitTrip(trip: MobilityPersonTrip, plan: JourneyPlan): boolean {
    const boardingLegs = plan.legs.filter((leg) => leg.kind === 'board' && leg.lineId);
    const alightLegs = plan.legs.filter((leg) => leg.kind === 'alight' && leg.lineId);
    if (boardingLegs.length === 0 || boardingLegs.length !== alightLegs.length) return false;

    const transfers: TransitTransferLeg[] = [];
    for (let i = 1; i < boardingLegs.length; i++) {
      const board = boardingLegs[i];
      const alight = alightLegs[i];
      if (!board?.lineId || !alight?.lineId || board.lineId !== alight.lineId) return false;
      transfers.push({
        lineId: board.lineId,
        directionKey: this.directionForPlan(plan, board.lineId, board.to, alight.from),
        boardingStopId: this.stopIdFromNode(board.from),
        alightingStopId: this.stopIdFromNode(alight.to),
      });
    }

    const firstBoard = boardingLegs[0];
    const firstAlight = alightLegs[0];
    if (!firstBoard?.lineId || !firstAlight?.lineId || firstBoard.lineId !== firstAlight.lineId || !trip.destinationRoadNodeId) return false;
    const cohort: TransitPassengerCohort = Object.freeze({
      id: `transit-passenger:${trip.id}`,
      personTripId: trip.id,
      travelerWeight: trip.travelerWeight,
      lineId: firstBoard.lineId,
      directionKey: this.directionForPlan(plan, firstBoard.lineId, firstBoard.to, firstAlight.from),
      boardingStopId: this.stopIdFromNode(firstBoard.from),
      alightingStopId: this.stopIdFromNode(firstAlight.to),
      destinationRoadNodeId: trip.destinationRoadNodeId,
      enqueuedTick: trip.departureTick,
      transferLegs: Object.freeze(transfers),
    });
    return this.passengers.enqueue(cohort.boardingStopId, cohort.lineId, cohort.directionKey, cohort);
  }

  private directionForPlan(plan: JourneyPlan, lineId: string, platformFrom: string, platformTo: string): 'forward' | 'reverse' {
    const ride = plan.legs.find((leg) => leg.kind === 'ride' && leg.lineId === lineId && leg.from === platformFrom);
    if (!ride) return 'forward';
    const fromStop = this.stopIdFromPlatform(ride.from);
    const toStop = this.stopIdFromPlatform(ride.to);
    return fromStop.localeCompare(toStop) <= 0 ? 'forward' : 'reverse';
  }

  private stopIdFromNode(nodeId: string): string {
    return nodeId.startsWith('stop:') ? nodeId.slice(5) : nodeId;
  }

  private stopIdFromPlatform(nodeId: string): string {
    const parts = nodeId.split(':');
    return parts.slice(2).join(':');
  }

  private segmentTicks(_lineId: string, fromStopId: string, toStopId: string, mode: TransitMode, context: MobilityTickContext): number {
    const from = context.transit.getStop(fromStopId);
    const to = context.transit.getStop(toStopId);
    if (!from || !to) return Number.POSITIVE_INFINITY;
    if (mode === 'metro') return Math.max(10, (Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) * 5);
    const start = this.accessNode(from.x, from.y, context.roadGraph);
    const end = this.accessNode(to.x, to.y, context.roadGraph);
    if (!start || !end) return Number.POSITIVE_INFINITY;
    const route = context.pathfinding.findRoute(context.roadGraph, start, end, {
      edgeCost: context.roadTravelTime,
      costKey: `mobility-segment:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
    });
    if (!route) return Number.POSITIVE_INFINITY;
    const raw = route.totalCost;
    const free = route.edgeIds.reduce((sum, edgeId) => sum + (context.roadGraph.getEdge(edgeId)?.freeFlowTicks ?? 0), 0);
    return mode === 'brt' ? free + (raw - free) * 0.35 : raw;
  }

  private accessNode(x: number, y: number, graph: TransportationGraph): string | null {
    const candidates = [graph.findNodeAt(x, y - 1), graph.findNodeAt(x + 1, y), graph.findNodeAt(x, y + 1), graph.findNodeAt(x - 1, y)]
      .filter((node): node is NonNullable<typeof node> => node !== undefined)
      .map((node) => node.id)
      .sort();
    return candidates[0] ?? null;
  }

  private record(decision: MobilityDecision): void {
    this.decisions.push(Object.freeze({ ...decision }));
    while (this.decisions.length > 128) this.decisions.shift();
  }
}
