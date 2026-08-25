import type { Building } from '../buildings/BuildingSystem.ts';
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

  generate(tick: number, buildings: readonly Building[], population: number, employed: number, graph: TransportationGraph): PersonTripCohort[] {
    const byId = new Map(buildings.map((building) => [building.id, building]));
    return this.generator.generate(tick, buildings, population, employed).map((trip) => {
      const origin = byId.get(trip.originBuildingId); const destination = byId.get(trip.destinationBuildingId);
      const access = origin && destination ? this.connectedAccessPair(origin, destination, graph) : null;
      return Object.freeze({
        id: `person-${trip.id}`, sourceTripId: trip.id, originBuildingId: trip.originBuildingId, destinationBuildingId: trip.destinationBuildingId,
        originRoadNodeId: access?.origin ?? null, destinationRoadNodeId: access?.destination ?? null,
        departureTick: trip.departureTick, travelerWeight: trip.travelerWeight, purpose: trip.purpose,
      });
    }).sort((a, b) => a.id.localeCompare(b.id));
  }

  private accessNodes(building: Building, graph: TransportationGraph): string[] {
    return CARDINAL.map(([dx, dy]) => graph.findNodeAt(building.x + dx, building.y + dy)?.id)
      .filter((id): id is string => id !== undefined)
      .sort();
  }

  private connectedAccessPair(origin: Building, destination: Building, graph: TransportationGraph): { origin: string; destination: string } | null {
    const starts = this.accessNodes(origin, graph);
    const targets = this.accessNodes(destination, graph);
    if (starts.length === 0 || targets.length === 0) return null;
    const targetSet = new Set(targets);
    for (const start of starts) {
      if (targetSet.has(start)) return { origin: start, destination: start };
      const seen = new Set([start]);
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const current = queue[i]!;
        for (const edge of graph.outgoingEdges(current)) {
          if (seen.has(edge.to)) continue;
          if (targetSet.has(edge.to)) return { origin: start, destination: edge.to };
          seen.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    return { origin: starts[0]!, destination: targets[0]! };
  }
}
