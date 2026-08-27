import { AssetRegistry } from '../assets/AssetRegistry.ts';
import { SpritePainter } from '../assets/SpritePainter.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { isProjectedSpriteVisible, type Viewport } from '../isometric/IsometricCulling.ts';
import type { WorldSize } from '../isometric/IsometricProjection.ts';
import { sortSceneSpriteCommands, type SceneSpriteCommand } from './SceneSpriteCommand.ts';

export class SceneSpriteCommandBuffer {
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) { this.assets = assets; }

  draw(
    ctx: CanvasRenderingContext2D,
    commands: readonly SceneSpriteCommand[],
    camera: IsometricCamera,
    viewport: Viewport,
    worldSize: WorldSize,
  ): void {
    const sourceScale = 0.5 * camera.zoom;
    for (const command of sortSceneSpriteCommands(commands)) {
      const center = camera.tileCenter(command.x, command.y, worldSize);
      if (command.entry && !isProjectedSpriteVisible(center, command.entry, sourceScale, viewport)) continue;
      this.painter.draw(
        ctx,
        this.assets.resolveAssetId(command.assetId),
        center,
        sourceScale,
        {
          footprintWidth: command.footprintWidth ?? command.entry?.footprint.width ?? 1,
          footprintHeight: command.footprintHeight ?? command.entry?.footprint.height ?? 1,
          label: command.label,
        },
      );
    }
  }
}
