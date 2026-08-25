import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { AssetRegistry } from '../assets/AssetRegistry.ts';
import { roadConnectivityMask, rotateRoadMask } from '../assets/RoadAutotile.ts';
import { SpritePainter } from '../assets/SpritePainter.ts';
import { selectCoordinateVariantEntry } from '../assets/VariantSelector.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { isProjectedDiamondVisible, type Viewport } from '../isometric/IsometricCulling.ts';
import { fillCell, strokeCell } from '../isometric/IsometricOverlayPainter.ts';

const ZONE_COLORS = { residential: 'rgba(83,181,102,.28)', commercial: 'rgba(73,135,215,.28)', industrial: 'rgba(204,153,70,.30)' } as const;

export class GroundRenderPass {
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) { this.assets = assets; }

  draw(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, viewport: Viewport): void {
    const worldSize = { width: core.terrain.width, height: core.terrain.height };
    const sourceScale = 0.5 * camera.zoom;
    for (let y = 0; y < core.terrain.height; y += 1) {
      for (let x = 0; x < core.terrain.width; x += 1) {
        const center = camera.tileCenter(x, y, worldSize);
        if (!isProjectedDiamondVisible(center, camera.tileWidth, camera.tileHeight, viewport)) continue;
        const terrain = core.terrain.get(x, y);
        const candidates = this.assets.query({ category: 'terrain', subcategory: terrain.biome });
        const entry = selectCoordinateVariantEntry(`terrain:${terrain.biome}`, x, y, candidates);
        const resolution = entry ? this.assets.resolveAssetId(entry.assetId) : this.assets.resolveAssetId(`terrain_${terrain.biome}_missing`);
        this.painter.draw(ctx, resolution, center, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: terrain.biome });
        if (!terrain.buildable && !terrain.water) fillCell(ctx, camera, x, y, worldSize, 'rgba(255,255,255,.08)');
      }
    }

    for (const zone of core.zoning.list()) fillCell(ctx, camera, zone.x, zone.y, worldSize, ZONE_COLORS[zone.zone]);

    const roads = core.roads.list();
    const roadByCell = new Map(roads.map((road) => [`${road.x},${road.y}`, road] as const));
    const lookup = (x: number, y: number) => roadByCell.get(`${x},${y}`)?.type;
    for (const road of roads) {
      const center = camera.tileCenter(road.x, road.y, worldSize);
      if (!isProjectedDiamondVisible(center, camera.tileWidth, camera.tileHeight, viewport)) continue;
      const mask = rotateRoadMask(roadConnectivityMask(road.x, road.y, lookup), camera.quarterTurns);
      const assetId = `road_${road.type}_mask_${mask.toString().padStart(2, '0')}`;
      this.painter.draw(ctx, this.assets.resolveAssetId(assetId), center, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: road.type.charAt(0) });
    }

    if (camera.zoom >= 1.6) {
      for (const road of roads) strokeCell(ctx, camera, road.x, road.y, worldSize, 'rgba(255,255,255,.035)', 1);
    }
  }
}
