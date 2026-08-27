import type { AssetManifestEntry } from '../assets/AssetTypes.ts';
import { compareDepthKeys, type DepthKey } from './RenderOrder.ts';

export type SceneSpriteCommand = Readonly<{
  depth: DepthKey;
  entry?: AssetManifestEntry;
  assetId: string;
  x: number;
  y: number;
  label: string;
  footprintWidth?: number;
  footprintHeight?: number;
}>;

export function sortSceneSpriteCommands(commands: readonly SceneSpriteCommand[]): readonly SceneSpriteCommand[] {
  return Object.freeze([...commands].sort((left, right) => compareDepthKeys(left.depth, right.depth)));
}
