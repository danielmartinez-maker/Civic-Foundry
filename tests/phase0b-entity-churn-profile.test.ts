import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function buildCity(seed = 120): SimulationCore {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 2_000_000, seed });
  core.buildRoad(Array.from({ length: 40 }, (_, x) => ({ x, y: 12 })), 'collector');
  for (let x = 4; x <= 14; x++) core.paintZone([{ x, y: 11 }], 'residential');
  for (let x = 20; x <= 27; x++) core.paintZone([{ x, y: 11 }], 'commercial');
  for (let x = 28; x <= 36; x++) core.paintZone([{ x, y: 11 }], 'industrial');
  for (const [x, y] of [[6, 13], [10, 13], [14, 13]] as const) core.placeUtility('power', x, y);
  for (const [x, y] of [[18, 13], [22, 13], [26, 13]] as const) core.placeUtility('water', x, y);
  for (const [x, y] of [[30, 13], [33, 13], [36, 13]] as const) core.placeUtility('landfill', x, y);
  return core;
}

test('profile live-city Phase 0B entity invalidation sources', () => {
  const core = buildCity();
  const owners = {
    lots: core.lots,
    buildings: core.buildings,
    firms: core.economyDomain.firms,
    freight: core.economyDomain.freightVehicles,
    utilities: core.utilities,
    services: core.services,
    traffic: core.traffic,
    serviceVehicles: core.serviceVehicles,
    incidents: core.incidents,
  } as const;
  type OwnerName = keyof typeof owners;
  const changeTicks: Record<OwnerName | 'transit', number> = {
    lots: 0, buildings: 0, firms: 0, freight: 0, utilities: 0, services: 0,
    traffic: 0, serviceVehicles: 0, incidents: 0, transit: 0,
  };
  const revisions = (): Record<OwnerName | 'transit', number> => ({
    lots: core.lots.entityRevision,
    buildings: core.buildings.entityRevision,
    firms: core.economyDomain.firms.entityRevision,
    freight: core.economyDomain.freightVehicles.entityRevision,
    utilities: core.utilities.entityRevision,
    services: core.services.entityRevision,
    traffic: core.traffic.entityRevision,
    serviceVehicles: core.serviceVehicles.entityRevision,
    incidents: core.incidents.entityRevision,
    transit: core.transit.revision,
  });

  let fullProjectionScans = 0;
  const originalLotList = core.lots.list.bind(core.lots);
  (core.lots as unknown as { list: typeof core.lots.list }).list = () => {
    fullProjectionScans++;
    return originalLotList();
  };

  let previous = revisions();
  const registryStart = core.entityRegistry.commitRevision;
  const graphStart = core.entityReferences.commitRevision;
  const start = performance.now();
  for (let tick = 0; tick < 5000; tick++) {
    core.step(1);
    const next = revisions();
    for (const name of Object.keys(changeTicks) as Array<keyof typeof changeTicks>) {
      if (next[name] !== previous[name]) changeTicks[name]++;
    }
    previous = next;
  }
  const elapsedMs = performance.now() - start;

  console.log('PHASE0B_ENTITY_CHURN_PROFILE', JSON.stringify({
    elapsedMs: Number(elapsedMs.toFixed(2)),
    fullProjectionScans,
    registryCommits: core.entityRegistry.commitRevision - registryStart,
    graphCommits: core.entityReferences.commitRevision - graphStart,
    changeTicks,
    finalRevisions: previous,
  }));
  assert.equal(core.clock.tick, 5000);
});
