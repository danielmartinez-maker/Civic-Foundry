import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_VARIANTS } from '../src/data/buildings.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { UrbanFabricDomain } from '../src/simulation/urban/UrbanFabricDomain.ts';
import { buildUrbanBuildingView, urbanBusinessSiteFromView } from '../src/simulation/urban/UrbanBuildingView.ts';
import { RenovationSystem } from '../src/simulation/urban/RenovationSystem.ts';
import type { Building } from '../src/simulation/buildings/BuildingSystem.ts';
import type { UrbanBuildingState, RenovationCommitment } from '../src/simulation/urban/UrbanTypes.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';

const building: Building = Object.freeze({
  id: 'building:a',
  lotId: 'lot:a',
  x: 2,
  y: 3,
  zone: 'residential',
  definitionId: 'residential_rowhouse',
  status: 'occupied',
  constructionStartedTick: 0,
  completionTick: 70,
});

function urbanState(overrides: Partial<UrbanBuildingState> = {}): UrbanBuildingState {
  return {
    buildingId: building.id,
    useComponents: [{
      use: 'residential',
      areaShareBps: 10_000,
      residentCapacity: 28,
      jobCapacity: 0,
      taxBase: 250,
    }],
    qualityTier: 'standard',
    conditionScore: 55,
    lifecycleState: 'aging',
    conditionEstablishedTick: 0,
    lastConditionTick: 500,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 6 },
    ...overrides,
  };
}

function harness(overrides: Partial<UrbanBuildingState> = {}) {
  const domain = new UrbanFabricDomain();
  domain.install(urbanState(overrides));
  return { domain, renovation: new RenovationSystem(domain) };
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

function semanticCoreWithBuilding(
  zone: 'residential' | 'commercial',
  definitionId: 'residential_rowhouse' | 'commercial_shop',
): Readonly<{ core: SimulationCore; buildingId: string }> {
  const core = new SimulationCore({
    terrain: flatTerrain(),
    startingFunds: 250_000,
    seed: 73,
    urbanDevelopmentMode: 'semantic',
  });
  assert.equal(core.buildRoad([{ x: 1, y: 2 }, { x: 2, y: 2 }], 'local').ok, true);
  assert.equal(core.paintZone([{ x: 1, y: 1 }], zone).painted, 1);
  const lot = core.lots.list().find((item) => item.id === 'lot:1,1');
  assert.ok(lot);
  const buildingId = `building:${lot.id}`;
  core.buildings.restore([{
    id: buildingId,
    lotId: lot.id,
    x: lot.x,
    y: lot.y,
    zone,
    definitionId,
    status: 'occupied',
    constructionStartedTick: 0,
    completionTick: 0,
  }]);
  core.urbanFabric.install({
    buildingId,
    useComponents: zone === 'residential'
      ? [{ use: 'residential', areaShareBps: 10_000, residentCapacity: 28, jobCapacity: 0, taxBase: 250 }]
      : [{ use: 'commercial', areaShareBps: 10_000, residentCapacity: 0, jobCapacity: 8, taxBase: 220 }],
    qualityTier: 'standard',
    conditionScore: 55,
    lifecycleState: 'aging',
    conditionEstablishedTick: 0,
    lastConditionTick: 0,
    renovationCount: 0,
    parking: { profile: 'standard', spaces: 4 },
  });
  return { core, buildingId };
}

function startCoreRenovation(core: SimulationCore, buildingId: string): RenovationCommitment {
  const start = Reflect.get(core, 'startRenovation');
  assert.equal(typeof start, 'function', 'SimulationCore must expose startRenovation');
  return Reflect.apply(start as (...args: unknown[]) => RenovationCommitment, core, [buildingId, 'local_builder']);
}

test('renovation halves capacity and restores condition without changing structural semantics', () => {
  const { domain, renovation } = harness();
  const before = domain.get(building.id)!;
  const definition = BUILDING_VARIANTS.residential[1]!;

  const job = renovation.start({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 500,
    definition,
  });

  assert.ok(job.cost > 0);
  assert.ok(job.completionTick > job.startTick);
  assert.equal(job.targetCondition, 90);
  assert.equal(domain.get(building.id)!.lifecycleState, 'renovating');
  assert.equal(buildUrbanBuildingView(building, domain.get(building.id)!).conditionCapacityMultiplier, 0.5);
  assert.equal(renovation.hasActive(building.id), true);
  assert.throws(() => renovation.start({
    buildingId: building.id,
    developerId: 'developer:2',
    startTick: 501,
    definition,
  }), /renovation|commitment|active/i);

  renovation.tick(job.completionTick - 1);
  assert.equal(domain.get(building.id)!.lifecycleState, 'renovating');
  renovation.tick(job.completionTick);

  const after = domain.get(building.id)!;
  assert.equal(after.conditionScore, 90);
  assert.equal(after.renovationCount, 1);
  assert.equal(after.lifecycleState, 'lease-up');
  assert.equal(renovation.hasActive(building.id), false);
  assert.deepEqual(after.useComponents, before.useComponents);
  assert.equal(after.qualityTier, before.qualityTier);
  assert.deepEqual(after.parking, before.parking);
});

test('renovation cost and duration rise with quality or complexity', () => {
  const standard = harness();
  const premium = harness({ qualityTier: 'premium' });
  const lowDefinition = BUILDING_VARIANTS.residential[0]!;
  const highDefinition = BUILDING_VARIANTS.residential[2]!;

  const standardLow = standard.renovation.evaluateCandidate({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 1_000,
    definition: lowDefinition,
  });
  const premiumHigh = premium.renovation.evaluateCandidate({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 1_000,
    definition: highDefinition,
  });

  assert.ok(premiumHigh.cost > standardLow.cost);
  assert.ok(premiumHigh.completionTick > standardLow.completionTick);
});

test('renovation snapshot restore preserves deterministic continuation', () => {
  const first = harness();
  const definition = BUILDING_VARIANTS.residential[1]!;
  const job = first.renovation.start({
    buildingId: building.id,
    developerId: 'developer:1',
    startTick: 800,
    definition,
  });
  const snapshot = first.renovation.snapshotState();

  const restoredDomain = new UrbanFabricDomain();
  restoredDomain.restoreState(first.domain.snapshotState());
  const restored = new RenovationSystem(restoredDomain);
  restored.restoreState(snapshot);

  first.renovation.tick(job.completionTick);
  restored.tick(job.completionTick);
  assert.deepEqual(restored.snapshotState(), first.renovation.snapshotState());
  assert.deepEqual(restoredDomain.snapshotState(), first.domain.snapshotState());
});

test('Core renovation immediately reconciles residential overflow and completes on Core time', () => {
  const { core, buildingId } = semanticCoreWithBuilding('residential', 'residential_rowhouse');
  core.population.restore(28);
  core.restoreHousingState();
  assert.equal(core.housingRelocationSnapshot.housedResidents, 28);
  assert.equal(core.housingRelocationSnapshot.unplacedResidents, 0);

  const job = startCoreRenovation(core, buildingId);
  assert.equal(core.urbanBuildingView(buildingId)!.residentialCapacity, 14);
  assert.equal(core.housingRelocationSnapshot.housedResidents, 14);
  assert.equal(core.housingRelocationSnapshot.unplacedResidents, 14);
  assert.equal(core.renovation.hasActive(buildingId), true);

  core.step(job.completionTick - core.clock.tick);
  assert.equal(core.renovation.hasActive(buildingId), false);
  assert.equal(core.urbanFabric.get(buildingId)!.conditionScore, 90);
  assert.equal(core.urbanFabric.get(buildingId)!.renovationCount, 1);
  assert.equal(core.urbanFabric.get(buildingId)!.lifecycleState, 'lease-up');
});

test('Core renovation immediately caps firm jobs to reduced semantic capacity', () => {
  const { core, buildingId } = semanticCoreWithBuilding('commercial', 'commercial_shop');
  core.population.restore(20);
  const site = urbanBusinessSiteFromView(core.urbanBuildingView(buildingId)!);
  core.economyDomain.firms.syncEligibleSites([site], core.clock.tick);
  const before = core.economyDomain.getFirmAtBuilding(buildingId);
  assert.ok(before);
  core.economyDomain.firms.update(before.id, { status: 'operating', filledJobs: 8, vacancies: 0 });

  startCoreRenovation(core, buildingId);

  const after = core.economyDomain.getFirmAtBuilding(buildingId);
  assert.ok(after);
  assert.equal(core.urbanBuildingView(buildingId)!.jobCapacity, 4);
  assert.equal(after.jobCapacity, 4);
  assert.equal(after.filledJobs, 4);
  assert.equal(core.employmentSnapshot.totalJobs, 4);
  assert.equal(core.employmentSnapshot.employed, 4);
});

test('Core renovation conflicts with redevelopment commitments and bulldoze cleans it up', () => {
  const locked = semanticCoreWithBuilding('residential', 'residential_rowhouse');
  const awards = locked.core.developerMarket.allocate([{
    lotId: 'lot:1,1', definitionId: 'residential_apartment', zone: 'residential', legal: true, feasible: true,
    landValue: 12_000, accessScore: 0.85, achievableRent: 800, rentableCapacity: 72,
    grossPotentialRent: 8_000, vacancyRate: 0.08, effectiveGrossIncome: 7_360,
    operatingExpenses: 2_000, propertyTaxes: 12, netOperatingIncome: 20_000,
    hardConstructionCost: 30_000, softCosts: 4_000, sitePreparationCost: 0,
    preFinanceDevelopmentCost: 50_000, marketFinancingCost: 1_000, totalDevelopmentCost: 51_000,
    capRate: 0.065, stabilizedValue: 150_000, yieldOnCost: 0.39, returnOnCost: 1.94,
    residualLandValue: 80_000, riskScore: 0.25, rejectionReasons: [],
  }], { tick: 10, marketInterestRate: 0.04 });
  assert.equal(awards.length, 1);
  const lockedStart = Reflect.get(locked.core, 'startRenovation');
  assert.equal(typeof lockedStart, 'function', 'SimulationCore must expose startRenovation');
  assert.throws(
    () => Reflect.apply(lockedStart as (...args: unknown[]) => RenovationCommitment, locked.core, [locked.buildingId, 'local_builder']),
    /renovation|redevelopment|commitment/i,
  );

  const active = semanticCoreWithBuilding('residential', 'residential_rowhouse');
  startCoreRenovation(active.core, active.buildingId);
  assert.equal(active.core.renovation.hasActive(active.buildingId), true);
  assert.equal(active.core.bulldozeAt(1, 1).ok, true);
  assert.equal(active.core.renovation.hasActive(active.buildingId), false);
  assert.equal(active.core.urbanFabric.get(active.buildingId), undefined);
});
