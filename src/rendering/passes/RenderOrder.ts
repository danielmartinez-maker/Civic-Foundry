export type SceneLayer = 'terrain' | 'roads' | 'low-props' | 'objects' | 'vehicles' | 'construction';

const LAYER_RANK: Readonly<Record<SceneLayer, number>> = Object.freeze({
  terrain: 0,
  roads: 1,
  'low-props': 2,
  objects: 3,
  vehicles: 4,
  construction: 5,
});

export type DepthKey = Readonly<{
  layerRank: number;
  isoDepth: number;
  elevation: number;
  stableId: string;
}>;

export function makeDepthKey(
  layer: SceneLayer,
  rotatedX: number,
  rotatedY: number,
  elevation: number,
  stableId: string,
): DepthKey {
  return {
    layerRank: LAYER_RANK[layer],
    isoDepth: rotatedX + rotatedY,
    elevation,
    stableId,
  };
}

export function compareDepthKeys(a: DepthKey, b: DepthKey): number {
  return a.layerRank - b.layerRank
    || a.isoDepth - b.isoDepth
    || a.elevation - b.elevation
    || a.stableId.localeCompare(b.stableId);
}
