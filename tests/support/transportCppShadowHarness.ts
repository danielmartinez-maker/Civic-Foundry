import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { TerrainGrid, type TerrainCell } from '../../src/world/terrain/TerrainGrid.ts';
import { RoadSystem, type RoadCell } from '../../src/world/roads/RoadSystem.ts';
import { LegacyRoadNetworkAdapter } from '../../src/simulation/transportation/LegacyRoadNetworkAdapter.ts';
import { TransportNetworkStore } from '../../src/simulation/transportation/TransportNetworkStore.ts';
import { buildLaneGroups } from '../../src/simulation/transportation/LaneGroupBuilder.ts';
import { buildRoutingTopology } from '../../src/simulation/transportation/RoutingTopology.ts';
import { MovementAwarePathfindingSystem } from '../../src/simulation/transportation/MovementAwarePathfindingSystem.ts';
import { VEHICLE_PERMISSION, type TransportNetworkAuthority } from '../../src/simulation/transportation/TransportNetworkTypes.ts';

export const nativePath = process.env.CIVIC_TRANSPORT_NAPI;
const require = createRequire(import.meta.url);
export const native = nativePath ? require(nativePath) : undefined;

const ROAD_CLASS = { local: 0, collector: 1, arterial: 2 } as const;

type NativeSnapshot = Readonly<{
  junctions: readonly Readonly<{ id: string; x: number; y: number }>[];
  segments: readonly Readonly<{ id: string; startJunctionId: string; endJunctionId: string; carriagewayIds: readonly string[] }>[];
  carriageways: readonly Readonly<{ id: string; segmentId: string; fromJunctionId: string; toJunctionId: string; laneIds: readonly string[] }>[];
  lanes: readonly Readonly<{ id: string; carriagewayId: string; ordinal: number; permissions: number; open: boolean }>[];
  movements: readonly Readonly<{
    id: string;
    junctionId: string;
    fromCarriagewayId: string;
    toCarriagewayId: string;
    fromLaneIds: readonly string[];
    toLaneIds: readonly string[];
    permissions: number;
    allowed: boolean;
  }>[];
}>;

function flatTerrain(width = 12, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function canonical<T extends { id: string }>(items: readonly T[]): readonly T[] {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeTs(authority: TransportNetworkAuthority) {
  return {
    junctions: canonical(authority.junctions).map(({ id, x, y }) => ({ id, x, y })),
    segments: canonical(authority.segments).map(({ id, startJunctionId, endJunctionId, carriagewayIds }) => ({
      id,
      startJunctionId,
      endJunctionId,
      carriagewayIds: [...carriagewayIds].sort(),
    })),
    carriageways: canonical(authority.carriageways).map(({ id, segmentId, fromJunctionId, toJunctionId, laneIds }) => ({
      id,
      segmentId,
      fromJunctionId,
      toJunctionId,
      laneIds: [...laneIds],
    })),
    lanes: canonical(authority.lanes).map(({ id, carriagewayId, ordinal, permissions, operatingState }) => ({
      id,
      carriagewayId,
      ordinal,
      permissions,
      open: operatingState === 'open',
    })),
    movements: canonical(authority.movements).map((movement) => ({
      id: movement.id,
      junctionId: movement.junctionId,
      fromCarriagewayId: movement.fromCarriagewayId,
      toCarriagewayId: movement.toCarriagewayId,
      fromLaneIds: [...movement.fromLaneIds],
      toLaneIds: [...movement.toLaneIds],
      permissions: movement.permissions,
      allowed: movement.allowed,
    })),
  };
}

function normalizeNative(snapshot: NativeSnapshot) {
  return {
    junctions: canonical(snapshot.junctions).map((value) => ({ ...value })),
    segments: canonical(snapshot.segments).map((value) => ({ ...value, carriagewayIds: [...value.carriagewayIds].sort() })),
    carriageways: canonical(snapshot.carriageways).map((value) => ({ ...value, laneIds: [...value.laneIds] })),
    lanes: canonical(snapshot.lanes).map((value) => ({ ...value })),
    movements: canonical(snapshot.movements).map((value) => ({
      ...value,
      fromLaneIds: [...value.fromLaneIds],
      toLaneIds: [...value.toLaneIds],
    })),
  };
}

function firstDivergence(expected: unknown, actual: unknown, path = '$'): string | undefined {
  if (Object.is(expected, actual)) return undefined;
  if (typeof expected !== typeof actual) return `${path}: type ${typeof expected} != ${typeof actual}`;
  if (expected === null || actual === null) return `${path}: ${String(expected)} != ${String(actual)}`;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) return `${path}: array shape mismatch`;
    if (expected.length !== actual.length) return `${path}.length: ${expected.length} != ${actual.length}`;
    for (let i = 0; i < expected.length; i++) {
      const mismatch = firstDivergence(expected[i], actual[i], `${path}[${i}]`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  if (typeof expected === 'object' && typeof actual === 'object') {
    const left = expected as Record<string, unknown>;
    const right = actual as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      if (!(key in left)) return `${path}.${key}: missing from TypeScript projection`;
      if (!(key in right)) return `${path}.${key}: missing from native projection`;
      const mismatch = firstDivergence(left[key], right[key], `${path}.${key}`);
      if (mismatch) return mismatch;
    }
    return undefined;
  }
  return `${path}: ${JSON.stringify(expected)} != ${JSON.stringify(actual)}`;
}

function assertParity(label: string, expected: unknown, actual: unknown): void {
  const mismatch = firstDivergence(expected, actual);
  assert.equal(mismatch, undefined, `${label} first divergence: ${mismatch ?? 'unknown'}`);
}

function loadTs(cells: readonly RoadCell[], revision: number) {
  const roads = new RoadSystem(flatTerrain());
  roads.restore(cells, revision);
  const authority = new LegacyRoadNetworkAdapter().projectAuthorityIfNeeded(roads).authority;
  const store = new TransportNetworkStore();
  assert.deepEqual(store.replaceAuthority(authority), { ok: true, changed: true });
  const snapshot = store.snapshot();
  const topology = buildRoutingTopology(snapshot, buildLaneGroups(snapshot));
  return { authority, snapshot, topology };
}

function loadNative(handle: number, cells: readonly RoadCell[], revision: number): NativeSnapshot {
  native.loadLegacyRoads(handle, cells.map((cell) => ({
    x: cell.x,
    y: cell.y,
    roadClass: ROAD_CLASS[cell.type],
    oneWay: false,
    oneWayDirection: 0,
  })), revision);
  return JSON.parse(native.snapshotJson(handle)) as NativeSnapshot;
}

function tsRoute(cells: readonly RoadCell[], revision: number, start: string, end: string) {
  const { snapshot, topology } = loadTs(cells, revision);
  return new MovementAwarePathfindingSystem().findRoute(topology, start, end, {
    permissions: VEHICLE_PERMISSION.privateCar,
    costEpoch: snapshot.costEpoch,
  });
}

export function compareRoute(handle: number, label: string, cells: readonly RoadCell[], revision: number, start: string, end: string): void {
  const expected = tsRoute(cells, revision, start, end);
  loadNative(handle, cells, revision);
  if (!expected) {
    assert.throws(() => native.findRouteJson(handle, start, end, VEHICLE_PERMISSION.privateCar), undefined, `${label}: native should also reject disconnected route`);
    return;
  }
  const actual = JSON.parse(native.findRouteJson(handle, start, end, VEHICLE_PERMISSION.privateCar));
  assertParity(`${label}.route.ids`, {
    junctionIds: expected.junctionIds,
    carriagewayIds: expected.carriagewayIds,
    movementIds: expected.movementIds,
  }, {
    junctionIds: actual.junctionIds,
    carriagewayIds: actual.carriagewayIds,
    movementIds: actual.movementIds,
  });
  assert.ok(Number.isFinite(actual.totalCost), `${label}: native route cost must be finite`);
  assert.ok(Math.abs(actual.totalCost - expected.totalCost) <= 1e-6, `${label}: route cost ${actual.totalCost} != ${expected.totalCost}`);
}


export type ShadowRoadCell = RoadCell;

export function assertNetworkParity(handle: number, label: string, cells: readonly RoadCell[], revision: number): void {
  const ts = loadTs(cells, revision);
  const cpp = loadNative(handle, cells, revision);
  assertParity(`${label}.network`, normalizeTs(ts.authority), normalizeNative(cpp));
}
