import type { SimulationCore } from '../simulation/core/SimulationCore.ts';

export type LandHousingOverlayMode = 'none' | 'affordability' | 'occupancy' | 'redevelopment-pressure';

export type LandHousingOverlayCell = Readonly<{
  buildingId: string;
  lotId: string;
  x: number;
  y: number;
  value: number;
  rawValue: number;
  label: string;
  detail: string;
}>;

export type LandHousingOverlaySnapshot = Readonly<{
  mode: LandHousingOverlayMode;
  cells: readonly LandHousingOverlayCell[];
  legend: string;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const humanize = (value: string): string => value.replaceAll('-', ' ');

export function mapLandHousingOverlay(core: SimulationCore, mode: LandHousingOverlayMode): LandHousingOverlaySnapshot {
  const cells: LandHousingOverlayCell[] = [];

  if (mode === 'affordability' || mode === 'occupancy') {
    for (const building of core.buildings.occupied().filter((item) => item.zone === 'residential')) {
      const allocation = core.housingChoiceSnapshot.byBuilding[building.id];
      if (!allocation) continue;
      const rawValue = mode === 'affordability' ? allocation.affordabilityScore : allocation.occupancyRate;
      const value = clamp01(rawValue);
      cells.push(Object.freeze({
        buildingId: building.id,
        lotId: building.lotId,
        x: building.x,
        y: building.y,
        value,
        rawValue,
        label: `${Math.round(value * 100)}%`,
        detail: mode === 'affordability'
          ? `${Math.round(value * 100)}% affordability · ${Math.round(allocation.averageRentBurden * 100)}% average rent burden`
          : `${Math.round(value * 100)}% occupied · ${allocation.assignedResidents.toFixed(1)} assigned residents`,
      }));
    }
  } else if (mode === 'redevelopment-pressure') {
    const decisions = new Map(core.redevelopmentExecutionSnapshot.decisions.map((decision) => [decision.buildingId, decision] as const));
    for (const parcel of core.redevelopmentPressureSnapshot.parcels) {
      const building = core.buildings.getById(parcel.buildingId);
      if (!building || building.zone !== 'residential') continue;
      const decision = decisions.get(parcel.buildingId);
      const value = clamp01(parcel.pressure / 1.25);
      const reason = decision?.reason ?? 'not evaluated';
      cells.push(Object.freeze({
        buildingId: building.id,
        lotId: building.lotId,
        x: building.x,
        y: building.y,
        value,
        rawValue: parcel.pressure,
        label: parcel.pressure.toFixed(2),
        detail: `Pressure ${parcel.pressure.toFixed(2)} · ${humanize(reason)}`,
      }));
    }
  }

  cells.sort((a, b) => a.buildingId.localeCompare(b.buildingId));
  const legends: Record<LandHousingOverlayMode, string> = {
    none: 'Land & housing overlay off.',
    affordability: 'Housing affordability: 0% economically inaccessible → 100% affordable across income bands.',
    occupancy: 'Residential occupancy: 0% empty → 100% of physical resident capacity assigned.',
    'redevelopment-pressure': 'Redevelopment pressure: 0.00 none → 1.25 maximum modeled pressure; labels show raw pressure.',
  };

  return Object.freeze({
    mode,
    cells: Object.freeze(cells.slice()),
    legend: legends[mode],
  });
}
