import type { RoadType } from '../../data/roads.ts';

export const ROAD_CLASSES = ['local', 'collector', 'arterial', 'avenue', 'expressway', 'highway'] as const;
export type RoadClass = typeof ROAD_CLASSES[number];

export const LEGACY_LANE_COUNT: Readonly<Record<RoadType, number>> = Object.freeze({
  local: 1,
  collector: 2,
  arterial: 3,
});

export type JunctionId = string;
export type RoadSegmentId = string;
export type CarriagewayId = string;
export type LaneId = string;
export type TurnMovementId = string;
export type LaneGroupId = string;

export type VehiclePermission =
  | 'privateCar'
  | 'taxiRideHail'
  | 'lightCommercial'
  | 'heavyFreight'
  | 'bus'
  | 'emergency'
  | 'bicycle';

export type VehiclePermissionMask = number;

export const VEHICLE_PERMISSION: Readonly<Record<VehiclePermission, number>> = Object.freeze({
  privateCar: 1 << 0,
  taxiRideHail: 1 << 1,
  lightCommercial: 1 << 2,
  heavyFreight: 1 << 3,
  bus: 1 << 4,
  emergency: 1 << 5,
  bicycle: 1 << 6,
});

export const ALL_VEHICLE_PERMISSIONS = Object.values(VEHICLE_PERMISSION)
  .reduce((value, bit) => value | bit, 0);

export function permissionMask(...permissions: readonly VehiclePermission[]): VehiclePermissionMask {
  return permissions.reduce((value, permission) => value | VEHICLE_PERMISSION[permission], 0);
}

export function hasPermission(mask: VehiclePermissionMask, permission: VehiclePermission): boolean {
  return (mask & VEHICLE_PERMISSION[permission]) !== 0;
}

export function intersectPermissions(...masks: readonly VehiclePermissionMask[]): VehiclePermissionMask {
  return masks.length === 0 ? 0 : masks.reduce((value, mask) => value & mask);
}

export type LaneKind =
  | 'through'
  | 'turn'
  | 'bus'
  | 'bike'
  | 'parking'
  | 'reversible'
  | 'shoulder';

export type LaneOperatingState = 'open' | 'closed';
export type TravelDirection = 'forward' | 'backward';
export type TurnKind = 'left' | 'through' | 'right' | 'u-turn';

export type Junction = Readonly<{
  id: JunctionId;
  x: number;
  y: number;
  sourceLegacyCell?: string;
}>;

export type RoadSegment = Readonly<{
  id: RoadSegmentId;
  roadClass: RoadClass;
  geometryRef: string;
  startJunctionId: JunctionId;
  endJunctionId: JunctionId;
  lengthMeters: number;
  speedLimitKph: number;
  condition: number;
  accessPolicyId: string;
  tollPolicyId?: string;
  carriagewayIds: readonly CarriagewayId[];
  sourceLegacyCells?: readonly string[];
}>;

export type Carriageway = Readonly<{
  id: CarriagewayId;
  segmentId: RoadSegmentId;
  direction: TravelDirection;
  fromJunctionId: JunctionId;
  toJunctionId: JunctionId;
  operatingClass: RoadClass;
  laneIds: readonly LaneId[];
}>;

export type Lane = Readonly<{
  id: LaneId;
  carriagewayId: CarriagewayId;
  ordinal: number;
  kind: LaneKind;
  permissions: VehiclePermissionMask;
  operatingState: LaneOperatingState;
  baseCapacityPerMinute: number;
  freeFlowSpeedKph: number;
}>;

export type TurnMovement = Readonly<{
  id: TurnMovementId;
  junctionId: JunctionId;
  fromCarriagewayId: CarriagewayId;
  toCarriagewayId: CarriagewayId;
  fromLaneIds: readonly LaneId[];
  toLaneIds: readonly LaneId[];
  turnKind: TurnKind;
  permissions: VehiclePermissionMask;
  allowed: boolean;
  basePenaltyTicks: number;
}>;

export type LaneGroup = Readonly<{
  id: LaneGroupId;
  carriagewayId: CarriagewayId;
  laneIds: readonly LaneId[];
  movementIds: readonly TurnMovementId[];
  permissions: VehiclePermissionMask;
  capacityPerMinute: number;
  freeFlowSpeedKph: number;
}>;

export type TransportPhysicalNetwork = Readonly<{
  junctions: readonly Junction[];
  segments: readonly RoadSegment[];
  carriageways: readonly Carriageway[];
  lanes: readonly Lane[];
}>;

export type TransportNetworkAuthority = Readonly<TransportPhysicalNetwork & {
  movements: readonly TurnMovement[];
}>;

export type TransportNetworkSnapshot = Readonly<TransportNetworkAuthority & {
  topologyRevision: number;
  costEpoch: number;
}>;

export type TransportMutationResult = Readonly<{
  ok: boolean;
  changed: boolean;
  reason?: string;
}>;

export function roadClassRank(value: RoadClass): number {
  const rank = ROAD_CLASSES.indexOf(value);
  if (rank < 0) {
    throw new Error(`Unknown road class: ${String(value)}`);
  }
  return rank;
}
