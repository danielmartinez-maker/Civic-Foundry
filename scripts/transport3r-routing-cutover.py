from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"missing patch anchor in {path}: {old[:140]!r}")
    file.write_text(text.replace(old, new, count))


# MobilityScheduler: injectable production route/generalized-cost/parking seams.
replace(
    "src/simulation/mobility/MobilityScheduler.ts",
    "  costEpoch?: number;\n  generateTrips: () => readonly MobilityPersonTrip[];",
    "  costEpoch?: number;\n  routeCar?: (trip: MobilityPersonTrip, startNodeId: string, endNodeId: string) => RouteResult | null;\n  generalizedCost?: (mode: 'car' | 'transit', trip: MobilityPersonTrip, plan: JourneyPlan) => number | null;\n  reserveCarTrip?: (trip: MobilityPersonTrip) => boolean;\n  generateTrips: () => readonly MobilityPersonTrip[];",
)
replace(
    "src/simulation/mobility/MobilityScheduler.ts",
    """    const carRoute = context.pathfinding.findRoute(context.roadGraph, start, end, {
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
    const choice = this.modeChoice.choose(carPlan, transitPlan, { crowdingPenaltyTicks: this.crowdingPenaltyTicks + this.capacityPressureTicks() });

    if (choice.mode === 'car' && carRoute) {
      context.submitCarTrip(trip, trip.travelerWeight, carRoute);
      this.record({ mode: 'car', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.chosenCost, expectedWaitTicks: 0 });
      return;
    }
    if (choice.mode === 'transit' && transitPlan && this.enqueueTransitTrip(trip, transitPlan, context.transit)) {
      this.record({ mode: 'transit', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.chosenCost, expectedWaitTicks: transitPlan.expectedWaitTicks });
      return;
    }
    this.record({ mode: 'unmet', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: Number.POSITIVE_INFINITY, expectedWaitTicks: 0 });""",
    """    const carRoute = context.routeCar
      ? context.routeCar(trip, start, end)
      : context.pathfinding.findRoute(context.roadGraph, start, end, {
          edgeCost: context.roadTravelTime,
          costKey: `mobility-car:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
        });
    const rawCarPlan = this.carJourneyPlan(carRoute);
    const rawTransitPlan = this.journeyPlanner.plan(this.multimodalGraph, start, end, {
      mode: 'transit',
      transferPenaltyTicks: 20,
      fareWeightTicksPerCurrency: 4,
      costKey: `mobility-transit:${context.costEpoch ?? Math.floor(context.tick / 10)}`,
    });
    const carPlan = this.applyGeneralizedCost('car', trip, rawCarPlan, context);
    const transitPlan = this.applyGeneralizedCost('transit', trip, rawTransitPlan, context);
    const choice = this.modeChoice.choose(carPlan, transitPlan, {
      crowdingPenaltyTicks: this.crowdingPenaltyTicks + this.capacityPressureTicks(),
    });

    if (choice.mode === 'car' && carRoute && carPlan && (context.reserveCarTrip?.(trip) ?? true)) {
      context.submitCarTrip(trip, trip.travelerWeight, carRoute);
      this.record({ mode: 'car', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.carCost, expectedWaitTicks: 0 });
      return;
    }
    if (choice.mode === 'transit' && transitPlan && this.enqueueTransitTrip(trip, transitPlan, context.transit)) {
      this.record({ mode: 'transit', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.transitCost, expectedWaitTicks: transitPlan.expectedWaitTicks });
      return;
    }
    if (choice.mode === 'transit' && carRoute && carPlan && (context.reserveCarTrip?.(trip) ?? true)) {
      context.submitCarTrip(trip, trip.travelerWeight, carRoute);
      this.record({ mode: 'car', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: choice.carCost, expectedWaitTicks: 0 });
      return;
    }
    this.record({ mode: 'unmet', travelerWeight: trip.travelerWeight, purpose: trip.purpose, chosenCost: Number.POSITIVE_INFINITY, expectedWaitTicks: 0 });""",
)
replace(
    "src/simulation/mobility/MobilityScheduler.ts",
    "  private carJourneyPlan(route: RouteResult | null): JourneyPlan | null {",
    """  private applyGeneralizedCost(
    mode: 'car' | 'transit',
    trip: MobilityPersonTrip,
    plan: JourneyPlan | null,
    context: MobilityTickContext,
  ): JourneyPlan | null {
    if (!plan) return null;
    const cost = context.generalizedCost?.(mode, trip, plan);
    if (cost === null) return null;
    if (cost === undefined) return plan;
    if (!Number.isFinite(cost) || cost < 0) throw new Error('invalid generalized travel cost');
    return Object.freeze({ ...plan, totalGeneralizedCost: cost });
  }

  private carJourneyPlan(route: RouteResult | null): JourneyPlan | null {""",
)

# Legacy core: overridable transportation seams with legacy defaults.
replace(
    "src/simulation/core/LegacySimulationCoreBase.ts",
    'import { TransportationGraph } from "../traffic/TransportationGraph.ts";\nimport { PathfindingSystem } from "../traffic/PathfindingSystem.ts";',
    'import {\n  TransportationGraph,\n  type TransportationEdge,\n} from "../traffic/TransportationGraph.ts";\nimport {\n  PathfindingSystem,\n  type RouteResult,\n} from "../traffic/PathfindingSystem.ts";',
)
replace(
    "src/simulation/core/LegacySimulationCoreBase.ts",
    '  MobilityScheduler,\n  type MobilitySnapshot,\n} from "../mobility/MobilityScheduler.ts";',
    '  MobilityScheduler,\n  type MobilityPersonTrip,\n  type MobilitySnapshot,\n} from "../mobility/MobilityScheduler.ts";\nimport type { JourneyPlan } from "../transit/JourneyPlanner.ts";',
)
legacy = Path("src/simulation/core/LegacySimulationCoreBase.ts")
legacy_text = legacy.read_text().replace(
    "this.traffic.getEdgeTravelTime(edge)", "this.roadTravelTime(edge)"
)
legacy.write_text(legacy_text)
replace(
    "src/simulation/core/LegacySimulationCoreBase.ts",
    """  protected refreshTransportationGraph(): void {
    this.transportationGraph.rebuildIfNeeded(this.roads);
  }""",
    """  protected refreshTransportationGraph(): void {
    this.transportationGraph.rebuildIfNeeded(this.roads);
  }

  protected prepareTransportationRouting(): void {}

  protected roadTravelTime(edge: TransportationEdge): number {
    return this.traffic.getEdgeTravelTime(edge);
  }

  protected transportationCostEpoch(): number {
    return this.traffic.congestionEpoch;
  }

  protected routeCarTrip(
    _trip: MobilityPersonTrip,
    startNodeId: string,
    endNodeId: string,
  ): RouteResult | null {
    return this.pathfinding.findRoute(
      this.transportationGraph,
      startNodeId,
      endNodeId,
      {
        edgeCost: (edge) => this.roadTravelTime(edge),
        costKey: `mobility-car:${this.transportationCostEpoch()}`,
      },
    );
  }

  protected generalizedTravelCost(
    _mode: 'car' | 'transit',
    _trip: MobilityPersonTrip,
    plan: JourneyPlan,
  ): number | null {
    return plan.totalGeneralizedCost;
  }

  protected reserveCarTrip(_trip: MobilityPersonTrip): boolean {
    return true;
  }""",
)
replace(
    "src/simulation/core/LegacySimulationCoreBase.ts",
    """  private runLegacyV7Tick(): void {
    this.refreshTransportationGraph();
    this.serviceVehicles.syncFleet(this.services);""",
    """  private runLegacyV7Tick(): void {
    this.refreshTransportationGraph();
    this.prepareTransportationRouting();
    this.serviceVehicles.syncFleet(this.services);""",
)
replace(
    "src/simulation/core/LegacySimulationCoreBase.ts",
    """      roadTravelTime: (edge) => this.roadTravelTime(edge),
      costEpoch: this.traffic.congestionEpoch,""",
    """      roadTravelTime: (edge) => this.roadTravelTime(edge),
      costEpoch: this.transportationCostEpoch(),
      routeCar: (trip, startNodeId, endNodeId) =>
        this.routeCarTrip(trip, startNodeId, endNodeId),
      generalizedCost: (mode, trip, plan) =>
        this.generalizedTravelCost(mode, trip, plan),
      reserveCarTrip: (trip) => this.reserveCarTrip(trip),""",
)

# Production core: route and cost through Transportation3RRuntime.
replace(
    "src/simulation/core/SimulationCoreBase.ts",
    'import { MovementAwareIntersectionAdapter } from "../transportation/MovementAwareIntersectionAdapter.ts";',
    'import { MovementAwareIntersectionAdapter } from "../transportation/MovementAwareIntersectionAdapter.ts";\nimport { VEHICLE_PERMISSION } from "../transportation/TransportNetworkTypes.ts";\nimport type { TransportationEdge } from "../traffic/TransportationGraph.ts";\nimport type { RouteResult } from "../traffic/PathfindingSystem.ts";\nimport type { MobilityPersonTrip } from "../mobility/MobilityScheduler.ts";\nimport type { JourneyPlan } from "../transit/JourneyPlanner.ts";',
)
replace(
    "src/simulation/core/SimulationCoreBase.ts",
    """  protected override refreshTransportationGraph(): void {
    this.transportation3R.refreshNetwork(this.roads, this.transportationGraph);
  }""",
    """  protected override refreshTransportationGraph(): void {
    this.transportation3R.refreshNetwork(this.roads, this.transportationGraph);
  }

  protected override prepareTransportationRouting(): void {
    for (const outcome of this.traffic.recentOutcomes) {
      this.transportation3R.parking.release(`trip:${outcome.tripId}`);
    }
    this.transportation3R.updateCosts(
      this.transportationGraph,
      this.traffic.edgeMetrics,
      this.clock.tick,
    );
  }

  protected override roadTravelTime(edge: TransportationEdge): number {
    return this.transportation3R.incidentAdjustedEdgeCost(
      edge,
      this.traffic.getEdgeTravelTime(edge),
    );
  }

  protected override transportationCostEpoch(): number {
    return this.transportation3R.dynamicRouting.costEpoch;
  }

  protected override routeCarTrip(
    trip: MobilityPersonTrip,
    startNodeId: string,
    endNodeId: string,
  ): RouteResult | null {
    return this.transportation3R.findLegacyRoute(
      this.transportationGraph,
      startNodeId,
      endNodeId,
      {
        permissions: VEHICLE_PERMISSION.privateCar,
        destinationAccessible: this.carDestinationAvailable(
          trip.destinationBuildingId,
        ),
      },
    );
  }

  protected override generalizedTravelCost(
    mode: 'car' | 'transit',
    trip: MobilityPersonTrip,
    plan: JourneyPlan,
  ): number | null {
    const reliabilityPenaltyTicks =
      mode === 'car'
        ? this.trafficSnapshot.congestionIndex * 20
        : (1 - this.mobilitySnapshot.reliability) * 20;
    if (mode === 'car') {
      const parking = this.parkingState(trip.destinationBuildingId);
      return (
        this.transportation3R.generalizedCosts.evaluate({
          mode,
          available: parking === null || parking.available > 0,
          inVehicleTimeTicks: plan.inVehicleTicks,
          waitTimeTicks: 0,
          accessEgressTicks: 0,
          transferCount: 0,
          transferPenaltyTicks: 0,
          reliabilityPenaltyTicks,
          parkingSearchTicks: parking?.searchPenaltyTicks ?? 0,
          moneyCost: parking?.pricePerTrip ?? 0,
          moneyWeightTicksPerCurrency: 4,
        })?.totalTicks ?? null
      );
    }
    return (
      this.transportation3R.generalizedCosts.evaluate({
        mode,
        available: true,
        inVehicleTimeTicks: plan.inVehicleTicks,
        waitTimeTicks: plan.expectedWaitTicks,
        accessEgressTicks: plan.walkingTicks,
        transferCount: plan.transfers,
        transferPenaltyTicks:
          plan.transfers > 0 ? plan.transferPenaltyTicks / plan.transfers : 0,
        reliabilityPenaltyTicks,
        parkingSearchTicks: 0,
        moneyCost: plan.fare,
        moneyWeightTicksPerCurrency: 4,
      })?.totalTicks ?? null
    );
  }

  protected override reserveCarTrip(trip: MobilityPersonTrip): boolean {
    const parking = this.parkingState(trip.destinationBuildingId);
    if (parking === null) return true;
    return (
      this.transportation3R.parking.reserve(
        trip.destinationBuildingId,
        `trip:${trip.sourceTripId}`,
      ) !== null
    );
  }

  private parkingState(destinationBuildingId: string) {
    const hasExplicitParking = this.transportation3R.parking
      .snapshot()
      .facilities.some(
        (facility) => facility.destinationId === destinationBuildingId,
      );
    return hasExplicitParking
      ? this.transportation3R.parking.destinationState(destinationBuildingId)
      : null;
  }

  private carDestinationAvailable(destinationBuildingId: string): boolean {
    const parking = this.parkingState(destinationBuildingId);
    return parking === null || parking.available > 0;
  }""",
)

# Active service vehicles must reroute when their current route becomes incident-closed.
replace(
    "src/simulation/services/ServiceVehicleSystem.ts",
    """    if (
      route
        .slice(vehicle.currentEdgeIndex)
        .every((edgeId) => graph.getEdge(edgeId))
    )
      return true;""",
    """    if (
      route.slice(vehicle.currentEdgeIndex).every((edgeId) => {
        const edge = graph.getEdge(edgeId);
        return (
          edge !== undefined &&
          Number.isFinite(this.edgeTravelTicks(vehicle, edge, edgeCost))
        );
      })
    )
      return true;""",
)
