import {
  ALL_VEHICLE_PERMISSIONS,
  type Carriageway,
  type Lane,
  type LaneId,
  type LaneOperatingState,
  type RoadSegment,
  type TransportMutationResult,
  type TransportNetworkAuthority,
  type TransportNetworkSnapshot,
  type TurnMovement,
  type TurnMovementId,
  type VehiclePermissionMask,
} from './TransportNetworkTypes.ts';

function requireId(value: string, label: string): void {
  if (value.length === 0) throw new Error(`${label} id must not be empty`);
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}

function requireNonNegative(value: number, label: string): void {
  requireFinite(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
}

function requirePermissionMask(mask: VehiclePermissionMask, label: string): void {
  if (!Number.isInteger(mask) || mask < 0 || (mask & ~ALL_VEHICLE_PERMISSIONS) !== 0) {
    throw new Error(`${label} contains invalid vehicle permissions`);
  }
}

function indexedById<T extends { id: string }>(items: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const item of items) {
    requireId(item.id, label);
    if (result.has(item.id)) throw new Error(`Duplicate ${label} id: ${item.id}`);
    result.set(item.id, item);
  }
  return result;
}

function requireUniqueReferences(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate references`);
}

function compareId<T extends { id: string }>(a: T, b: T): number {
  return a.id.localeCompare(b.id);
}

function copySegment(segment: RoadSegment): RoadSegment {
  return {
    ...segment,
    carriagewayIds: [...segment.carriagewayIds].sort((a, b) => a.localeCompare(b)),
    ...(segment.sourceLegacyCells
      ? { sourceLegacyCells: [...segment.sourceLegacyCells].sort((a, b) => a.localeCompare(b)) }
      : {}),
  };
}

function copyCarriageway(carriageway: Carriageway, laneById: ReadonlyMap<string, Lane>): Carriageway {
  return {
    ...carriageway,
    laneIds: [...carriageway.laneIds].sort((a, b) => {
      const aLane = laneById.get(a);
      const bLane = laneById.get(b);
      if (aLane && bLane && aLane.ordinal !== bLane.ordinal) return aLane.ordinal - bLane.ordinal;
      return a.localeCompare(b);
    }),
  };
}

function copyMovement(movement: TurnMovement, laneById: ReadonlyMap<string, Lane>): TurnMovement {
  const laneOrder = (a: string, b: string): number => {
    const aLane = laneById.get(a);
    const bLane = laneById.get(b);
    if (aLane && bLane && aLane.ordinal !== bLane.ordinal) return aLane.ordinal - bLane.ordinal;
    return a.localeCompare(b);
  };
  return {
    ...movement,
    fromLaneIds: [...movement.fromLaneIds].sort(laneOrder),
    toLaneIds: [...movement.toLaneIds].sort(laneOrder),
  };
}

function canonicalizeAuthority(authority: TransportNetworkAuthority): TransportNetworkAuthority {
  const lanes = authority.lanes.map((lane) => ({ ...lane })).sort(compareId);
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  return {
    junctions: authority.junctions.map((junction) => ({ ...junction })).sort(compareId),
    segments: authority.segments.map(copySegment).sort(compareId),
    carriageways: authority.carriageways.map((item) => copyCarriageway(item, laneById)).sort(compareId),
    lanes,
    movements: authority.movements.map((item) => copyMovement(item, laneById)).sort(compareId),
  };
}

export function validateTransportAuthority(authority: TransportNetworkAuthority): void {
  const junctions = indexedById(authority.junctions, 'junction');
  const segments = indexedById(authority.segments, 'segment');
  const carriageways = indexedById(authority.carriageways, 'carriageway');
  const lanes = indexedById(authority.lanes, 'lane');
  indexedById(authority.movements, 'movement');

  for (const junction of authority.junctions) {
    requireFinite(junction.x, `Junction ${junction.id} x`);
    requireFinite(junction.y, `Junction ${junction.id} y`);
  }

  for (const segment of authority.segments) {
    if (!junctions.has(segment.startJunctionId) || !junctions.has(segment.endJunctionId)) {
      throw new Error(`Segment ${segment.id} references a missing junction`);
    }
    if (segment.startJunctionId === segment.endJunctionId) {
      throw new Error(`Segment ${segment.id} endpoints must be distinct`);
    }
    requireUniqueReferences(segment.carriagewayIds, `Segment ${segment.id} carriageways`);
    requireFinite(segment.lengthMeters, `Segment ${segment.id} length`);
    if (segment.lengthMeters <= 0) throw new Error(`Segment ${segment.id} length must be positive`);
    requireNonNegative(segment.speedLimitKph, `Segment ${segment.id} speed`);
    requireFinite(segment.condition, `Segment ${segment.id} condition`);
    for (const carriagewayId of segment.carriagewayIds) {
      const carriageway = carriageways.get(carriagewayId);
      if (!carriageway || carriageway.segmentId !== segment.id) {
        throw new Error(`Segment ${segment.id} references invalid carriageway ${carriagewayId}`);
      }
    }
  }

  for (const carriageway of authority.carriageways) {
    const segment = segments.get(carriageway.segmentId);
    if (!segment) throw new Error(`Carriageway ${carriageway.id} references missing segment ${carriageway.segmentId}`);
    if (!segment.carriagewayIds.includes(carriageway.id)) {
      throw new Error(`Carriageway ${carriageway.id} is not owned by segment ${segment.id}`);
    }
    const expectedFrom = carriageway.direction === 'forward' ? segment.startJunctionId : segment.endJunctionId;
    const expectedTo = carriageway.direction === 'forward' ? segment.endJunctionId : segment.startJunctionId;
    if (carriageway.fromJunctionId !== expectedFrom || carriageway.toJunctionId !== expectedTo) {
      throw new Error(`Carriageway ${carriageway.id} endpoints do not match its segment orientation`);
    }
    requireUniqueReferences(carriageway.laneIds, `Carriageway ${carriageway.id} lanes`);
    const ordinals = new Set<number>();
    for (const laneId of carriageway.laneIds) {
      const lane = lanes.get(laneId);
      if (!lane || lane.carriagewayId !== carriageway.id) {
        throw new Error(`Carriageway ${carriageway.id} references invalid lane ${laneId}`);
      }
      if (ordinals.has(lane.ordinal)) throw new Error(`Duplicate lane ordinal ${lane.ordinal} in carriageway ${carriageway.id}`);
      ordinals.add(lane.ordinal);
    }
  }

  for (const lane of authority.lanes) {
    const carriageway = carriageways.get(lane.carriagewayId);
    if (!carriageway || !carriageway.laneIds.includes(lane.id)) {
      throw new Error(`Lane ${lane.id} references invalid carriageway ${lane.carriagewayId}`);
    }
    if (!Number.isInteger(lane.ordinal) || lane.ordinal < 0) throw new Error(`Lane ${lane.id} ordinal must be a non-negative integer`);
    requirePermissionMask(lane.permissions, `Lane ${lane.id}`);
    requireNonNegative(lane.baseCapacityPerMinute, `Lane ${lane.id} capacity`);
    requireNonNegative(lane.freeFlowSpeedKph, `Lane ${lane.id} speed`);
  }

  for (const movement of authority.movements) {
    const from = carriageways.get(movement.fromCarriagewayId);
    const to = carriageways.get(movement.toCarriagewayId);
    if (!from || !to) throw new Error(`Movement ${movement.id} references a missing carriageway`);
    if (!junctions.has(movement.junctionId)) throw new Error(`Movement ${movement.id} references missing junction ${movement.junctionId}`);
    if (from.toJunctionId !== movement.junctionId) {
      throw new Error(`Movement ${movement.id} incoming carriageway must terminate at junction ${movement.junctionId}`);
    }
    if (to.fromJunctionId !== movement.junctionId) {
      throw new Error(`Movement ${movement.id} outgoing carriageway must originate at junction ${movement.junctionId}`);
    }
    requireUniqueReferences(movement.fromLaneIds, `Movement ${movement.id} incoming lanes`);
    requireUniqueReferences(movement.toLaneIds, `Movement ${movement.id} outgoing lanes`);
    if (movement.fromLaneIds.length === 0 || movement.toLaneIds.length === 0) {
      throw new Error(`Movement ${movement.id} must reference incoming and outgoing lanes`);
    }
    for (const laneId of movement.fromLaneIds) {
      if (!from.laneIds.includes(laneId)) throw new Error(`Movement ${movement.id} incoming lane ${laneId} belongs to the wrong carriageway`);
    }
    for (const laneId of movement.toLaneIds) {
      if (!to.laneIds.includes(laneId)) throw new Error(`Movement ${movement.id} outgoing lane ${laneId} belongs to the wrong carriageway`);
    }
    requirePermissionMask(movement.permissions, `Movement ${movement.id}`);
    requireNonNegative(movement.basePenaltyTicks, `Movement ${movement.id} penalty`);
  }
}

function emptyAuthority(): TransportNetworkAuthority {
  return { junctions: [], segments: [], carriageways: [], lanes: [], movements: [] };
}

export class TransportNetworkStore {
  topologyRevision = 0;
  costEpoch = 0;
  private authority: TransportNetworkAuthority = emptyAuthority();

  replaceAuthority(authority: TransportNetworkAuthority): TransportMutationResult {
    try {
      validateTransportAuthority(authority);
      const candidate = canonicalizeAuthority(authority);
      if (JSON.stringify(candidate) === JSON.stringify(this.authority)) return { ok: true, changed: false };
      this.authority = candidate;
      this.topologyRevision += 1;
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  setLaneOperatingState(laneId: LaneId, state: LaneOperatingState): TransportMutationResult {
    return this.mutateLane(laneId, (lane) => lane.operatingState === state ? lane : { ...lane, operatingState: state });
  }

  setLanePermissions(laneId: LaneId, permissions: VehiclePermissionMask): TransportMutationResult {
    return this.mutateLane(laneId, (lane) => lane.permissions === permissions ? lane : { ...lane, permissions });
  }

  setMovementAllowed(movementId: TurnMovementId, allowed: boolean): TransportMutationResult {
    return this.mutateMovement(movementId, (movement) => movement.allowed === allowed ? movement : { ...movement, allowed });
  }

  setMovementPermissions(movementId: TurnMovementId, permissions: VehiclePermissionMask): TransportMutationResult {
    return this.mutateMovement(movementId, (movement) => movement.permissions === permissions ? movement : { ...movement, permissions });
  }

  advanceCostEpoch(): number {
    this.costEpoch += 1;
    return this.costEpoch;
  }

  snapshot(): TransportNetworkSnapshot {
    const copy = canonicalizeAuthority(this.authority);
    return { ...copy, topologyRevision: this.topologyRevision, costEpoch: this.costEpoch };
  }

  restore(snapshot: TransportNetworkSnapshot): void {
    validateTransportAuthority(snapshot);
    if (!Number.isSafeInteger(snapshot.topologyRevision) || snapshot.topologyRevision < 0) {
      throw new Error('topologyRevision must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(snapshot.costEpoch) || snapshot.costEpoch < 0) {
      throw new Error('costEpoch must be a non-negative safe integer');
    }
    const authority: TransportNetworkAuthority = {
      junctions: snapshot.junctions,
      segments: snapshot.segments,
      carriageways: snapshot.carriageways,
      lanes: snapshot.lanes,
      movements: snapshot.movements,
    };
    this.authority = canonicalizeAuthority(authority);
    this.topologyRevision = snapshot.topologyRevision;
    this.costEpoch = snapshot.costEpoch;
  }

  private mutateLane(laneId: LaneId, transform: (lane: Lane) => Lane): TransportMutationResult {
    const current = this.authority.lanes.find((lane) => lane.id === laneId);
    if (!current) return { ok: false, changed: false, reason: `Unknown lane: ${laneId}` };
    const next = transform(current);
    if (next === current) return { ok: true, changed: false };
    return this.commitTopologyMutation({
      ...this.authority,
      lanes: this.authority.lanes.map((lane) => lane.id === laneId ? next : lane),
    });
  }

  private mutateMovement(movementId: TurnMovementId, transform: (movement: TurnMovement) => TurnMovement): TransportMutationResult {
    const current = this.authority.movements.find((movement) => movement.id === movementId);
    if (!current) return { ok: false, changed: false, reason: `Unknown movement: ${movementId}` };
    const next = transform(current);
    if (next === current) return { ok: true, changed: false };
    return this.commitTopologyMutation({
      ...this.authority,
      movements: this.authority.movements.map((movement) => movement.id === movementId ? next : movement),
    });
  }

  private commitTopologyMutation(authority: TransportNetworkAuthority): TransportMutationResult {
    try {
      validateTransportAuthority(authority);
      this.authority = canonicalizeAuthority(authority);
      this.topologyRevision += 1;
      return { ok: true, changed: true };
    } catch (error) {
      return { ok: false, changed: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }
}
