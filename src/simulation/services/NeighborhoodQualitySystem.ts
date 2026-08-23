import type { Building } from '../buildings/BuildingSystem.ts';
import { clamp } from '../core/types.ts';
import type { ServiceDepartment } from '../../data/services.ts';

export type BuildingServiceAccess = Readonly<Partial<Record<ServiceDepartment, number>>>;
export type BuildingNeighborhoodQuality = Readonly<{
  buildingId: string;
  fireSafety: number;
  policeSafety: number;
  healthcareAccess: number;
  educationAccess: number;
  garbageCleanliness: number;
  combinedServiceQuality: number;
  primaryIssue: ServiceDepartment | 'none';
}>;

export type NeighborhoodQualitySnapshot = Readonly<{
  perBuilding: Readonly<Record<string, BuildingNeighborhoodQuality>>;
  citywideServiceQuality: number;
  commercialServiceQuality: number;
}>;

export type NeighborhoodQualityInputs = Readonly<{
  accessByBuilding: Readonly<Record<string, BuildingServiceAccess>>;
  incidentOutcome: Readonly<{ fire: number; police: number; healthcare: number }>;
  wasteByBuilding: Readonly<Record<string, number>>;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export class NeighborhoodQualitySystem {
  evaluate(buildings: readonly Building[], input: NeighborhoodQualityInputs): NeighborhoodQualitySnapshot {
    const perBuilding: Record<string, BuildingNeighborhoodQuality> = {};
    let residentialTotal = 0;
    let residentialCount = 0;
    let commercialTotal = 0;
    let commercialCount = 0;
    for (const building of buildings.filter((item) => item.status === 'occupied').sort((a, b) => a.id.localeCompare(b.id))) {
      const access = input.accessByBuilding[building.id] ?? {};
      const fireSafety = clamp01((access.fire ?? 0) * 0.75 + clamp01(input.incidentOutcome.fire) * 0.25);
      const policeSafety = clamp01((access.police ?? 0) * 0.75 + clamp01(input.incidentOutcome.police) * 0.25);
      const healthcareAccess = clamp01((access.healthcare ?? 0) * 0.75 + clamp01(input.incidentOutcome.healthcare) * 0.25);
      const educationAccess = clamp01(access.education ?? 0);
      const waste = Math.max(0, input.wasteByBuilding[building.id] ?? 0);
      const garbageCleanliness = clamp01((access.garbage ?? 0) * 0.65 + clamp01(1 - waste / 24) * 0.35);
      const combinedServiceQuality = 0.22 * fireSafety + 0.22 * policeSafety + 0.22 * healthcareAccess + 0.20 * educationAccess + 0.14 * garbageCleanliness;
      const components: Array<[ServiceDepartment, number]> = [
        ['fire', fireSafety], ['police', policeSafety], ['healthcare', healthcareAccess], ['education', educationAccess], ['garbage', garbageCleanliness],
      ];
      components.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
      const weakest = components[0]!;
      perBuilding[building.id] = Object.freeze({
        buildingId: building.id, fireSafety, policeSafety, healthcareAccess, educationAccess, garbageCleanliness,
        combinedServiceQuality, primaryIssue: weakest[1] >= 0.85 ? 'none' : weakest[0],
      });
      if (building.zone === 'residential') { residentialTotal += combinedServiceQuality; residentialCount++; }
      if (building.zone === 'commercial') { commercialTotal += (policeSafety + garbageCleanliness) / 2; commercialCount++; }
    }
    const occupiedCount = Object.keys(perBuilding).length;
    const allAverage = occupiedCount === 0 ? 1 : Object.values(perBuilding).reduce((sum, item) => sum + item.combinedServiceQuality, 0) / occupiedCount;
    return Object.freeze({
      perBuilding: Object.freeze(perBuilding),
      citywideServiceQuality: residentialCount > 0 ? residentialTotal / residentialCount : allAverage,
      commercialServiceQuality: commercialCount > 0 ? commercialTotal / commercialCount : allAverage,
    });
  }

  residentialDemandModifier(quality: number): number {
    return clamp((clamp01(quality) - 0.70) * 0.50, -0.25, 0.15);
  }

  commercialDemandModifier(policeSafety: number, garbageCleanliness: number): number {
    const quality = (clamp01(policeSafety) + clamp01(garbageCleanliness)) / 2;
    return clamp((quality - 0.70) * 0.35, -0.20, 0.10);
  }
}
