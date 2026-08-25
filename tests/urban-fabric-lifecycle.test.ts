import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BuildingLifecycleSystem,
  conditionRentFactor,
  requiredMaintenanceCost,
  type BuildingLifecycleInput,
} from '../src/simulation/buildings/BuildingLifecycleSystem.ts';
import {
  NEW_BUILDING_LIFECYCLE,
  type BuildingLifecycleState,
  type BuildingV2,
} from '../src/simulation/buildings/BuildingTypes.ts';
import { getBuildingTypology } from '../src/data/buildingTypologies.ts';

const typology = getBuildingTypology('main_street_mixed_use');

test('adequate maintenance slows deterioration and backlog growth', () => {
  const lifecycle = new BuildingLifecycleSystem();
  const building = buildingFixture({
    lifecycle: lifecycleFixture({ ageTicks: 2_500, effectiveAge: 10, condition: 78, maintenanceBacklog: 12_000 }),
  });
  const required = requiredMaintenanceCost(building, typology);
  const neglected = lifecycle.tick(building, typology, lifecycleInput({ maintenanceSpend: 0 }));
  const maintained = lifecycle.tick(building, typology, lifecycleInput({ maintenanceSpend: required }));

  assert.ok(maintained.condition > neglected.condition);
  assert.ok(maintained.maintenanceBacklog < neglected.maintenanceBacklog);
  assert.ok(maintained.deferredMaintenanceTicks < neglected.deferredMaintenanceTicks);
});

test('chronic vacancy raises distress deterministically relative to occupied stock', () => {
  const lifecycle = new BuildingLifecycleSystem();
  let vacant = lifecycleFixture({ ageTicks: 1_000, effectiveAge: 4, condition: 82 });
  let occupied = vacant;

  for (let cycle = 0; cycle < 12; cycle += 1) {
    const vacantBuilding = buildingFixture({ lifecycle: vacant });
    const occupiedBuilding = buildingFixture({ lifecycle: occupied });
    vacant = lifecycle.tick(
      vacantBuilding,
      typology,
      lifecycleInput({ maintenanceSpend: requiredMaintenanceCost(vacantBuilding, typology), occupancyRatio: 0.05 }),
    );
    occupied = lifecycle.tick(
      occupiedBuilding,
      typology,
      lifecycleInput({ maintenanceSpend: requiredMaintenanceCost(occupiedBuilding, typology), occupancyRatio: 0.95 }),
    );
  }

  assert.ok(vacant.vacancyDurationTicks > occupied.vacancyDurationTicks);
  assert.ok(vacant.distressScore > occupied.distressScore);
  assert.ok(vacant.condition < occupied.condition);
});

test('required maintenance rises with effective age and building complexity', () => {
  const young = buildingFixture({ lifecycle: lifecycleFixture({ effectiveAge: 2 }) });
  const old = buildingFixture({ lifecycle: lifecycleFixture({ effectiveAge: 45 }) });
  const simpleTypology = { ...typology, complexityFactor: 0.8 };
  const complexTypology = { ...typology, complexityFactor: 1.4 };

  assert.ok(requiredMaintenanceCost(old, typology) > requiredMaintenanceCost(young, typology));
  assert.ok(requiredMaintenanceCost(young, complexTypology) > requiredMaintenanceCost(young, simpleTypology));
});

test('condition rent factor is bounded and materially penalizes distressed buildings', () => {
  assert.equal(conditionRentFactor(100), 1);
  assert.ok(conditionRentFactor(34) < conditionRentFactor(60));
  assert.ok(conditionRentFactor(19) < conditionRentFactor(34));
  assert.ok(conditionRentFactor(0) >= 0);
  assert.ok(conditionRentFactor(100) <= 1);
});

function lifecycleInput(overrides: Partial<BuildingLifecycleInput> = {}): BuildingLifecycleInput {
  return {
    maintenanceSpend: 0,
    occupancyRatio: 0.90,
    utilizationRatio: 0.75,
    environmentalStress: 0.10,
    serviceStress: 0.10,
    cadenceTicks: 25,
    ...overrides,
  };
}

function lifecycleFixture(overrides: Partial<BuildingLifecycleState> = {}): BuildingLifecycleState {
  return {
    ...NEW_BUILDING_LIFECYCLE,
    ...overrides,
  };
}

function buildingFixture(overrides: Partial<BuildingV2> = {}): BuildingV2 {
  return {
    id: 'building:lifecycle:1',
    parcelIds: ['parcel:lifecycle:1'],
    typologyId: typology.id,
    footprint: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    grossFloorAreaM2: 4_000,
    usableFloorAreaM2: 3_200,
    heightMeters: 16,
    stories: 5,
    realizedFAR: 4,
    coverageRatio: 0.4,
    floors: [],
    status: 'occupied',
    yearBuilt: 0,
    projectCost: 2_500_000,
    entitlement: {
      approvalTick: 0,
      zoningDistrictId: 'MU4',
      approvedFAR: 4,
      approvedHeightMeters: 20,
      approvedUses: ['residential', 'retail'],
    },
    lifecycle: lifecycleFixture(),
    ...overrides,
  };
}