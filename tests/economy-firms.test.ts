import test from 'node:test';
import assert from 'node:assert/strict';
import { FirmSystem } from '../src/simulation/economy/FirmSystem.ts';
import { LaborMarketSystem } from '../src/simulation/economy/LaborMarketSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';

const commercial: Building = { id: 'building:a', lotId: 'a', x: 1, y: 1, zone: 'commercial', definitionId: 'commercial_shop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
const industrial: Building = { id: 'building:b', lotId: 'b', x: 2, y: 1, zone: 'industrial', definitionId: 'industrial_workshop', status: 'occupied', constructionStartedTick: 0, completionTick: 0 };
const residential: Building = { id: 'building:r', lotId: 'r', x: 3, y: 1, zone: 'residential', definitionId: 'residential_cottage', status: 'occupied', constructionStartedTick: 0, completionTick: 0 };

test('firm assignment is independent of input iteration order', () => {
  const a = new FirmSystem(42); a.syncEligibleBuildings([commercial, industrial], 100);
  const b = new FirmSystem(42); b.syncEligibleBuildings([industrial, commercial], 100);
  assert.deepEqual(a.list(), b.list());
});

test('new firms begin forming and residential buildings never host firms', () => {
  const firms = new FirmSystem(7); firms.syncEligibleBuildings([commercial, industrial, residential], 100);
  assert.equal(firms.list().length, 2);
  assert.ok(firms.list().every((firm) => firm.status === 'forming'));
});

test('forming firms do not create authoritative jobs', () => {
  const firms = new FirmSystem(7); firms.syncEligibleBuildings([industrial], 100);
  const snapshot = new LaborMarketSystem().allocate(firms.list(), 20, { accessibility: 1, utilityRatio: 1 });
  assert.equal(snapshot.workforce, 10);
  assert.equal(snapshot.totalJobs, 0);
  assert.equal(snapshot.employed, 0);
});
