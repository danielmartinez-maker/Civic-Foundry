import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { definitionForBuilding } from '../../simulation/buildings/BuildingSystem.ts';
import { AssetRegistry } from '../assets/AssetRegistry.ts';
import { selectBuildingVisualEntry } from '../assets/BuildingVisualResolver.ts';
import { indexCanonicalBuildingsByLegacyCell, legacyCellKey } from '../assets/CanonicalBuildingVisualIndex.ts';
import { constructionStageFor } from '../assets/ConstructionVisuals.ts';
import { SpritePainter } from '../assets/SpritePainter.ts';
import { selectBuildingVariantEntry, selectCoordinateVariantEntry, selectStableVariantEntry } from '../assets/VariantSelector.ts';
import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { isProjectedSpriteVisible, type Viewport } from '../isometric/IsometricCulling.ts';
import { rotateWorldPoint } from '../isometric/IsometricProjection.ts';
import { compareDepthKeys, makeDepthKey, type DepthKey } from './RenderOrder.ts';

type DrawCommand = Readonly<{
  depth: DepthKey;
  entry: AssetManifestEntry | undefined;
  assetId: string;
  x: number;
  y: number;
  label: string;
}>;

export class ObjectRenderPass {
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) { this.assets = assets; }

  draw(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, viewport: Viewport): void {
    const worldSize = { width: core.terrain.width, height: core.terrain.height };
    const sourceScale = 0.5 * camera.zoom;
    const commands: DrawCommand[] = [];
    const buildingEntries = this.assets.query({ category: 'building' });
    const buildings = core.buildings.list();
    const canonicalByCell = indexCanonicalBuildingsByLegacyCell(core.buildings.listV2());
    const services = core.services.listFacilities();
    const utilities = core.utilities.listFacilities();
    const roads = core.roads.list();

    for (const building of buildings) {
      const rotated = rotateWorldPoint(building.x, building.y, worldSize, camera.quarterTurns);
      if (building.status === 'construction') {
        const stage = constructionStageFor(building, core.clock.tick);
        const intensity = definitionForBuilding(building).intensity;
        const candidates = this.assets.query({ category: 'construction', intensity, constructionStage: stage });
        const entry = selectStableVariantEntry(`${building.id}|construction|${stage}`, candidates, camera.quarterTurns);
        commands.push({ depth: makeDepthKey('construction', rotated.x, rotated.y, 0, building.id), entry, assetId: entry?.assetId ?? `construction_${intensity}_${stage}`, x: building.x, y: building.y, label: 'CN' });
      } else {
        const canonical = canonicalByCell.get(legacyCellKey(building.x, building.y));
        const entry = canonical
          ? selectBuildingVisualEntry(canonical, camera.quarterTurns, buildingEntries)
          : selectBuildingVariantEntry(building, camera.quarterTurns, buildingEntries);
        commands.push({ depth: makeDepthKey('objects', rotated.x, rotated.y, 0, building.id), entry, assetId: entry?.assetId ?? `building:${building.definitionId}`, x: building.x, y: building.y, label: building.zone.slice(0, 1) });
      }
    }

    for (const facility of services) {
      const rotated = rotateWorldPoint(facility.x, facility.y, worldSize, camera.quarterTurns);
      const variantKey = `civic_${facility.type}_01`;
      const entry = selectStableVariantEntry(facility.id, this.assets.query({ category: 'civic', subcategory: facility.type }), camera.quarterTurns);
      commands.push({ depth: makeDepthKey('objects', rotated.x, rotated.y, 0, facility.id), entry, assetId: entry?.assetId ?? variantKey, x: facility.x, y: facility.y, label: facility.department.slice(0, 2) });
    }

    for (const facility of utilities) {
      const rotated = rotateWorldPoint(facility.x, facility.y, worldSize, camera.quarterTurns);
      const variantKey = `utility_${facility.type}_01`;
      const entry = selectStableVariantEntry(facility.id, this.assets.query({ category: 'utility', subcategory: facility.type }), camera.quarterTurns);
      commands.push({ depth: makeDepthKey('objects', rotated.x, rotated.y, 0, facility.id), entry, assetId: entry?.assetId ?? variantKey, x: facility.x, y: facility.y, label: facility.type.slice(0, 2) });
    }

    const occupied = new Set([
      ...buildings.map((item) => `${item.x},${item.y}`),
      ...services.map((item) => `${item.x},${item.y}`),
      ...utilities.map((item) => `${item.x},${item.y}`),
      ...roads.map((item) => `${item.x},${item.y}`),
    ]);
    const trees = this.assets.query({ category: 'vegetation', subcategory: 'large' });
    for (let y = 0; y < core.terrain.height; y += 1) {
      for (let x = 0; x < core.terrain.width; x += 1) {
        if (core.terrain.get(x, y).biome !== 'forest' || occupied.has(`${x},${y}`)) continue;
        const entry = selectCoordinateVariantEntry('forest-tree', x, y, trees);
        const rotated = rotateWorldPoint(x, y, worldSize, camera.quarterTurns);
        commands.push({ depth: makeDepthKey('objects', rotated.x, rotated.y, 0, `tree:${x},${y}`), entry, assetId: entry?.assetId ?? 'tree_large_missing', x, y, label: 'T' });
      }
    }

    commands.sort((a, b) => compareDepthKeys(a.depth, b.depth));
    for (const command of commands) {
      const center = camera.tileCenter(command.x, command.y, worldSize);
      if (command.entry && !isProjectedSpriteVisible(center, command.entry, sourceScale, viewport)) continue;
      this.painter.draw(ctx, this.assets.resolveAssetId(command.assetId), center, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: command.label });
    }
  }
}
