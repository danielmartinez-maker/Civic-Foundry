import { Container, Sprite, Texture } from 'pixi.js';
import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import type { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { isProjectedSpriteVisible, type Viewport } from '../isometric/IsometricCulling.ts';
import type { WorldSize } from '../isometric/IsometricProjection.ts';
import type { BaseSpriteCommand } from './BaseSpriteCommands.ts';
import type { GpuAssetRegistry } from './GpuAssetRegistry.ts';
import { RetainedSceneIndex, type RetainedTotals } from './RetainedSceneIndex.ts';

export class RetainedSpriteLayer {
  private readonly index = new RetainedSceneIndex<Sprite>();
  private totalsValue: RetainedTotals = Object.freeze({ active: 0, created: 0, updated: 0, removed: 0 });

  constructor(
    readonly container: Container,
    private readonly assets: GpuAssetRegistry,
  ) {}

  sync(
    commands: readonly BaseSpriteCommand[],
    camera: IsometricCamera,
    worldSize: WorldSize,
    viewport: Viewport,
  ): void {
    const commandByKey = new Map(commands.map((item) => [item.key, item] as const));
    const result = this.index.sync(commands, {
      create: (descriptor) => {
        const command = commandByKey.get(descriptor.key);
        if (!command) throw new Error(`missing sprite command for retained key ${descriptor.key}`);
        const sprite = new Sprite(Texture.WHITE);
        this.applyTexture(sprite, command.assetId);
        return sprite;
      },
      update: (sprite, descriptor) => {
        const command = commandByKey.get(descriptor.key);
        if (!command) return;
        this.applyTexture(sprite, command.assetId);
      },
      destroy: (sprite) => sprite.destroy(),
    });
    this.totalsValue = result.totals;

    const scale = 0.5 * camera.zoom;
    this.container.removeChildren();
    for (const entry of result.entries) {
      const command = commandByKey.get(entry.key);
      if (!command) continue;
      const sprite = entry.value;
      const center = camera.tileCenter(command.x, command.y, worldSize);
      sprite.position.set(center.x, center.y);
      sprite.scale.set(scale);
      const manifestEntry = this.assets.resolveEntry(command.assetId);
      sprite.visible = manifestEntry
        ? isProjectedSpriteVisible(center, manifestEntry, scale, viewport)
        : true;
      this.container.addChild(sprite);
    }
  }

  stats(): RetainedTotals {
    return this.totalsValue;
  }

  private applyTexture(sprite: Sprite, assetId: string): void {
    const resolution = this.assets.texture(assetId);
    if (!resolution) {
      sprite.texture = Texture.WHITE;
      sprite.anchor.set(0.5, 0.5);
      sprite.alpha = 0.35;
      return;
    }
    const { entry, texture } = resolution;
    sprite.texture = texture;
    sprite.anchor.set(
      entry.anchor.x / entry.sourceRect.width,
      entry.anchor.y / entry.sourceRect.height,
    );
    sprite.alpha = 1;
  }
}
