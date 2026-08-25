import type { WatershedId } from '../terrain/TerrainTypes.ts';

export const HYDROLOGY_EPSILON = 1e-9;
export const D8_CLOCKWISE: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([0, -1] as const), Object.freeze([1, -1] as const), Object.freeze([1, 0] as const), Object.freeze([1, 1] as const),
  Object.freeze([0, 1] as const), Object.freeze([-1, 1] as const), Object.freeze([-1, 0] as const), Object.freeze([-1, -1] as const),
]);

export type WatershedRecord = Readonly<{
  id: WatershedId;
  outletIndex: number;
  memberCount: number;
  upstreamAreaCells: number;
  primaryChannelId: string | null;
}>;

export type ChannelSegment = Readonly<{
  id: string;
  fromIndex: number;
  toIndex: number;
  accumulation: number;
  capacityVolumeM3: number;
}>;

export type HydrologySample = Readonly<{
  conditionedElevationMeters: number;
  watershedId: WatershedId;
  flowAccumulation: number;
  floodSusceptibility: number;
}>;

export type HydrologySnapshot = Readonly<{
  width: number;
  height: number;
  conditionedElevationMeters: readonly number[];
  receiver: readonly (number | null)[];
  watersheds: readonly WatershedRecord[];
  channels: readonly ChannelSegment[];
  flowAccumulation: readonly number[];
  watershedIds: readonly WatershedId[];
  floodSusceptibility: readonly number[];
}>;
