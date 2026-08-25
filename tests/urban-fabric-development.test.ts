import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentFeasibilitySystem } from '../src/simulation/development/DevelopmentFeasibilitySystem.ts';
import { DeveloperMarketSystem } from '../src/simulation/development/DeveloperMarketSystem.ts';
import type { DevelopmentCandidate } from '../src/simulation/buildings/BuildingTypes.ts';
import type { Parcel } from '../src/world/cadastre/CadastralTypes.ts';
import type { DeveloperSeed, PhysicalDevelopmentContext } from '../src/simulation/development/DevelopmentTypes.ts';

const parcel: Parcel = {
  id: 'parcel:underwriting:1',
  blockId: 'block:underwriting',
  boundaryEdgeIds: ['e0', 'e1', 'e2', 'e3'],
  areaM2: 1_000,
  centroid: { x: 20, y: 12.5 },
  frontageEdgeIds: ['e0'],
  accessEdgeIds: ['e0'],
  zoningDistrictId: 'MU4',
  historicalParentIds: [],
};

const context: PhysicalDevelopmentContext = {
  taxRate: 0.015,
  personAccessibility: 0.9,
  freightAccessibility: 0.7,
  serviceQuality: 0.9,
  neighborhoodQuality: 0.9,
  utilityRatio: 1,
  constructionCostIndex: 1,
  marketInterestRate: 0.05,
  marketVacancyRate: 0.08,
  landValuePerM2: 500,
  marketRentPerM2ByUse: { residential: 320, retail: 450, office: 390 },
  demolitionCost: 0,
  relocationCost: 0,
  sitePreparationCost: 25_000,
  developerLeverage: 0.6,
  financingSpread: 0.02,
};

const physicalDeveloper: DeveloperSeed = {
  id: 'physical-developer',
  availableCapital: 20_000_000,
  hurdleRate: 0.01,
  maxLeverage: 0.5,
  financingSpread: 0.01,
  riskTolerance: 1,
  maxConcurrentProjects: 2,
  minimumProjectCost: 0,
  preferences: { residential: 0.02, commercial: 0.02, industrial: 0 },
};

test('larger legal mixed-use massing changes revenue cost and return from actual floor area', () => {
  const system = new DevelopmentFeasibilitySystem();
  const small = system.evaluateCandidate(candidateFixture(2_000, 1_600), parcel, context);
  const large = system.evaluateCandidate(candidateFixture(4_000, 3_200), parcel, context);

  assert.ok(large.hardConstructionCost > small.hardConstructionCost);
  assert.ok(large.grossPotentialRent > small.grossPotentialRent);
  assert.ok(large.improvementValue > small.improvementValue);
  assert.notEqual(large.returnOnCost, small.returnOnCost);
  assert.equal(large.legal, true);
  assert.equal(large.siteId, parcel.id);
});

test('illegal zoning candidate is rejected before developer bidding', () => {
  const result = new DevelopmentFeasibilitySystem().evaluateCandidate(
    { ...candidateFixture(2_000, 1_600), zoningLegal: false },
    parcel,
    context,
  );

  assert.equal(result.legal, false);
  assert.equal(result.feasible, false);
  assert.ok(result.rejectionReasons.includes('zoning-compliance'));
});

test('physical mixed-use opportunity enters developer market with physical construction duration', () => {
  const feasibility = new DevelopmentFeasibilitySystem().evaluateCandidate(
    candidateFixture(4_000, 3_200),
    parcel,
    context,
  );
  const opportunity = {
    ...feasibility,
    feasible: true,
    rejectionReasons: [],
    stabilizedValue: feasibility.preFinanceDevelopmentCost * 2.5,
    residualLandValue: feasibility.landValue * 2,
    riskScore: 0.1,
  };
  const market = new DeveloperMarketSystem({ developers: [physicalDeveloper] });
  const tick = 100;
  const [award] = market.allocate([opportunity], { tick, marketInterestRate: 0.04 });

  assert.ok(award);
  assert.equal(award.lotId, parcel.id);
  assert.equal(award.definitionId, 'main_street_mixed_use');
  assert.equal(award.completionTick, tick + feasibility.constructionTicks);
  assert.equal(market.listCommitments()[0]?.lotId, parcel.id);
});

function candidateFixture(grossFloorAreaM2: number, usableFloorAreaM2: number): DevelopmentCandidate {
  const residentialArea = usableFloorAreaM2 * 0.75;
  const retailArea = usableFloorAreaM2 - residentialArea;
  return {
    id: `candidate:test:${grossFloorAreaM2}`,
    parcelIds: [parcel.id],
    typologyId: 'main_street_mixed_use',
    targetUtilization: grossFloorAreaM2 / 4_000,
    footprint: [
      { x: 5, y: 5 },
      { x: 25, y: 5 },
      { x: 25, y: 20 },
      { x: 5, y: 20 },
    ],
    grossFloorAreaM2,
    usableFloorAreaM2,
    heightMeters: grossFloorAreaM2 <= 2_000 ? 12.8 : 25.6,
    stories: grossFloorAreaM2 <= 2_000 ? 4 : 8,
    realizedFAR: grossFloorAreaM2 / parcel.areaM2,
    coverageRatio: 0.3,
    floors: [
      {
        level: 1,
        elevationMeters: 0,
        grossAreaM2: grossFloorAreaM2,
        usableAreaM2: usableFloorAreaM2,
        uses: [
          { use: 'residential', floorAreaM2: residentialArea },
          { use: 'retail', floorAreaM2: retailArea },
        ],
      },
    ],
    uses: ['residential', 'retail'],
    zoningLegal: true,
  };
}