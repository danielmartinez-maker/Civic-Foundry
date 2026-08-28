import { definitionForBuilding } from '../../simulation/buildings/BuildingSystem.ts';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { constructionStageFor } from '../assets/ConstructionVisuals.ts';
import { PASS_A_ASSET_MANIFEST } from '../assets/PassAAssetManifest.ts';
import { roadConnectivityMask, rotateRoadMask } from '../assets/RoadAutotile.ts';
import {
  selectBuildingVariantEntry,
  selectCoordinateVariantEntry,
  selectStableVariantEntry,
} from '../assets/VariantSelector.ts';
import type { QuarterTurn } from '../isometric/IsometricProjection.ts';
import { rotateWorldPoint } from '../isometric/IsometricProjection.ts';
import {
  compareDepthKeys,
  makeDepthKey,
  type DepthKey,
} from '../passes/RenderOrder.ts';
import { GpuAssetCatalog } from './GpuAssetCatalog.ts';

export type BaseSpriteCategory =
  | 'terrain'
  | 'road'
  | 'building'
  | 'construction'
  | 'civic'
  | 'utility'
  | 'vegetation';

export type BaseSpriteCommand = Readonly<{
  key: string;
  fingerprint: string;
  assetId: string;
  x: number;
  y: number;
  depth: DepthKey;
  category: BaseSpriteCategory;
}>;

const catalog = new GpuAssetCatalog(PASS_A_ASSET_MANIFEST);

function command(
  key: string,
  fingerprint: string,
  assetId: string,
  x: number,
  y: number,
  depth: DepthKey,
  category: BaseSpriteCategory,
): BaseSpriteCommand {
  return Object.freeze({ key, fingerprint, assetId, x, y, depth, category });
}

export function buildBaseSpriteCommands(
  core: SimulationCore,
  quarterTurns: QuarterTurn,
): readonly BaseSpriteCommand[] {
  const commands: BaseSpriteCommand[] = [];
  const worldSize = { width: core.terrain.width, height: core.terrain.height };

  for (let y = 0; y < core.terrain.height; y += 1) {
    for (let x = 0; x < core.terrain.width; x += 1) {
      const terrain = core.terrain.get(x, y);
      const entry = selectCoordinateVariantEntry(
        `terrain:${terrain.biome}`,
        x,
        y,
        catalog.query({ category: 'terrain', subcategory: terrain.biome }),
      );
      const assetId = entry?.assetId ?? `terrain_${terrain.biome}_missing`;
      const rotated = rotateWorldPoint(x, y, worldSize, quarterTurns);
      commands.push(command(
        `terrain:${x},${y}`,
        `${assetId}|${terrain.biome}|${terrain.buildable ? 1 : 0}|${terrain.water ? 1 : 0}`,
        assetId,
        x,
        y,
        makeDepthKey('terrain', rotated.x, rotated.y, 0, `terrain:${x},${y}`),
        'terrain',
      ));
    }
  }

  const roads = core.roads.list();
  const roadByCell = new Map(roads.map((road) => [`${road.x},${road.y}`, road] as const));
  const roadLookup = (x: number, y: number) => roadByCell.get(`${x},${y}`)?.type;
  for (const road of roads) {
    const mask = rotateRoadMask(
      roadConnectivityMask(road.x, road.y, roadLookup),
      quarterTurns,
    );
    const assetId = `road_${road.type}_mask_${mask.toString().padStart(2, '0')}`;
    const rotated = rotateWorldPoint(road.x, road.y, worldSize, quarterTurns);
    commands.push(command(
      `road:${road.x},${road.y}`,
      `${assetId}|${road.type}|${quarterTurns}`,
      assetId,
      road.x,
      road.y,
      makeDepthKey('roads', rotated.x, rotated.y, 0, `road:${road.x},${road.y}`),
      'road',
    ));
  }

  const buildings = core.buildings.list();
  const buildingEntries = catalog.query({ category: 'building' });
  for (const building of buildings) {
    const rotated = rotateWorldPoint(building.x, building.y, worldSize, quarterTurns);
    if (building.status === 'construction') {
      const stage = constructionStageFor(building, core.clock.tick);
      const intensity = definitionForBuilding(building).intensity;
      const entry = selectStableVariantEntry(
        `${building.id}|construction|${stage}`,
        catalog.query({ category: 'construction', intensity, constructionStage: stage }),
        quarterTurns,
      );
      const assetId = entry?.assetId ?? `construction_${intensity}_${stage}`;
      commands.push(command(
        `building:${building.id}`,
        `${assetId}|${building.definitionId}|construction|${stage}|${quarterTurns}`,
        assetId,
        building.x,
        building.y,
        makeDepthKey('construction', rotated.x, rotated.y, 0, building.id),
        'construction',
      ));
      continue;
    }

    const entry = selectBuildingVariantEntry(building, quarterTurns, buildingEntries);
    const assetId = entry?.assetId ?? `building:${building.definitionId}`;
    commands.push(command(
      `building:${building.id}`,
      `${assetId}|${building.definitionId}|${building.status}|${quarterTurns}`,
      assetId,
      building.x,
      building.y,
      makeDepthKey('objects', rotated.x, rotated.y, 0, building.id),
      'building',
    ));
  }

  const services = core.services.listFacilities();
  for (const facility of services) {
    const entry = selectStableVariantEntry(
      facility.id,
      catalog.query({ category: 'civic', subcategory: facility.type }),
      quarterTurns,
    );
    const assetId = entry?.assetId ?? `civic_${facility.type}_01`;
    const rotated = rotateWorldPoint(facility.x, facility.y, worldSize, quarterTurns);
    commands.push(command(
      `civic:${facility.id}`,
      `${assetId}|${facility.type}|${quarterTurns}`,
      assetId,
      facility.x,
      facility.y,
      makeDepthKey('objects', rotated.x, rotated.y, 0, facility.id),
      'civic',
    ));
  }

  const utilities = core.utilities.listFacilities();
  for (const facility of utilities) {
    const entry = selectStableVariantEntry(
      facility.id,
      catalog.query({ category: 'utility', subcategory: facility.type }),
      quarterTurns,
    );
    const assetId = entry?.assetId ?? `utility_${facility.type}_01`;
    const rotated = rotateWorldPoint(facility.x, facility.y, worldSize, quarterTurns);
    commands.push(command(
      `utility:${facility.id}`,
      `${assetId}|${facility.type}|${quarterTurns}`,
      assetId,
      facility.x,
      facility.y,
      makeDepthKey('objects', rotated.x, rotated.y, 0, facility.id),
      'utility',
    ));
  }

  const occupied = new Set([
    ...buildings.map((item) => `${item.x},${item.y}`),
    ...services.map((item) => `${item.x},${item.y}`),
    ...utilities.map((item) => `${item.x},${item.y}`),
    ...roads.map((item) => `${item.x},${item.y}`),
  ]);
  const treeEntries = catalog.query({ category: 'vegetation', subcategory: 'large' });
  for (let y = 0; y < core.terrain.height; y += 1) {
    for (let x = 0; x < core.terrain.width; x += 1) {
      if (core.terrain.get(x, y).biome !== 'forest' || occupied.has(`${x},${y}`)) continue;
      const entry = selectCoordinateVariantEntry('forest-tree', x, y, treeEntries);
      const assetId = entry?.assetId ?? 'tree_large_missing';
      const rotated = rotateWorldPoint(x, y, worldSize, quarterTurns);
      commands.push(command(
        `vegetation:${x},${y}`,
        `${assetId}|${quarterTurns}`,
        assetId,
        x,
        y,
        makeDepthKey('objects', rotated.x, rotated.y, 0, `tree:${x},${y}`),
        'vegetation',
      ));
    }
  }

  commands.sort((a, b) => compareDepthKeys(a.depth, b.depth));
  return Object.freeze(commands);
}
