import type { UtilityFacilityType } from '../../data/utilities.ts';
import type { CellCoord } from '../core/types.ts';

export type UtilityCorridorType = 'power_distribution' | 'power_transmission' | 'water_main' | 'water_trunk';
export type UtilityTier = 1 | 2 | 3;

export type UtilityCorridorCell = Readonly<{
  id: string;
  type: UtilityCorridorType;
  tier: UtilityTier;
  x: number;
  y: number;
  saturatedCycles: number;
  trippedUntilTick: number;
}>;

export type UtilityFacility = Readonly<{
  id: string;
  type: UtilityFacilityType;
  x: number;
  y: number;
  inputCoord?: CellCoord;
  outputCoord?: CellCoord;
}>;

export type UtilityTopologyState = Readonly<{
  cells: readonly UtilityCorridorCell[];
  revision: number;
  nextCorridorId: number;
}>;

export type UtilityInfrastructureState = Readonly<{
  topology: UtilityTopologyState;
  facilities: readonly UtilityFacility[];
  nextFacilityId: number;
}>;

export type UtilityMutationResult = Readonly<{ ok: boolean; cost: number; reason?: string }>;
