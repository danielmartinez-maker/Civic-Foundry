import { Container, Sprite, Texture } from 'pixi.js';
import type { IsometricCamera } from '../isometric/IsometricCamera.ts';
import type { WorldSize } from '../isometric/IsometricProjection.ts';
import type { GpuAssetRegistry } from './GpuAssetRegistry.ts';
import type { VehicleSpriteCommand } from './VehicleSpriteCommands.ts';

export const MAX_VEHICLE_POOL_PER_ASSET = 16;

type ActiveVehicleSprite = {
  sprite: Sprite;
  fingerprint: string;
};

export type VehicleLayerStats = Readonly<{
  active: number;
  created: number;
  reused: number;
  pooled: number;
  destroyed: number;
}>;

export class RetainedVehicleLayer {
  private readonly active = new Map<string, ActiveVehicleSprite>();
  private readonly pools = new Map<string, Sprite[]>();
  private createdTotal = 0;
  private reusedTotal = 0;
  private destroyedTotal = 0;

  constructor(
    readonly container: Container,
    private readonly assets: GpuAssetRegistry,
  ) {}

  sync(
    commands: readonly VehicleSpriteCommand[],
    camera: IsometricCamera,
    worldSize: WorldSize,
  ): void {
    const commandByKey = new Map(commands.map((command) => [command.key, command] as const));

    for (const [key, current] of [...this.active]) {
      if (commandByKey.has(key)) continue;
      this.active.delete(key);
      this.release(current.sprite);
    }

    for (const command of commands) {
      let current = this.active.get(command.key);
      if (!current) {
        const sprite = this.acquire(command.assetId);
        current = { sprite, fingerprint: '' };
        this.active.set(command.key, current);
      }
      if (current.fingerprint !== command.fingerprint) {
        this.applyTexture(current.sprite, command.assetId);
        current.fingerprint = command.fingerprint;
      }
      const point = camera.worldToCanvas(command.x, command.y, worldSize);
      current.sprite.position.set(point.x, point.y);
      current.sprite.scale.set(0.5 * camera.zoom);
      current.sprite.tint = command.queued ? '#ffd166' : '#ffffff';
      current.sprite.visible = true;
    }

    const ordered = commands
      .map((command) => ({ command, current: this.active.get(command.key) }))
      .filter((item): item is { command: VehicleSpriteCommand; current: ActiveVehicleSprite } => item.current !== undefined)
      .sort((a, b) => {
        const ap = camera.worldToCanvas(a.command.x, a.command.y, worldSize);
        const bp = camera.worldToCanvas(b.command.x, b.command.y, worldSize);
        return ap.y - bp.y || ap.x - bp.x || a.command.key.localeCompare(b.command.key);
      });
    this.container.removeChildren();
    for (const item of ordered) this.container.addChild(item.current.sprite);
  }

  stats(): VehicleLayerStats {
    return Object.freeze({
      active: this.active.size,
      created: this.createdTotal,
      reused: this.reusedTotal,
      pooled: [...this.pools.values()].reduce((sum, pool) => sum + pool.length, 0),
      destroyed: this.destroyedTotal,
    });
  }

  private acquire(assetId: string): Sprite {
    const pool = this.pools.get(assetId);
    const sprite = pool?.pop();
    if (sprite) {
      this.reusedTotal += 1;
      sprite.visible = true;
      return sprite;
    }
    this.createdTotal += 1;
    return new Sprite(Texture.WHITE);
  }

  private release(sprite: Sprite): void {
    const assetId = this.assetIdForTexture(sprite.texture);
    const pool = this.pools.get(assetId) ?? [];
    if (pool.length >= MAX_VEHICLE_POOL_PER_ASSET) {
      sprite.destroy();
      this.destroyedTotal += 1;
      return;
    }
    sprite.visible = false;
    pool.push(sprite);
    this.pools.set(assetId, pool);
  }

  private assetIdForTexture(texture: Texture): string {
    for (const entry of this.assets.query({ category: 'vehicle' })) {
      if (this.assets.texture(entry.assetId)?.texture === texture) return entry.assetId;
    }
    return '__fallback__';
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
