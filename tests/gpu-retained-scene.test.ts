import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { roadConnectivityMask, rotateRoadMask } from '../src/rendering/assets/RoadAutotile.ts';
import { PASS_A_ASSET_MANIFEST } from '../src/rendering/assets/PassAAssetManifest.ts';
import { selectCoordinateVariantEntry } from '../src/rendering/assets/VariantSelector.ts';
import { compareDepthKeys } from '../src/rendering/passes/RenderOrder.ts';

const retainedModuleUrl = new URL('../src/rendering/gpu/RetainedSceneIndex.ts', import.meta.url);
const catalogModuleUrl = new URL('../src/rendering/gpu/GpuAssetCatalog.ts', import.meta.url);
const baseCommandsModuleUrl = new URL('../src/rendering/gpu/BaseSpriteCommands.ts', import.meta.url);

async function loadRetainedSceneIndex(): Promise<any> {
  assert.ok(existsSync(retainedModuleUrl), 'RetainedSceneIndex must exist before retained GPU rendering can be implemented');
  const module = await import(retainedModuleUrl.href);
  assert.equal(typeof module.RetainedSceneIndex, 'function');
  return module.RetainedSceneIndex;
}

async function loadGpuAssetCatalog(): Promise<any> {
  assert.ok(existsSync(catalogModuleUrl), 'GpuAssetCatalog must exist and wrap the canonical Pass A manifest');
  const module = await import(catalogModuleUrl.href);
  assert.equal(typeof module.GpuAssetCatalog, 'function');
  return module.GpuAssetCatalog;
}

async function loadBaseSpriteCommands(): Promise<any> {
  assert.ok(existsSync(baseCommandsModuleUrl), 'BaseSpriteCommands must derive deterministic GPU sprite identities');
  const module = await import(baseCommandsModuleUrl.href);
  assert.equal(typeof module.buildBaseSpriteCommands, 'function');
  return module.buildBaseSpriteCommands;
}

function flatTerrain(width = 8, height = 8): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

test('retained index reuses identity for an unchanged fingerprint', async () => {
  const RetainedSceneIndex = await loadRetainedSceneIndex();
  const index = new RetainedSceneIndex();
  let nextId = 0;
  const hooks = {
    create: () => ({ id: ++nextId }),
    update: () => undefined,
    destroy: () => undefined,
  };

  const first = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], hooks);
  const second = index.sync([{ key: 'road:4,4', fingerprint: 'local|3' }], hooks);

  assert.equal(first.entries[0]?.value.id, second.entries[0]?.value.id);
  assert.equal(second.delta.created, 0);
  assert.equal(second.delta.updated, 0);
  assert.equal(second.delta.removed, 0);
  assert.equal(second.totals.active, 1);
});

test('retained index updates in place and destroys keys that disappear', async () => {
  const RetainedSceneIndex = await loadRetainedSceneIndex();
  const index = new RetainedSceneIndex();
  let nextId = 0;
  let updates = 0;
  let destroys = 0;
  const hooks = {
    create: () => ({ id: ++nextId }),
    update: () => { updates += 1; },
    destroy: () => { destroys += 1; },
  };

  const first = index.sync([{ key: 'building:a', fingerprint: 'occupied|asset-a' }], hooks);
  const firstId = first.entries[0]?.value.id;
  const changed = index.sync([{ key: 'building:a', fingerprint: 'construction|asset-b' }], hooks);

  assert.equal(changed.entries[0]?.value.id, firstId);
  assert.equal(changed.delta.created, 0);
  assert.equal(changed.delta.updated, 1);
  assert.equal(updates, 1);

  const removed = index.sync([], hooks);
  assert.equal(removed.delta.removed, 1);
  assert.equal(removed.totals.active, 0);
  assert.equal(destroys, 1);
});

test('GPU asset catalog queries and resolves the canonical Pass A manifest', async () => {
  const GpuAssetCatalog = await loadGpuAssetCatalog();
  const catalog = new GpuAssetCatalog(PASS_A_ASSET_MANIFEST);

  assert.equal(catalog.query({ category: 'road', subcategory: 'local' }).length, 16);
  assert.equal(catalog.resolveEntry('vehicle_bus_01_o2')?.variantKey, 'vehicle_bus_01');
  assert.equal(catalog.resolveVariant('vehicle_bus_01', 2)?.assetId, 'vehicle_bus_01_o2');
  assert.deepEqual(catalog.diagnostics(), []);
});

test('GPU asset catalog surfaces canonical manifest validation errors', async () => {
  const GpuAssetCatalog = await loadGpuAssetCatalog();
  const entry = PASS_A_ASSET_MANIFEST.entries[0]!;
  const invalidManifest = {
    schemaVersion: 1,
    atlases: PASS_A_ASSET_MANIFEST.atlases,
    entries: [entry, entry],
  };
  const catalog = new GpuAssetCatalog(invalidManifest);
  assert.ok(catalog.diagnostics().some((message: string) => message.includes('duplicate assetId')));
});

test('base sprite commands reuse canonical terrain and road selection rules', async () => {
  const buildBaseSpriteCommands = await loadBaseSpriteCommands();
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 41 });
  assert.equal(core.buildRoad([{ x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }], 'collector').ok, true);

  const commands = buildBaseSpriteCommands(core, 1);
  const terrain = commands.find((command: any) => command.key === 'terrain:0,0');
  const terrainCandidates = PASS_A_ASSET_MANIFEST.entries.filter((entry) => entry.category === 'terrain' && entry.subcategory === 'grass');
  const expectedTerrain = selectCoordinateVariantEntry('terrain:grass', 0, 0, terrainCandidates);
  assert.equal(terrain?.assetId, expectedTerrain?.assetId);

  const roads = core.roads.list();
  const roadByCell = new Map(roads.map((road) => [`${road.x},${road.y}`, road] as const));
  const mask = rotateRoadMask(
    roadConnectivityMask(3, 4, (x, y) => roadByCell.get(`${x},${y}`)?.type),
    1,
  );
  const road = commands.find((command: any) => command.key === 'road:3,4');
  assert.equal(road?.assetId, `road_collector_mask_${mask.toString().padStart(2, '0')}`);
  assert.ok(road?.fingerprint.includes(road.assetId));
});

test('base sprite commands are deterministically depth-sorted', async () => {
  const buildBaseSpriteCommands = await loadBaseSpriteCommands();
  const core = new SimulationCore({ terrain: flatTerrain(), startingFunds: 100_000, seed: 52 });
  assert.equal(core.buildRoad([{ x: 1, y: 5 }, { x: 2, y: 5 }], 'local').ok, true);
  const commands = buildBaseSpriteCommands(core, 3);
  for (let index = 1; index < commands.length; index += 1) {
    assert.ok(compareDepthKeys(commands[index - 1]!.depth, commands[index]!.depth) <= 0);
  }
});
