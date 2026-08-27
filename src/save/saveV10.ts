import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { IntersectionControlSnapshot } from '../simulation/transportation/IntersectionControlTypes.ts';
import { buildLaneGroups } from '../simulation/transportation/LaneGroupBuilder.ts';
import { LegacyRoadNetworkAdapter } from '../simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { hydrateCoreV9, serializeCoreV9, type SaveV9 } from './saveV9.ts';

export type SaveV10 = Omit<SaveV9, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 10;
  gameVersion: '0.10.0-intersection-control';
  intersectionControl: IntersectionControlSnapshot;
}>;

export function serializeCoreV10(core: SimulationCore, baseV9: SaveV9 = serializeCoreV9(core)): SaveV10 {
  return {
    ...baseV9,
    saveVersion: 10,
    gameVersion: '0.10.0-intersection-control',
    intersectionControl: core.intersectionControl.snapshot(),
  };
}

export function hydrateCoreV10(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 10) return hydrateCoreV9(input);
  if (input.gameVersion !== '0.10.0-intersection-control') throw new Error('invalid V10 game version');
  if (!isRecord(input.intersectionControl) || !Array.isArray(input.intersectionControl.junctions)) {
    throw new Error('intersectionControl snapshot must contain a junctions array');
  }

  const save = input as unknown as SaveV10;
  const { intersectionControl: _intersectionControl, ...withoutIntersectionControl } = save;
  const v9: SaveV9 = {
    ...withoutIntersectionControl,
    saveVersion: 9,
    gameVersion: '0.9.0-urban-fabric',
  };
  const core = hydrateCoreV9(v9);
  const projection = new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(core.roads);
  const laneGroups = buildLaneGroups(projection.authority);
  core.intersectionControl.restore(save.intersectionControl, projection.authority, laneGroups);
  return core;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
