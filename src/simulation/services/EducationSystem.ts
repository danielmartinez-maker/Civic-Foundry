import type { Building } from '../buildings/BuildingSystem.ts';
import { definitionForBuilding } from '../buildings/BuildingSystem.ts';
import type { ServiceFacilitySystem } from './ServiceFacilitySystem.ts';
import type { TransportationEdge, TransportationGraph } from '../traffic/TransportationGraph.ts';
import type { PathfindingSystem, RouteResult } from '../traffic/PathfindingSystem.ts';

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
    const schools = facilities.listFacilities().filter((facility) => facility.type === 'elementary_school').sort((a, b) => a.id.localeCompare(b.id));
    const remainingSeats = new Map(schools.map((school) => [school.id, Math.max(0, facilities.effectiveCapacity(school.id))] as const));
    const reachableSchoolIds = new Set<string>();
    let reachableStudents = 0;
    let enrolledStudents = 0;
    let weightedTravel = 0;

    for (const home of homes) {
      const count = allocations.get(home.id) ?? 0;
      if (count <= 0) continue;
      const homeNodes = this.accessNodes(graph, home.x, home.y);
      if (homeNodes.length === 0) continue;
      const choices: Array<{ schoolId: string; route: RouteResult }> = [];
      for (const school of schools) {
        const schoolNodes = this.accessNodes(graph, school.x, school.y);
        const route = this.bestRoute(graph, pathfinding, homeNodes, schoolNodes, edgeCost);
        if (!route) continue;
        reachableSchoolIds.add(school.id);
        choices.push({ schoolId: school.id, route });
      }
      choices.sort((a, b) => a.route.totalCost - b.route.totalCost || a.schoolId.localeCompare(b.schoolId));
      if (choices.length === 0) continue;
      reachableStudents += count;
      weightedTravel += choices[0]!.route.totalCost * count;
      let unassigned = count;
      for (const choice of choices) {
        if (unassigned <= 1e-9) break;
        const available = remainingSeats.get(choice.schoolId) ?? 0;
        if (available <= 0) continue;
        const assigned = Math.min(unassigned, available);
        remainingSeats.set(choice.schoolId, available - assigned);
        enrolledStudents += assigned;
        unassigned -= assigned;
      }
    }

    const effectiveSeats = schools
      .filter((school) => reachableSchoolIds.has(school.id))
      .reduce((sum, school) => sum + facilities.effectiveCapacity(school.id), 0);
    const overcrowdedStudents = Math.max(0, reachableStudents - enrolledStudents);
    const averageSchoolAccessTicks = reachableStudents > 0 ? weightedTravel / reachableStudents : 0;
    const coverageRatio = clamp01(enrolledStudents / Math.max(1, students));
    const accessibilityRatio = reachableStudents > 0 ? clamp01(1 - averageSchoolAccessTicks / MAX_SCHOOL_ACCESS_TICKS) * (reachableStudents / students) : 0;
    const fundingEffectiveness = facilities.fundingEffectiveness('education');
    const educationServiceRatio = clamp01(coverageRatio * accessibilityRatio * fundingEffectiveness);
    return { eligibleStudents: students, reachableStudents, enrolledStudents, effectiveSeats, overcrowdedStudents, averageSchoolAccessTicks, educationServiceRatio };
  }

  private accessNodes(graph: TransportationGraph, x: number, y: number): string[] {
    return CARDINAL
      .map(([dx, dy]) => graph.findNodeAt(x + dx, y + dy)?.id)
      .filter((id): id is string => id !== undefined)
      .sort();
  }

  private bestRoute(
    graph: TransportationGraph,
    pathfinding: PathfindingSystem,
    starts: readonly string[],
    ends: readonly string[],
    edgeCost: (edge: TransportationEdge) => number,
  ): RouteResult | null {
    let best: RouteResult | null = null;
    for (const start of starts) {
      for (const end of ends) {
        const route = pathfinding.findRoute(graph, start, end, { edgeCost });
        if (!route) continue;
        if (!best || route.totalCost < best.totalCost - 1e-9
          || (Math.abs(route.totalCost - best.totalCost) <= 1e-9 && route.edgeIds.join('|').localeCompare(best.edgeIds.join('|')) < 0)) best = route;
      }
    }
    return best;
  }

  private allocateStudents(homes: readonly Building[], total: number): Map<string, number> {
    const result = new Map<string, number>();
    const capacity = homes.reduce((sum, home) => sum + definitionForBuilding(home).residentCapacity, 0);
    let assigned = 0;
    const remainder: Array<{ id: string; value: number }> = [];
    for (const home of homes) {
      const raw = total * definitionForBuilding(home).residentCapacity / Math.max(1, capacity);
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
