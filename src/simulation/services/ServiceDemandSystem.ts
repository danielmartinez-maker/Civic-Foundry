import { BUILDING_DEFINITIONS } from '../../data/buildings.ts';
import type { ServiceDepartment } from '../../data/services.ts';
import type { Building } from '../buildings/BuildingSystem.ts';

export type ServiceAccessInputs = Partial<Record<ServiceDepartment, number>>;
export type UnresolvedServiceInputs = Partial<Record<'fire' | 'police' | 'healthcare', number>>;

export type ServiceDemandInput = Readonly<{
  population: number;
  workforce: number;
  unemployed: number;
  utilityByBuilding: Readonly<Record<string, { power: number; water: number }>>;
  wasteByBuilding: Readonly<Record<string, number>>;
  unresolvedByBuilding: Readonly<Record<string, UnresolvedServiceInputs>>;
  priorAccessByBuilding: Readonly<Record<string, ServiceAccessInputs>>;
}>;

export type BuildingServiceDemand = Readonly<{
  fire: number;
  police: number;
  healthcare: number;
  educationStudents: number;
  garbage: number;
}>;

export type ServiceDemandSnapshot = Readonly<{
  eligibleStudents: number;
  perBuilding: Readonly<Record<string, BuildingServiceDemand>>;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class ServiceDemandSystem {
  readonly schoolAgeShare = 0.18;

  evaluate(buildings: readonly Building[], input: ServiceDemandInput): ServiceDemandSnapshot {
    const occupied = buildings.filter((building) => building.status === 'occupied').sort((a, b) => a.id.localeCompare(b.id));
    const residential = occupied.filter((building) => building.zone === 'residential');
    const eligibleStudents = Math.max(0, Math.round(input.population * this.schoolAgeShare));
    const studentAllocation = this.allocateStudents(residential, eligibleStudents);
    const residentialCapacity = residential.reduce((sum, building) => sum + BUILDING_DEFINITIONS[building.zone].residentCapacity, 0);
    const unemploymentPressure = input.workforce <= 0 ? 0 : clamp01(input.unemployed / input.workforce);
    const perBuilding: Record<string, BuildingServiceDemand> = {};

    for (const building of occupied) {
      const definition = BUILDING_DEFINITIONS[building.zone];
      const populationShare = building.zone === 'residential' && residentialCapacity > 0
        ? Math.max(0, input.population) * definition.residentCapacity / residentialCapacity
        : 0;
      const unresolved = input.unresolvedByBuilding[building.id] ?? {};
      const priorAccess = input.priorAccessByBuilding[building.id] ?? {};
      const utility = input.utilityByBuilding[building.id] ?? { power: 0, water: 0 };
      const waste = Math.max(0, input.wasteByBuilding[building.id] ?? 0);
      const occupancyFactor = clamp01(populationShare / Math.max(1, definition.residentCapacity));
      const baseFire = building.zone === 'industrial' ? 0.22 : building.zone === 'commercial' ? 0.12 : 0.08;
      const fire = baseFire
        + occupancyFactor * 0.08
        + (building.zone === 'industrial' ? 0.12 : 0)
        + Math.max(0, unresolved.fire ?? 0) * 0.05
        + (1 - clamp01(priorAccess.fire ?? 1)) * 0.08;
      const police = populationShare * 0.012
        + (building.zone === 'commercial' ? 0.16 : building.zone === 'industrial' ? 0.04 : 0)
        + unemploymentPressure * 0.08
        + Math.max(0, unresolved.police ?? 0) * 0.05
        + (1 - clamp01(priorAccess.police ?? 1)) * 0.05;
      const healthcare = populationShare * 0.01
        + (1 - clamp01(utility.water)) * 0.16
        + waste * 0.015
        + Math.max(0, unresolved.healthcare ?? 0) * 0.05
        + (1 - clamp01(priorAccess.healthcare ?? 1)) * 0.05;
      perBuilding[building.id] = Object.freeze({
        fire: Math.max(0, fire),
        police: Math.max(0, police),
        healthcare: Math.max(0, healthcare),
        educationStudents: studentAllocation.get(building.id) ?? 0,
        garbage: definition.garbageGeneration,
      });
    }

    return Object.freeze({ eligibleStudents, perBuilding: Object.freeze(perBuilding) });
  }

  private allocateStudents(residential: readonly Building[], total: number): Map<string, number> {
    const result = new Map<string, number>();
    if (residential.length === 0 || total <= 0) return result;
    const capacity = residential.reduce((sum, building) => sum + BUILDING_DEFINITIONS[building.zone].residentCapacity, 0);
    let assigned = 0;
    const remainders: Array<{ id: string; remainder: number }> = [];
    for (const building of residential) {
      const raw = total * BUILDING_DEFINITIONS[building.zone].residentCapacity / Math.max(1, capacity);
      const base = Math.floor(raw);
      result.set(building.id, base);
      assigned += base;
      remainders.push({ id: building.id, remainder: raw - base });
    }
    remainders.sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
    for (let i = 0; assigned < total; i++, assigned++) {
      const target = remainders[i % remainders.length];
      if (target) result.set(target.id, (result.get(target.id) ?? 0) + 1);
    }
    return result;
  }
}
