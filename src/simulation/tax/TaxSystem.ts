import type { ZoneType } from '../core/types.ts';
import { clamp } from '../core/types.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import { definitionForBuilding } from '../buildings/BuildingSystem.ts';
import type { UrbanBuildingView } from '../urban/UrbanBuildingView.ts';

export type TaxRates = Record<ZoneType, number>;
export type TaxRevenue = Readonly<{ residential: number; commercial: number; industrial: number; total: number }>;

export class TaxSystem {
  private rates: TaxRates = { residential: 0.1, commercial: 0.1, industrial: 0.1 };

  setRate(zone: ZoneType, rate: number): void {
    this.rates[zone] = clamp(Number.isFinite(rate) ? rate : 0.1, 0, 0.25);
  }

  getRate(zone: ZoneType): number { return this.rates[zone]; }
  getRates(): TaxRates { return { ...this.rates }; }

  calculateRevenue(buildings: readonly Building[]): TaxRevenue {
    const revenue = { residential: 0, commercial: 0, industrial: 0, total: 0 };
    for (const building of buildings) {
      if (building.status !== 'occupied') continue;
      const value = definitionForBuilding(building).taxBase * this.rates[building.zone];
      revenue[building.zone] += value;
      revenue.total += value;
    }
    return revenue;
  }

  calculateUrbanRevenue(views: readonly UrbanBuildingView[]): TaxRevenue {
    const revenue = { residential: 0, commercial: 0, industrial: 0, total: 0 };
    const uses: readonly ZoneType[] = ['residential', 'commercial', 'industrial'];
    for (const view of views) {
      if (!view.occupancyEligible) continue;
      for (const use of uses) {
        const value = view.taxBaseByUse[use] * this.rates[use];
        revenue[use] += value;
        revenue.total += value;
      }
    }
    return revenue;
  }

  restoreRates(rates: TaxRates): void {
    this.setRate('residential', rates.residential);
    this.setRate('commercial', rates.commercial);
    this.setRate('industrial', rates.industrial);
  }
}
