import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import type { EntityProjectionPartition } from '../src/entities/EntityProjection.ts';

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

test('profile optimized Phase 0B partition churn', () => {
  const core = buildCity();
  const projector = (core as unknown as { entityProjector: { projectPartitions: (source: SimulationCore) => readonly EntityProjectionPartition[] } }).entityProjector;
  const original = projector.projectPartitions.bind(projector);
  const prior = new Map<string, EntityProjectionPartition>();
  const changes = new Map<string, number>();
  const changedEntities = new Map<string, number>();
  const changedReferences = new Map<string, number>();

  projector.projectPartitions = (source: SimulationCore) => {
    const partitions = original(source);
    for (const partition of partitions) {
      const previous = prior.get(partition.id);
      if (previous !== partition) {
        changes.set(partition.id, (changes.get(partition.id) ?? 0) + 1);
        changedEntities.set(partition.id, (changedEntities.get(partition.id) ?? 0) + partition.projection.entities.length);
        changedReferences.set(partition.id, (changedReferences.get(partition.id) ?? 0) + partition.projection.references.length);
        prior.set(partition.id, partition);
      }
    }
    return partitions;
  };

  core.step(5000);
  const ordered = [...changes.keys()].sort().map((id) => ({
    id,
    changes: changes.get(id) ?? 0,
    entitiesAcrossChanges: changedEntities.get(id) ?? 0,
    referencesAcrossChanges: changedReferences.get(id) ?? 0,
  }));
  console.log('PHASE0B_PARTITION_CHURN', JSON.stringify(ordered));
  assert.equal(core.clock.tick, 5000);
});
