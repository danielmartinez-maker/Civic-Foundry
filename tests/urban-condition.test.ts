import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';
import { UrbanConditionSystem, calculateMaintenanceAdequacy } from '../src/simulation/urban/UrbanConditionSystem.ts';
import { conditionCapacityMultiplier } from '../src/simulation/urban/UrbanBuildingView.ts';
import type { UrbanBuildingState } from '../src/simulation/urban/UrbanTypes.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

function state(overrides: Partial<UrbanBuildingState> = {}): UrbanBuildingState {
  return {
    buildingId: 'building:a',
    useComponents: [{ use: 'residential', areaShareBps: 10_000, residentCapacity: 20, jobCapacity: 0, taxBase: 200 }],
    qualityTier: 'standard',
    conditionScore: 80,
    lifecycleState: 'stabilized',
    conditionEstablishedTick: 0,
    lastConditionTick: 0,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 4 },
    ...overrides,
  };
}

function harness(initial = state()) {
  const domain = new UrbanFabricDomain();
  domain.install(initial);
  const condition = new UrbanConditionSystem(domain);
  const context = {
    buildingContext: (buildingId: string) => ({
      buildingId,
      buildingOccupied: true,
      occupancyUtilization: 0.75,
      utilityRatio: 0.8,
      serviceQuality: 0.7,
      neighborhoodQuality: 0.7,
      marketRentStrength: 0.8,
      firmDistress: 0.1,
      assignedResidents: 10,
      activeFirm: false,
    }),
  } as const;
  return { domain, condition, context };
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

function coreWithOccupiedResidential(mode: 'legacy' | 'semantic'): SimulationCore {
  const core = new SimulationCore({ terrain: flatTerrain(), seed: 19, urbanDevelopmentMode: mode });
  core.buildings.restore([{
    id: 'building:lot:1,1',
    lotId: 'lot:1,1',
    x: 1,
    y: 1,
    zone: 'residential',
    definitionId: 'residential_cottage',
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  core.urbanFabric.install({
    ...state({ buildingId: 'building:lot:1,1' }),
    parking: { profile: 'legacy-none', spaces: 0 },
  });
  return core;
}

test('maintenance adequacy is bounded and exposes a deterministic contribution trace', () => {
  const result = calculateMaintenanceAdequacy({
    occupancyUtilization: 0.8,
    utilityRatio: 0.9,
    serviceQuality: 0.7,
    neighborhoodQuality: 0.6,
    marketRentStrength: 0.75,
    firmDistress: 0.2,
  });
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.deepEqual(Object.keys(result.contributions), [
    'occupancy', 'utilities', 'services', 'neighborhood', 'market', 'firmHealth',
  ]);
  assert.ok(Math.abs(Object.values(result.contributions).reduce((sum, value) => sum + value, 0) - result.score) < 1e-12);
});

test('chunked stepping equals one-boundary-at-a-time stepping', () => {
  const a = harness();
  const b = harness();
  a.condition.updateThroughTick(1_000, a.context);
  for (let tick = 100; tick <= 1_000; tick += 100) b.condition.updateThroughTick(tick, b.context);
  assert.deepEqual(a.domain.snapshotState(), b.domain.snapshotState());
});

test('condition never improves without renovation and better adequacy only slows wear', () => {
  const poor = harness();
  const strong = harness();
  const poorContext = {
    buildingContext: (buildingId: string) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 0.1, utilityRatio: 0.2,
      serviceQuality: 0.2, neighborhoodQuality: 0.2, marketRentStrength: 0.2,
      firmDistress: 1, assignedResidents: 2, activeFirm: false,
    }),
  } as const;
  const strongContext = {
    buildingContext: (buildingId: string) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 1, utilityRatio: 1,
      serviceQuality: 1, neighborhoodQuality: 1, marketRentStrength: 1,
      firmDistress: 0, assignedResidents: 20, activeFirm: false,
    }),
  } as const;
  poor.condition.updateThroughTick(2_000, poorContext);
  strong.condition.updateThroughTick(2_000, strongContext);
  const poorScore = poor.domain.get('building:a')!.conditionScore;
  const strongScore = strong.domain.get('building:a')!.conditionScore;
  assert.ok(poorScore < strongScore);
  assert.ok(strongScore <= 80);
});

test('quality resilience slows otherwise identical wear', () => {
  const economy = harness(state({ qualityTier: 'economy' }));
  const luxury = harness(state({ qualityTier: 'luxury' }));
  economy.condition.updateThroughTick(1_000, economy.context);
  luxury.condition.updateThroughTick(1_000, luxury.context);
  assert.ok(luxury.domain.get('building:a')!.conditionScore > economy.domain.get('building:a')!.conditionScore);
});

test('condition thresholds drive lifecycle while abandonment requires zero residents and no active firm', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state({ conditionScore: 26, lifecycleState: 'neglected' }));
  const system = new UrbanConditionSystem(domain);
  system.updateThroughTick(100, {
    buildingContext: (buildingId) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 0, utilityRatio: 0,
      serviceQuality: 0, neighborhoodQuality: 0, marketRentStrength: 0,
      firmDistress: 1, assignedResidents: 5, activeFirm: false,
    }),
  });
  assert.equal(domain.get('building:a')!.lifecycleState, 'condemned');

  system.updateThroughTick(200, {
    buildingContext: (buildingId) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 0, utilityRatio: 0,
      serviceQuality: 0, neighborhoodQuality: 0, marketRentStrength: 0,
      firmDistress: 1, assignedResidents: 0, activeFirm: false,
    }),
  });
  assert.equal(domain.get('building:a')!.lifecycleState, 'abandoned');
});

test('completed construction enters lease-up then stabilizes on successful occupancy', () => {
  const domain = new UrbanFabricDomain();
  domain.install(state({ conditionScore: 100, lifecycleState: 'construction' }));
  const system = new UrbanConditionSystem(domain);
  system.updateThroughTick(100, {
    buildingContext: (buildingId) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 0, utilityRatio: 1,
      serviceQuality: 1, neighborhoodQuality: 1, marketRentStrength: 1,
      firmDistress: 0, assignedResidents: 0, activeFirm: false,
    }),
  });
  assert.equal(domain.get('building:a')!.lifecycleState, 'lease-up');
  system.updateThroughTick(200, {
    buildingContext: (buildingId) => ({
      buildingId, buildingOccupied: true, occupancyUtilization: 0.5, utilityRatio: 1,
      serviceQuality: 1, neighborhoodQuality: 1, marketRentStrength: 1,
      firmDistress: 0, assignedResidents: 10, activeFirm: false,
    }),
  });
  assert.equal(domain.get('building:a')!.lifecycleState, 'stabilized');
});

test('condemned stock retains reduced existing capacity but blocks new placement', () => {
  assert.equal(conditionCapacityMultiplier({ conditionScore: 20, lifecycleState: 'condemned' }), 0.85);
  assert.equal(conditionCapacityMultiplier({ conditionScore: 20, lifecycleState: 'abandoned' }), 0);
  assert.equal(conditionCapacityMultiplier({ conditionScore: 40, lifecycleState: 'neglected' }), 0.85);
  assert.equal(conditionCapacityMultiplier({ conditionScore: 80, lifecycleState: 'renovating' }), 0.5);
});

test('semantic Core advances condition on cadence while legacy mode remains inert', () => {
  const semantic = coreWithOccupiedResidential('semantic');
  const legacy = coreWithOccupiedResidential('legacy');

  semantic.step(99);
  legacy.step(99);
  assert.equal(semantic.urbanFabric.get('building:lot:1,1')!.lastConditionTick, 0);
  assert.equal(legacy.urbanFabric.get('building:lot:1,1')!.lastConditionTick, 0);

  semantic.step(1);
  legacy.step(1);
  const semanticState = semantic.urbanFabric.get('building:lot:1,1')!;
  const legacyState = legacy.urbanFabric.get('building:lot:1,1')!;
  assert.equal(semanticState.lastConditionTick, 100);
  assert.ok(semanticState.conditionScore < 80);
  assert.equal(legacyState.lastConditionTick, 0);
  assert.equal(legacyState.conditionScore, 80);
});
