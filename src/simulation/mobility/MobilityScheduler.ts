import type { TransitMode } from '../../data/transit.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';
import { MultimodalRoutingGraph } from '../transit/MultimodalRoutingGraph.ts';
import { JourneyPlanner } from '../transit/JourneyPlanner.ts';
import type { TransitNetworkSystem } from '../transit/TransitNetworkSystem.ts';
import { PassengerQueueSystem, type PassengerQueueSnapshot } from '../transit/PassengerQueueSystem.ts';
import { TransitVehicleSystem, type TransitVehicleStateSnapshot } from '../transit/TransitVehicleSystem.ts';
import { TransitOperationsSystem, type TransitOperationsStateSnapshot } from '../transit/TransitOperationsSystem.ts';
import { listMobilityModes } from './MobilityModeRegistry.ts';
import { MobilityOrchestrator } from './MobilityOrchestrator.ts';
import { MobilityProviderRegistry, type MobilityRuntimeContext } from './MobilityProvider.ts';
import type { MobilityJourneyRequest, MobilityModeId } from './MobilityTypes.ts';
import { LegacyCarMobilityProvider } from './providers/LegacyCarMobilityProvider.ts';
import { LegacyTransitMobilityProvider } from './providers/LegacyTransitMobilityProvider.ts';

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
  modeShares: Readonly<Record<MobilityModeId, number>>;
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

type DerivedCanonicalDecision = Readonly<{ mode: MobilityModeId | null; travelerWeight: number }>;

const MAX_ACCEPTABLE: Readonly<Record<MobilityPersonTrip['purpose'], number>> = Object.freeze({ commute: 240, shopping: 180 });
const QUEUE_PRESSURE_TICKS_PER_VEHICLE_LOAD = 60;
const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const LEGACY_TRANSIT_MODES = new Set<MobilityModeId>(['bus', 'brt', 'tram', 'metro']);

export class MobilityScheduler {
  readonly multimodalGraph = new MultimodalRoutingGraph();
  readonly journeyPlanner = new JourneyPlanner();
  readonly passengers = new PassengerQueueSystem();
  readonly vehicles = new TransitVehicleSystem();
  readonly operations = new TransitOperationsSystem();
  readonly providers = new MobilityProviderRegistry([
    new LegacyCarMobilityProvider(),
    new LegacyTransitMobilityProvider(),
  ]);
  readonly orchestrator = new MobilityOrchestrator(this.providers);

  private readonly decisions: MobilityDecision[] = [];
  private readonly canonicalModeWeights = new Map<MobilityModeId, number>();
  private readonly canonicalDecisionWindow: DerivedCanonicalDecision[] = [];
  private crowdingPenaltyTicks = 0;
  private fiscalOperatingCursor = 0;
  private fiscalFareCursor = 0;

  setCrowdingPenaltyTicks(value: number): number {
    this.crowdingPenaltyTicks = Math.max(0, Number.isFinite(value) ? value : 0);
    return this.crowdingPenaltyTicks;
  }

  tick(context: MobilityTickContext): MobilitySnapshot {
    const costEpoch = context.costEpoch ?? Math.floor(context.tick / 10);
    this.multimodalGraph.rebuild(
      context.roadGraph,
      context.transit,
      (lineId, fromStopId, toStopId, mode) => this.segmentTicks(lineId, fromStopId, toStopId, mode, context),
      costEpoch,
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

    const trips = [...context.generateTrips()];
    const tripsBySource = new Map<string, MobilityPersonTrip>();
    for (const trip of trips) tripsBySource.set(trip.sourceTripId, trip);
    const runtime: MobilityRuntimeContext = Object.freeze({
      tick: context.tick,
      costEpoch,
      roadGraph: context.roadGraph,
      transit: context.transit,
      pathfinding: context.pathfinding,
      roadTravelTime: context.roadTravelTime,
      multimodalGraph: this.multimodalGraph,
      journeyPlanner: this.journeyPlanner,
      passengers: this.passengers,
      crowdingPenaltyTicks: this.crowdingPenaltyTicks + this.capacityPressureTicks(),
      submitLegacyCarTrip: (sourceTripId, travelerWeight, route) => {
        const trip = tripsBySource.get(sourceTripId);
        if (!trip) throw new Error(`unknown legacy mobility source trip: ${sourceTripId}`);
        context.submitCarTrip(trip, travelerWeight, route);
      },
    });

    for (const trip of trips) this.routeTrip(trip, runtime);
    return this.snapshot();
  }

  snapshot(): MobilitySnapshot {
    const totalDecisionWeight = this.decisions.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const modeWeight = (mode: MobilityDecision['mode']): number => this.decisions.filter((decision) => decision.mode === mode).reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const modeShares = Object.freeze(Object.fromEntries(listMobilityModes().map(({ id }) => [
      id,
      totalDecisionWeight <= 0 ? 0 : (this.canonicalModeWeights.get(id) ?? 0) / totalDecisionWeight,
    ])) as Record<MobilityModeId, number>);
    const successful = this.decisions.filter((decision) => decision.mode !== 'unmet' && Number.isFinite(decision.chosenCost));
    const successfulWeight = successful.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const weightedAccessibility = successful.reduce((sum, decision) => {
      const max = MAX_ACCEPTABLE[decision.purpose];
      const quality = Math.max(0, Math.min(1, 1 - decision.chosenCost / max));
      return sum + quality * decision.travelerWeight;
    }, 0);
    const transitDecisions = this.decisions.filter((decision) => decision.mode === 'transit');
    const transitWeight = transitDecisions.reduce((sum, decision) => sum + decision.travelerWeight, 0);
    const scheduledWaitTicks = transitWeight <= 0 ? 0 : transitDecisions.reduce((sum, decision) => sum + decision.expectedWaitTicks * decision.travelerWeight, 0) / transitWeight;
    const meanWaitTicks = scheduledWaitTicks + this.capacityPressureTicks();

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
      modeShares,
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
    this.canonicalModeWeights.clear();
    this.canonicalDecisionWindow.length = 0;
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

  private routeTrip(trip: MobilityPersonTrip, runtime: MobilityRuntimeContext): void {
    const request: MobilityJourneyRequest = Object.freeze({
      id: trip.id,
      sourceTripId: trip.sourceTripId,
      provenance: 'legacy_cohort',
      originRoadNodeId: trip.originRoadNodeId,
      destinationRoadNodeId: trip.destinationRoadNodeId,
      departureTick: trip.departureTick,
      travelerWeight: trip.travelerWeight,
      purpose: trip.purpose,
      capabilities: Object.freeze({
        privateVehicleAccess: true,
        licensedDriver: true,
        bicycleAccess: false,
        rideHailAvailable: false,
        mobilityLimited: false,
        farePaymentAccess: true,
      }),
      costEpoch: runtime.costEpoch,
    });
    const outcome = this.orchestrator.resolveAndExecute(request, runtime);
    const alternative = outcome.alternative;
    if (!alternative || outcome.outcome === 'unmet') {
      this.record({ mode: 'unmet', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: Number.POSITIVE_INFINITY, expectedWaitTicks: 0 }, null);
      return;
    }
    if (outcome.outcome === 'car') {
      this.record({ mode: 'car', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: alternative.cost.generalizedCost, expectedWaitTicks: 0 }, 'car');
      return;
    }
    if (LEGACY_TRANSIT_MODES.has(outcome.outcome)) {
      this.record({ mode: 'transit', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: alternative.cost.generalizedCost, expectedWaitTicks: alternative.cost.expectedWaitTicks }, outcome.outcome);
      return;
    }
    throw new Error(`unsupported live mobility mode: ${outcome.outcome}`);
  }

  private segmentTicks(_lineId: string, fromStopId: string, toStopId: string, mode: TransitMode, context: MobilityTickContext): number {
    const from = context.transit.getStop(fromStopId);
    const to = context.transit.getStop(toStopId);
    if (!from || !to) return Number.POSITIVE_INFINITY;
    if (mode === 'metro') return Math.max(10, (Math.abs(from.x - to.x) + Math.abs(from.y - to.y)) * 5);
    const starts = this.accessNodes(from.x, from.y, context.roadGraph);
    const ends = this.accessNodes(to.x, to.y, context.roadGraph);
    if (starts.length === 0 || ends.length === 0) return Number.POSITIVE_INFINITY;
    let route: RouteResult | null = null;
    for (const start of starts) {
      for (const end of ends) {
        const candidate = context.pathfinding.findRoute(context.roadGraph, start, end, {
          edgeCost: context.roadTravelTime,
          costKey: `mobility-segment:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
        });
        if (!candidate) continue;
        if (!route || candidate.totalCost < route.totalCost - 1e-9
          || (Math.abs(candidate.totalCost - route.totalCost) <= 1e-9 && candidate.edgeIds.join('|').localeCompare(route.edgeIds.join('|')) < 0)) route = candidate;
      }
    }
    if (!route) return Number.POSITIVE_INFINITY;
    const raw = route.totalCost;
    const free = route.edgeIds.reduce((sum, edgeId) => sum + (context.roadGraph.getEdge(edgeId)?.freeFlowTicks ?? 0), 0);
    return mode === 'brt' ? free + (raw - free) * 0.35 : raw;
  }

  private accessNodes(x: number, y: number, graph: TransportationGraph): string[] {
    return CARDINAL
      .map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy)?.id)
      .filter((id): id is string => id !== undefined)
      .sort();
  }

  private capacityPressureTicks(): number {
    const waitingByLine = new Map<string, number>();
    for (const queue of this.passengers.snapshot().queues) {
      const waiting = queue.cohorts.reduce((sum, cohort) => sum + Math.max(0, cohort.travelerWeight), 0);
      if (waiting > 0) waitingByLine.set(queue.lineId, (waitingByLine.get(queue.lineId) ?? 0) + waiting);
    }
    if (waitingByLine.size === 0) return 0;

    const capacityByLine = new Map<string, number>();
    for (const vehicle of this.vehicles.listVehicles()) {
      if (vehicle.state === 'out_of_service') continue;
      capacityByLine.set(vehicle.lineId, (capacityByLine.get(vehicle.lineId) ?? 0) + Math.max(0, vehicle.capacity));
    }

    let totalWaiting = 0;
    let weightedPenalty = 0;
    for (const [lineId, waiting] of [...waitingByLine.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const activeCapacity = capacityByLine.get(lineId) ?? 0;
      const penalty = activeCapacity <= 0
        ? 600
        : Math.min(600, waiting / Math.max(1, activeCapacity) * QUEUE_PRESSURE_TICKS_PER_VEHICLE_LOAD);
      totalWaiting += waiting;
      weightedPenalty += penalty * waiting;
    }
    return totalWaiting <= 0 ? 0 : weightedPenalty / totalWaiting;
  }

  private record(decision: MobilityDecision, canonicalMode: MobilityModeId | null): void {
    const frozen = Object.freeze({ ...decision });
    this.decisions.push(frozen);
    this.canonicalDecisionWindow.push(Object.freeze({ mode: canonicalMode, travelerWeight: decision.travelerWeight }));
    if (canonicalMode) this.canonicalModeWeights.set(canonicalMode, (this.canonicalModeWeights.get(canonicalMode) ?? 0) + decision.travelerWeight);

    while (this.decisions.length > 128) this.decisions.shift();
    while (this.canonicalDecisionWindow.length > 128) {
      const removed = this.canonicalDecisionWindow.shift();
      if (!removed?.mode) continue;
      const next = Math.max(0, (this.canonicalModeWeights.get(removed.mode) ?? 0) - removed.travelerWeight);
      if (next <= 1e-9) this.canonicalModeWeights.delete(removed.mode);
      else this.canonicalModeWeights.set(removed.mode, next);
    }
  }
}
