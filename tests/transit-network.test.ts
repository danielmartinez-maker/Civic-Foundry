import test from 'node:test';
import assert from 'node:assert/strict';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { TreasurySystem } from '../src/simulation/treasury/TreasurySystem.ts';
import { RoadSystem } from '../src/world/roads/RoadSystem.ts';
import { TransitNetworkSystem } from '../src/simulation/transit/TransitNetworkSystem.ts';

function buildableTerrain(width = 12, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' }));
  return new TerrainGrid(width, height, cells);
}

function fixture() {
  const terrain = buildableTerrain();
  const treasury = new TreasurySystem(100_000);
  const roads = new RoadSystem(terrain);
  assert.equal(roads.placePath(Array.from({ length: 10 }, (_, x) => ({ x: x + 1, y: 3 })), 'collector', treasury).ok, true);
  return { terrain, treasury, roads, network: new TransitNetworkSystem(terrain, roads) };
}

test('transit stops and lines receive deterministic IDs and revisions', () => {
  const { treasury, network } = fixture();
  const first = network.placeStop('surface_stop', 2, 2, treasury);
  const second = network.placeStop('surface_stop', 8, 2, treasury);
  assert.deepEqual([first.id, second.id], ['transit-stop:1', 'transit-stop:2']);
  assert.equal(network.revision, 2);
  const lineId = network.createLine('bus', 'Crosstown');
  assert.equal(lineId, 'transit-line:1');
  assert.equal(network.revision, 3);
  assert.equal(network.setLineStops(lineId, [first.id!, second.id!]).ok, true);
  assert.equal(network.revision, 4);
  assert.deepEqual(network.getLine(lineId)?.stopIds, [first.id, second.id]);
});

test('stop placement requires buildable road access and rejects collisions', () => {
  const { treasury, network } = fixture();
  assert.equal(network.placeStop('surface_stop', 0, 0, treasury).ok, false);
  const placed = network.placeStop('surface_stop', 4, 2, treasury);
  assert.equal(placed.ok, true);
  assert.equal(network.placeStop('surface_stop', 4, 2, treasury).ok, false);
});

test('line stop sequences validate existence, uniqueness, count, and mode compatibility', () => {
  const { treasury, network } = fixture();
  const a = network.placeStop('surface_stop', 2, 2, treasury).id!;
  const b = network.placeStop('surface_stop', 6, 2, treasury).id!;
  const metro = network.placeStop('metro_station', 9, 2, treasury).id!;
  const bus = network.createLine('bus', 'Bus');
  const subway = network.createLine('metro', 'Metro');
  assert.equal(network.setLineStops(bus, [a]).ok, false);
  assert.equal(network.setLineStops(bus, [a, a]).ok, false);
  assert.equal(network.setLineStops(bus, [a, 'missing']).ok, false);
  assert.equal(network.setLineStops(bus, [a, metro]).ok, false);
  assert.equal(network.setLineStops(bus, [a, b]).ok, true);
  assert.equal(network.setLineStops(subway, [metro, a]).ok, false);
});

test('headway and fare are bounded and enabled state is authoritative', () => {
  const { treasury, network } = fixture();
  const a = network.placeStop('surface_stop', 2, 2, treasury).id!;
  const b = network.placeStop('surface_stop', 6, 2, treasury).id!;
  const line = network.createLine('tram', 'T1');
  network.setLineStops(line, [a, b]);
  assert.equal(network.setHeadway(line, 1), 20);
  assert.equal(network.setHeadway(line, 9_999), 600);
  assert.equal(network.setFare(line, -5), 0);
  assert.equal(network.setFare(line, 99), 20);
  assert.equal(network.setEnabled(line, false), false);
  assert.equal(network.getLine(line)?.enabled, false);
});

test('deleting a stop deterministically invalidates affected lines', () => {
  const { treasury, network } = fixture();
  const a = network.placeStop('surface_stop', 2, 2, treasury).id!;
  const b = network.placeStop('surface_stop', 5, 2, treasury).id!;
  const c = network.placeStop('surface_stop', 8, 2, treasury).id!;
  const line = network.createLine('brt', 'BRT');
  network.setLineStops(line, [a, b, c]);
  network.setEnabled(line, true);
  const before = network.revision;
  assert.equal(network.removeStop(b), true);
  assert.equal(network.revision, before + 1);
  assert.deepEqual(network.getLine(line)?.stopIds, [a, c]);
  assert.equal(network.getLine(line)?.enabled, true);
  assert.equal(network.removeStop(c), true);
  assert.deepEqual(network.getLine(line)?.stopIds, [a]);
  assert.equal(network.getLine(line)?.enabled, false);
});

test('transit topology snapshot restores exact authoritative state and next IDs', () => {
  const { terrain, treasury, roads, network } = fixture();
  const a = network.placeStop('surface_stop', 2, 2, treasury).id!;
  const b = network.placeStop('surface_stop', 8, 2, treasury).id!;
  const line = network.createLine('bus', 'Route 7');
  network.setLineStops(line, [a, b]);
  network.setHeadway(line, 45);
  network.setFare(line, 2.75);
  const snapshot = network.snapshot();
  const restored = new TransitNetworkSystem(terrain, roads);
  restored.restore(snapshot);
  assert.deepEqual(restored.snapshot(), snapshot);
  assert.equal(restored.placeStop('surface_stop', 5, 2, treasury).id, 'transit-stop:3');
  assert.equal(restored.createLine('bus', 'Next'), 'transit-line:2');
});
