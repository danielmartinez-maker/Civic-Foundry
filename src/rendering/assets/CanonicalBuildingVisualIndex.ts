import type { BuildingV2 } from '../../simulation/buildings/BuildingTypes.ts';
import {
  LEGACY_CELL_SIZE_METERS,
  polygonArea,
  polygonIntersection,
  type PolygonRing,
} from '../../world/cadastre/Geometry.ts';

const SPATIAL_OVERLAP_EPSILON_M2 = 1e-6;

export function legacyCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function indexCanonicalBuildingsByLegacyCell(
  buildings: readonly BuildingV2[],
): ReadonlyMap<string, BuildingV2> {
  const index = new Map<string, BuildingV2>();

  for (const building of [...buildings].sort((left, right) => left.id.localeCompare(right.id))) {
    const bounds = footprintBounds(building.footprint);
    const minCellX = Math.floor(bounds.minX / LEGACY_CELL_SIZE_METERS);
    const minCellY = Math.floor(bounds.minY / LEGACY_CELL_SIZE_METERS);
    const maxCellX = Math.ceil(bounds.maxX / LEGACY_CELL_SIZE_METERS) - 1;
    const maxCellY = Math.ceil(bounds.maxY / LEGACY_CELL_SIZE_METERS) - 1;

    for (let y = minCellY; y <= maxCellY; y += 1) {
      for (let x = minCellX; x <= maxCellX; x += 1) {
        const key = legacyCellKey(x, y);
        if (index.has(key)) continue;
        const overlap = polygonIntersection(building.footprint, legacyCellPolygon(x, y));
        if (overlap.some((ring) => polygonArea(ring) > SPATIAL_OVERLAP_EPSILON_M2)) {
          index.set(key, building);
        }
      }
    }
  }

  return index;
}

function footprintBounds(footprint: PolygonRing): Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}> {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of footprint) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return Object.freeze({ minX, minY, maxX, maxY });
}

function legacyCellPolygon(x: number, y: number): PolygonRing {
  const minX = x * LEGACY_CELL_SIZE_METERS;
  const minY = y * LEGACY_CELL_SIZE_METERS;
  const maxX = minX + LEGACY_CELL_SIZE_METERS;
  const maxY = minY + LEGACY_CELL_SIZE_METERS;
  return Object.freeze([
    Object.freeze({ x: minX, y: minY }),
    Object.freeze({ x: maxX, y: minY }),
    Object.freeze({ x: maxX, y: maxY }),
    Object.freeze({ x: minX, y: maxY }),
  ]);
}
