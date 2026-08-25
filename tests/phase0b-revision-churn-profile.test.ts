import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function flat(width = 40, height = 24): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5, water: false, buildable: true, biome: 'grass' as const,
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

type RevisionVector = Readonly<{
  lots: number | undefined;
  buildings: number | undefined;
  firms: number | undefined;
  freight: number | undefined;
  utilities: number | undefined;
  services: number | undefined;
  transit: number | undefined;
  traffic: number | undefined;
  serviceVehicles: number | undefined;
  incidents: number | undefined;
}>;

type CoreInternals = SimulationCore & {
  entityProjector: {
    projectPartitions: (source: SimulationCore) => readonly unknown[];
    sourceRevisionKey: (source: SimulationCore) => string | undefined;
  };
};

function revisions(core: SimulationCore): RevisionVector {
  return {
    lots: core.lots.entityRevision,
    buildings: core.buildings.entityRevision,
    firms: core.economyDomain.firms.entityRevision,
    freight: core.economyDomain.freightVehicles.entityRevision,
    utilities: core.utilities.entityRevision,
    services: core.services.entityRevision,
    transit: core.transit.revision,
    traffic: core.traffic.entityRevision,
    serviceVehicles: core.serviceVehicles.entityRevision,
    incidents: core.incidents.entityRevision,
  };
}

test('profile authoritative entity revision churn over the developed-city workload', () => {
  const core = buildCity() as CoreInternals;
  const keys = Object.keys(revisions(core)) as (keyof RevisionVector)[];
  const changes = Object.fromEntries(keys.map((key) => [key, 0])) as Record<keyof RevisionVector, number>;
  let sourceKeyChanges = 0;
  let projectorCalls = 0;
  let registryCommits = 0;

  const projector = core.entityProjector;
  const originalProject = projector.projectPartitions.bind(projector);
  projector.projectPartitions = (source) => {
    projectorCalls++;
    return originalProject(source);
  };

  let previous = revisions(core);
  let previousSourceKey = projector.sourceRevisionKey(core);
  let previousRegistryRevision = core.entityRegistry.commitRevision;

  for (let tick = 0; tick < 5000; tick++) {
    core.step(1);
    const next = revisions(core);
    for (const key of keys) if (next[key] !== previous[key]) changes[key]++;
    const nextSourceKey = projector.sourceRevisionKey(core);
    if (nextSourceKey !== previousSourceKey) sourceKeyChanges++;
    if (core.entityRegistry.commitRevision !== previousRegistryRevision) registryCommits++;
    previous = next;
    previousSourceKey = nextSourceKey;
    previousRegistryRevision = core.entityRegistry.commitRevision;
  }

  console.log('PHASE0B_REVISION_CHURN', JSON.stringify({
    changes,
    sourceKeyChanges,
    projectorCalls,
    registryCommits,
  }));

  assert.equal(core.clock.tick, 5000);
  assert.ok(sourceKeyChanges >= registryCommits);
});
