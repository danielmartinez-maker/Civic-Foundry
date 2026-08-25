import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RenovationSystem,
  type RenovationMarketContext,
} from '../src/simulation/buildings/RenovationSystem.ts';
import {
  NEW_BUILDING_LIFECYCLE,
  type BuildingLifecycleState,
  type BuildingV2,
} from '../src/simulation/buildings/BuildingTypes.ts';
import { getBuildingTypology } from '../src/data/buildingTypologies.ts';
import type { ParcelDevelopmentEnvelope } from '../src/simulation/zoning/ZoningTypes.ts';

const renovation = new RenovationSystem();
const typology = getBuildingTypology('main_street_mixed_use');

test('major renovation improves condition and lowers effective age when return clears hurdle', () => {
  const building = buildingFixture({
    lifecycle: lifecycleFixture({ condition: 42, structuralCondition: 55, systemsCondition: 38, exteriorCondition: 35, effectiveAge: 35 }),
  });
  const proposal = renovation.propose(building, typology, marketFixture(), 'major');

  assert.equal(proposal.scope, 'major');
  assert.equal(proposal.feasible, true);
  assert.ok(proposal.projectedCondition >= 75);
  assert.ok(proposal.projectedEffectiveAge < 35);
  assert.ok(proposal.cost > 0);
  assert.ok(proposal.expectedReturn >= marketFixture().hurdleRate);
  assert.equal(proposal.requiresVacancy, true);
});

test('adaptive reuse rejects a destination use prohibited by zoning', () => {
  const result = renovation.evaluateAdaptiveReuse(
    buildingFixture(),
    'residential',
    envelopeFixture({ permittedUses: ['office'] }),
    marketFixture(),
  );

  assert.equal(result.feasible, false);
  assert.ok(result.rejectionReasons.includes('destination-use-prohibited'));
});

test('major renovation requires relocation completion and finishes deterministically', () => {
  const building = buildingFixture({
    lifecycle: lifecycleFixture({ condition: 48, effectiveAge: 30, maintenanceBacklog: 50_000 }),
  });
  const proposal = renovation.propose(building, typology, marketFixture(), 'major');

  assert.throws(
    () => renovation.start(building, proposal, 100, false),
    /relocation/i,
  );

  const started = renovation.start(building, proposal, 100, true);
  assert.equal(started.status, 'renovation');
  assert.equal(started.project?.phase, 'fit-out');
  assert.equal(started.project?.completionTick, 155);
  assert.equal(started.lifecycle.condition, building.lifecycle.condition);

  const completed = renovation.tick(started, 155);
  assert.equal(completed.status, 'occupied');
  assert.equal(completed.project?.phase, 'none');
  assert.ok(completed.lifecycle.condition >= proposal.projectedCondition);
  assert.ok(completed.lifecycle.effectiveAge <= proposal.projectedEffectiveAge);
  assert.equal(completed.lifecycle.maintenanceBacklog, 0);
  assert.equal(completed.lifecycle.lastMajorRenovationTick, 155);
});

function marketFixture(overrides: Partial<RenovationMarketContext> = {}): RenovationMarketContext {
  return {
    currentPropertyValue: 2_000_000,
    projectedPropertyValue: 5_500_000,
    hurdleRate: 0.12,
    financingRate: 0.06,
    ...overrides,
  };
}

function envelopeFixture(overrides: Partial<ParcelDevelopmentEnvelope> = {}): ParcelDevelopmentEnvelope {
  return {
    parcelId: 'parcel:renovation:1',
    districtId: 'MU4',
    buildableFootprint: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    parcelAreaM2: 1_000,
    frontageMeters: 20,
    maxFootprintAreaM2: 600,
    maxGrossFloorAreaM2: 4_000,
    maxHeightMeters: 30,
    maxStories: 8,
    allowedFAR: 4,
    effectiveFAR: 4,
    effectiveCoverageRatio: 0.6,
    permittedUses: ['residential', 'retail', 'office'],
    limitingConstraints: [],
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
    id: 'building:renovation:1',
    parcelIds: ['parcel:renovation:1'],
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