import test from 'node:test';
import assert from 'node:assert/strict';
import { PowerNetworkSystem } from '../src/simulation/utilities/PowerNetworkSystem.ts';
import type { UtilityCorridorCell, UtilityCorridorType, UtilityFacility, UtilityTier } from '../src/simulation/utilities/UtilityInfrastructureTypes.ts';

const cell = (id: string, type: UtilityCorridorType, x: number, y: number, tier: UtilityTier = 1): UtilityCorridorCell => ({
  id, type, x, y, tier, saturatedCycles: 0, trippedUntilTick: 0,
});
const source: UtilityFacility = { id: 'utility:1', type: 'power', x: 0, y: 1 };

test('explicit distribution is required for power delivery', () => {
  const system = new PowerNetworkSystem();
  const demand = [{ id: 'b1', x: 2, y: 1, demand: 6 }];
  const noNetwork = system.evaluate({ corridors: [], facilities: [source], demands: demand, tick: 0 });
  assert.equal(noNetwork.perBuilding.b1?.serviceRatio, 0);
  const corridors = [cell('c1', 'power_distribution', 1, 1), cell('c2', 'power_distribution', 2, 1)];
  const connected = system.evaluate({ corridors, facilities: [source], demands: demand, tick: 0 });
  assert.equal(connected.perBuilding.b1?.delivered, 6);
  assert.equal(connected.perBuilding.b1?.serviceRatio, 1);
});

test('transmission does not directly serve a building', () => {
  const system = new PowerNetworkSystem();
  const snapshot = system.evaluate({
    corridors: [cell('t1', 'power_transmission', 1, 1), cell('t2', 'power_transmission', 2, 1)],
    facilities: [source],
    demands: [{ id: 'b1', x: 2, y: 1, demand: 6 }],
    tick: 0,
  });
  assert.equal(snapshot.perBuilding.b1?.serviceRatio, 0);
});

test('a directional substation bridges transmission into distribution with finite transfer capacity', () => {
  const system = new PowerNetworkSystem();
  const corridors = [
    cell('t1', 'power_transmission', 1, 1, 3),
    cell('d1', 'power_distribution', 3, 1, 3),
  ];
  const substation: UtilityFacility = {
    id: 'utility:2', type: 'power_substation', x: 2, y: 1,
    inputCoord: { x: 1, y: 1 }, outputCoord: { x: 3, y: 1 },
  };
  const full = system.evaluate({
    corridors, facilities: [source, substation], demands: [{ id: 'b1', x: 4, y: 1, demand: 180 }], tick: 0,
  });
  assert.equal(full.perBuilding.b1?.serviceRatio, 1);
  const capped = system.evaluate({
    corridors, facilities: [source, { ...source, id: 'utility:3' }, { ...source, id: 'utility:4' }, { ...source, id: 'utility:5' }, { ...source, id: 'utility:6' }, { ...source, id: 'utility:7' }, { ...source, id: 'utility:8' }, { ...source, id: 'utility:9' }, substation],
    demands: [{ id: 'b1', x: 4, y: 1, demand: 2_000 }], tick: 0,
  });
  assert.ok((capped.perBuilding.b1?.delivered ?? 0) <= 1_440);
});

test('a tier-1 branch bottleneck creates partial service without starving an independent branch', () => {
  const system = new PowerNetworkSystem();
  const corridors = [
    cell('heavy-a', 'power_distribution', 1, 1),
    cell('heavy-b', 'power_distribution', 2, 1),
    cell('light-a', 'power_distribution', 6, 1),
  ];
  const facilities: UtilityFacility[] = [source, { id: 'utility:2', type: 'power', x: 5, y: 1 }];
  const snapshot = system.evaluate({
    corridors,
    facilities,
    demands: [{ id: 'heavy', x: 3, y: 1, demand: 240 }, { id: 'light', x: 7, y: 1, demand: 6 }],
    tick: 0,
  });
  assert.ok((snapshot.perBuilding.heavy?.serviceRatio ?? 0) > 0);
  assert.ok((snapshot.perBuilding.heavy?.serviceRatio ?? 1) < 1);
  assert.equal(snapshot.perBuilding.light?.serviceRatio, 1);
});

test('power snapshot is independent of corridor facility and demand input ordering', () => {
  const system = new PowerNetworkSystem();
  const corridors = [cell('c1', 'power_distribution', 1, 1), cell('c2', 'power_distribution', 2, 1)];
  const facilities: UtilityFacility[] = [source];
  const demands = [{ id: 'b2', x: 3, y: 1, demand: 5 }, { id: 'b1', x: 2, y: 2, demand: 6 }];
  const first = system.evaluate({ corridors, facilities, demands, tick: 0 });
  const second = system.evaluate({ corridors: [...corridors].reverse(), facilities: [...facilities].reverse(), demands: [...demands].reverse(), tick: 0 });
  assert.deepEqual(first, second);
});

test('additional headroom uses residual source and corridor capacity', () => {
  const system = new PowerNetworkSystem();
  const corridors = [cell('c1', 'power_distribution', 1, 1), cell('c2', 'power_distribution', 2, 1)];
  const snapshot = system.evaluate({ corridors, facilities: [source], demands: [{ id: 'existing', x: 3, y: 1, demand: 170 }], tick: 0 });
  const result = system.evaluateAdditionalHeadroom({ x: 2, y: 2, demand: 30, snapshot, corridors, facilities: [source], tick: 0 });
  assert.equal(result.deliverable, 10);
  assert.equal(result.serviceRatio, 1 / 3);
  const disconnected = system.evaluateAdditionalHeadroom({ x: 7, y: 3, demand: 10, snapshot, corridors, facilities: [source], tick: 0 });
  assert.equal(disconnected.deliverable, 0);
  assert.equal(disconnected.limitingReason, 'no-distribution-connection');
});
