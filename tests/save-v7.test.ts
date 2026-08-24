import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCore, serializeCore, serializeCoreV6 } from '../src/save/save.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 24, height = 14): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function buildDevelopmentCity(): SimulationCore {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 500_000, seed: 91 });
  assert.equal(core.buildRoad(Array.from({ length: 18 }, (_, i) => ({ x: i + 2, y: 7 })), 'collector').ok, true);
  core.paintZone([{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }], 'residential');
  core.paintZone([{ x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }], 'commercial');
  core.paintZone([{ x: 15, y: 6 }, { x: 16, y: 6 }, { x: 17, y: 6 }], 'industrial');
  assert.equal(core.placeUtility('power', 5, 8).ok, true);
  assert.equal(core.placeUtility('water', 11, 8).ok, true);
  assert.equal(core.placeUtility('landfill', 16, 8).ok, true);
  return core;
}

function advanceUntilCommitment(core: SimulationCore, max = 200): void {
  for (let i = 0; i < max && core.developerMarket.listCommitments().length === 0; i++) core.step(1);
  assert.ok(core.developerMarket.listCommitments().length > 0, 'expected active development commitment before save');
}

test('default save API serializes Save V7 developer market and housing relocation state', () => {
  const core = buildDevelopmentCity();
  advanceUntilCommitment(core);
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 7);
  assert.equal(save.gameVersion, '0.7.0-metropolitan');
  assert.ok('developmentMarket' in save);
  assert.deepEqual(save.developmentMarket, core.developerMarket.snapshotState());
  assert.ok('housingState' in save);
  assert.deepEqual((save as any).housingState, (core as any).housingRelocation.snapshotState());
});

test('Save V7 resumes developer capital commitments, housing state, and future awards identically', () => {
  const uninterrupted = buildDevelopmentCity();
  advanceUntilCommitment(uninterrupted);
  const save = serializeCore(uninterrupted);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(loaded), save);
  assert.deepEqual((loaded as any).housingRelocation.snapshotState(), (uninterrupted as any).housingRelocation.snapshotState());
  uninterrupted.step(700);
  loaded.step(700);
  assert.deepEqual(serializeCore(loaded), serializeCore(uninterrupted));
});

test('loading V6 starts with default developers, no fabricated commitments, and zero housing movement history', () => {
  const core = buildDevelopmentCity();
  core.step(20);
  const v6 = serializeCoreV6(core);
  const loaded = hydrateCore(v6);
  assert.equal(loaded.developerMarket.listDevelopers().length, 4);
  assert.equal(loaded.developerMarket.listCommitments().length, 0);
  assert.deepEqual((loaded as any).housingRelocation.snapshotState().totals, {
    movedResidents: 0,
    displacedResidents: 0,
    rehousedDisplacedResidents: 0,
    failedSearchResidents: 0,
  });
});

test('older Save V7 without housingState initializes deterministically with zero history', () => {
  const core = buildDevelopmentCity();
  core.step(100);
  const save = structuredClone(serializeCore(core)) as any;
  delete save.housingState;
  const first = hydrateCore(structuredClone(save));
  const second = hydrateCore(structuredClone(save));
  assert.deepEqual((first as any).housingRelocation.snapshotState(), (second as any).housingRelocation.snapshotState());
  assert.deepEqual((first as any).housingRelocation.snapshotState().totals, {
    movedResidents: 0,
    displacedResidents: 0,
    rehousedDisplacedResidents: 0,
    failedSearchResidents: 0,
  });
});

test('Save V7 rejects commitments referencing missing buildings', () => {
  const core = buildDevelopmentCity();
  advanceUntilCommitment(core);
  const corrupt = structuredClone(serializeCore(core)) as unknown as {
    developmentMarket: { commitments: Array<{ buildingId: string }> };
  };
  assert.ok(corrupt.developmentMarket.commitments.length > 0);
  corrupt.developmentMarket.commitments[0]!.buildingId = 'missing-building';
  assert.throws(() => hydrateCore(corrupt), /development.*building|building.*development/i);
});

test('Phase 0A kernel infrastructure does not change Save V7 schema', () => {
  const core = new SimulationCore({ width: 12, height: 8, seed: 77 });
  const save = serializeCore(core) as unknown as Record<string, unknown>;
  assert.equal(save.saveVersion, 7);
  for (const key of ['kernel', 'commands', 'events', 'randomStreams', 'invariants', 'snapshots']) {
    assert.equal(Object.prototype.hasOwnProperty.call(save, key), false, `unexpected Phase 0A field ${key}`);
  }
});
