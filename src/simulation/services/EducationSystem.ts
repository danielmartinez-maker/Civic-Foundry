import { BUILDING_DEFINITIONS } from '../../data/buildings.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem } from '../traffic/PathfindingSystem.ts';

export type EducationSnapshot = Readonly<{
  eligibleStudents: number;
  reachableStudents: number;
  enrolledStudents: number;
  effectiveSeats: number;
  overcrowdedStudents: number;
  averageSchoolAccessTicks: number;
  educationServiceRatio: number;
}>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const MAX_SCHOOL_ACCESS_TICKS = 300;
const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class EducationSystem {
  evaluate(
    buildings: readonly Building[],
    eligibleStudents: number,
    facilities: ServiceFacilitySystem,
    graph: TransportationGraph,
    pathfinding: PathfindingSystem,
    edgeCost: (edge: TransportationEdge) => number,
  ): EducationSnapshot {
    const homes = buildings.filter((building) => building.status === 'occupied' && building.zone === 'residential').sort((a, b) => a.id.localeCompare(b.id));
    const students = Math.max(0, Math.round(eligibleStudents));
    if (students === 0) return { eligibleStudents: 0, reachableStudents: 0, enrolledStudents: 0, effectiveSeats: 0, overcrowdedStudents: 0, averageSchoolAccessTicks: 0, educationServiceRatio: 1 };
    if (homes.length === 0) return { eligibleStudents: students, reachableStudents: 0, enrolledStudents: 0, effectiveSeats: 0, overcrowdedStudents: students, averageSchoolAccessTicks: 0, educationServiceRatio: 0 };

    const allocations = this.allocateStudents(homes, students);
    const schools = facilities.listFacilities().filter((facility) => facility.type === 'elementary_school');
    const reachableSchoolIds = new Set<string>();
    let reachableStudents = 0;
    let weightedTravel = 0;

    for (const home of homes) {
      const count = allocations.get(home.id) ?? 0;
      if (count <= 0) continue;
      const homeNode = this.accessNode(graph, home.x, home.y);
      if (!homeNode) continue;
      let bestTravel = Number.POSITIVE_INFINITY;
      let bestSchoolId: string | null = null;
      for (const school of schools) {
        const schoolNode = this.accessNode(graph, school.x, school.y);
        if (!schoolNode) continue;
        const route = pathfinding.findRoute(graph, homeNode, schoolNode, { edgeCost, costKey: 'education-access' });
        if (!route) continue;
        if (route.totalCost < bestTravel - 1e-9 || (Math.abs(route.totalCost - bestTravel) <= 1e-9 && school.id.localeCompare(bestSchoolId ?? '') < 0)) {
          bestTravel = route.totalCost;
          bestSchoolId = school.id;
        }
      }
      if (!bestSchoolId) continue;
      reachableStudents += count;
      weightedTravel += bestTravel * count;
      reachableSchoolIds.add(bestSchoolId);
    }

    const effectiveSeats = schools.filter((school) => reachableSchoolIds.has(school.id)).reduce((sum, school) => sum + facilities.effectiveCapacity(school.id), 0);
    const enrolledStudents = Math.min(reachableStudents, effectiveSeats);
    const overcrowdedStudents = Math.max(0, reachableStudents - effectiveSeats);
    const averageSchoolAccessTicks = reachableStudents > 0 ? weightedTravel / reachableStudents : 0;
    const coverageRatio = clamp01(effectiveSeats / Math.max(1, students));
    const accessibilityRatio = reachableStudents > 0 ? clamp01(1 - averageSchoolAccessTicks / MAX_SCHOOL_ACCESS_TICKS) * (reachableStudents / students) : 0;
    const fundingEffectiveness = facilities.fundingEffectiveness('education');
    const educationServiceRatio = clamp01(coverageRatio * accessibilityRatio * fundingEffectiveness);
    return { eligibleStudents: students, reachableStudents, enrolledStudents, effectiveSeats, overcrowdedStudents, averageSchoolAccessTicks, educationServiceRatio };
  }

  private accessNode(graph: TransportationGraph, x: number, y: number): string | undefined {
    return CARDINAL.map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy)).filter((node): node is NonNullable<typeof node> => node !== undefined).sort((a, b) => a.id.localeCompare(b.id))[0]?.id;
  }

  private allocateStudents(homes: readonly Building[], total: number): Map<string, number> {
    const result = new Map<string, number>();
    const capacity = homes.reduce((sum, home) => sum + BUILDING_DEFINITIONS[home.zone].residentCapacity, 0);
    let assigned = 0;
    const remainder: Array<{ id: string; value: number }> = [];
    for (const home of homes) {
      const raw = total * BUILDING_DEFINITIONS[home.zone].residentCapacity / Math.max(1, capacity);
      const base = Math.floor(raw);
      result.set(home.id, base);
      assigned += base;
      remainder.push({ id: home.id, value: raw - base });
    }
    remainder.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
    for (let i = 0; assigned < total; i++, assigned++) {
      const next = remainder[i % remainder.length];
      if (next) result.set(next.id, (result.get(next.id) ?? 0) + 1);
    }
    return result;
  }
}
