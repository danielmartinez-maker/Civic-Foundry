import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import type { Point } from './IsometricProjection.ts';

export type Viewport = Readonly<{ width: number; height: number }>;

export function isProjectedDiamondVisible(center: Point, tileWidth: number, tileHeight: number, viewport: Viewport, margin = 32): boolean {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  return center.x + halfW >= -margin && center.x - halfW <= viewport.width + margin
    && center.y + halfH >= -margin && center.y - halfH <= viewport.height + margin;
}

export function isProjectedSpriteVisible(
  anchor: Point,
  entry: AssetManifestEntry,
  displayScale: number,
  viewport: Viewport,
  margin = 32,
): boolean {
  const left = anchor.x - entry.anchor.x * displayScale;
  const top = anchor.y - entry.anchor.y * displayScale;
  const right = left + entry.sourceRect.width * displayScale;
  const bottom = top + entry.sourceRect.height * displayScale;
  return right >= -margin && left <= viewport.width + margin && bottom >= -margin && top <= viewport.height + margin;
}
