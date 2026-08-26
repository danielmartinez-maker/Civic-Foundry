import { BUILDING_DEFINITIONS } from '../../src/data/buildings.ts';
import type { Building } from '../../src/simulation/buildings/BuildingSystem.ts';
import type { SimulationCore } from '../../src/simulation/core/SimulationCore.ts';
import type { ZoneType } from '../../src/simulation/core/types.ts';

export type OccupiedParcelSite = Readonly<{
  x: number;
  y: number;
  zone: ZoneType;
}>;

export function fixtureBuildingId(x: number, y: number): string {
  return `building:lot:${x},${y}`;
}

export function seedOccupiedParcelSites(
  core: SimulationCore,
  sites: readonly OccupiedParcelSite[],
  population: number,
): void {
  if (!Number.isInteger(population) || population < 0) throw new Error('fixture population must be a non-negative integer');
  const lotIds = new Set(core.lots.list().map((lot) => lot.id));
  const buildings: Building[] = sites.map((site) => {
    const lotId = `lot:${site.x},${site.y}`;
    if (!lotIds.has(lotId)) throw new Error(`fixture site is not a legacy frontage lot: ${lotId}`);
    return {
      id: fixtureBuildingId(site.x, site.y),
      lotId,
      x: site.x,
      y: site.y,
      zone: site.zone,
      definitionId: BUILDING_DEFINITIONS[site.zone].id,
      status: 'occupied',
      constructionStartedTick: 0,
      completionTick: 0,
    };
  });

  core.buildings.restore(buildings);
  core.rebuildCadastreFromLegacyState();

  const canonicalBuildings = core.buildings.listV2();
  if (canonicalBuildings.length !== buildings.length) {
    throw new Error(`fixture expected ${buildings.length} canonical buildings, received ${canonicalBuildings.length}`);
  }
  const claimedParcelIds = new Set(canonicalBuildings.flatMap((building) => building.parcelIds));
  if (claimedParcelIds.size !== sites.length) {
    throw new Error(`fixture expected ${sites.length} independently claimed parcels, received ${claimedParcelIds.size}`);
  }

  core.population.restore(population);
  core.restoreHousingState();
}
