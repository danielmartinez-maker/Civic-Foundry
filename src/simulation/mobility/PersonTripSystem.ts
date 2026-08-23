import type { Building } from '../buildings/BuildingSystem.ts';
import type { HouseholdTravelDemand } from '../housing/HousingTypes.ts';
import type { TransportationGraph } from '../traffic/TransportationGraph.ts';
import { TripGenerationSystem, type TripPurpose } from '../traffic/TripGenerationSystem.ts';

export type PersonTripCohort = Readonly<{
  id: string;
  sourceTripId: string;
  originBuildingId: string;
  destinationBuildingId: string;
  originRoadNodeId: string | null;
  destinationRoadNodeId: string | null;
  departureTick: number;
  travelerWeight: number;
  purpose: TripPurpose;
}>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

export class PersonTripSystem {
  private readonly generator: TripGenerationSystem;
  constructor(generator: TripGenerationSystem) { this.generator = generator; }

  generate(
    tick: number,
    buildings: readonly Building[],
    population: number,
    employed: number,
    graph: TransportationGraph,
    householdDemand?: readonly HouseholdTravelDemand[],
  ): PersonTripCohort[] {
    const byId = new Map(buildings.map((building) => [building.id, building]));
    const requests = householdDemand === undefined
      ? this.generator.generate(tick, buildings, population, employed)
      : this.generator.generateHouseholdDemand(tick, buildings, householdDemand);
    return requests.map((trip) => {
      const origin = byId.get(trip.originBuildingId); const destination = byId.get(trip.destinationBuildingId);
      return Object.freeze({
        id: `person-${trip.id}`, sourceTripId: trip.id, originBuildingId: trip.originBuildingId, destinationBuildingId: trip.destinationBuildingId,
        originRoadNodeId: origin ? this.accessNode(origin, graph) : null, destinationRoadNodeId: destination ? this.accessNode(destination, graph) : null,
        departureTick: trip.departureTick, travelerWeight: trip.travelerWeight, purpose: trip.purpose,
      });
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  private accessNode(building: Building, graph: TransportationGraph): string | null {
    return CARDINAL.map(([dx, dy]) => graph.findNodeAt(building.x + dx, building.y + dy)?.id).filter((id): id is string => id !== undefined).sort()[0] ?? null;
  }
}
