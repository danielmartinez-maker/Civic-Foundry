import test from 'node:test';
import assert from 'node:assert/strict';
import type {
  DevelopmentFeasibilityResult,
  DeveloperSeed,
} from '../src/simulation/development/DevelopmentTypes.ts';

function opportunity(overrides: Partial<DevelopmentFeasibilityResult> = {}): DevelopmentFeasibilityResult {
  return {
    lotId: 'lot:1,1',
    definitionId: 'residential_cottage',
    zone: 'residential',
    legal: true,
    feasible: true,
    landValue: 12_000,
    accessScore: 0.85,
    achievableRent: 800,
    rentableCapacity: 10,
    grossPotentialRent: 8_000,
    vacancyRate: 0.08,
    effectiveGrossIncome: 7_360,
    operatingExpenses: 2_000,
    propertyTaxes: 12,
    netOperatingIncome: 5_348,
    hardConstructionCost: 30_000,
    softCosts: 4_000,
    sitePreparationCost: 0,
    preFinanceDevelopmentCost: 50_000,
    marketFinancingCost: 1_000,
    totalDevelopmentCost: 51_000,
    capRate: 0.065,
    stabilizedValue: 90_000,
    yieldOnCost: 0.105,
    returnOnCost: 0.76,
    residualLandValue: 40_000,
    riskScore: 0.25,
    rejectionReasons: [],
    ...overrides,
  };
}

function developer(overrides: Partial<DeveloperSeed> = {}): DeveloperSeed {
  return {
    id: 'solo',
    availableCapital: 100_000,
    hurdleRate: 0.05,
    maxLeverage: 0,
    financingSpread: 0,
    riskTolerance: 1,
    maxConcurrentProjects: 3,
    minimumProjectCost: 0,
    preferences: { residential: 0, commercial: 0, industrial: 0 },
    ...overrides,
  };
}

async function marketModule() {
  return import('../src/simulation/development/DeveloperMarketSystem.ts');
}

test('developer hurdles preferences and financing produce differentiated bid ranks', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem();
  market.allocate([
    opportunity({ lotId: 'lot:r', definitionId: 'residential_rowhouse', zone: 'residential', preFinanceDevelopmentCost: 90_000, stabilizedValue: 150_000, residualLandValue: 55_000, riskScore: 0.30 }),
    opportunity({ lotId: 'lot:i', definitionId: 'industrial_warehouse', zone: 'industrial', preFinanceDevelopmentCost: 170_000, stabilizedValue: 290_000, residualLandValue: 95_000, riskScore: 0.35 }),
  ], { tick: 10, marketInterestRate: 0.05 });

  const bids = market.lastBids();
  const localResidential = bids.find((bid) => bid.lotId === 'lot:r' && bid.developerId === 'local_builder');
  const industrialResidential = bids.find((bid) => bid.lotId === 'lot:r' && bid.developerId === 'industrial_specialist');
  const localIndustrial = bids.find((bid) => bid.lotId === 'lot:i' && bid.developerId === 'local_builder');
  const specialistIndustrial = bids.find((bid) => bid.lotId === 'lot:i' && bid.developerId === 'industrial_specialist');
  assert.ok(localResidential && industrialResidential && localIndustrial && specialistIndustrial);
  assert.ok(localResidential.preferenceBonus > industrialResidential.preferenceBonus);
  assert.ok(specialistIndustrial.preferenceBonus > localIndustrial.preferenceBonus);
  assert.notEqual(localResidential.rankScore, industrialResidential.rankScore);
});

test('projects below a developer hurdle receive no bid', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({ developers: [developer({ hurdleRate: 0.20 })] });
  const awards = market.allocate([
    opportunity({ preFinanceDevelopmentCost: 50_000, stabilizedValue: 55_000, returnOnCost: 0.10 }),
  ], { tick: 10, marketInterestRate: 0.05 });
  assert.equal(awards.length, 0);
  assert.equal(market.lastBids().length, 0);
});

test('insufficient capital and concurrent project limits prevent unlimited awards', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({
    developers: [developer({ availableCapital: 50_000, maxConcurrentProjects: 1 })],
  });
  const awards = market.allocate([
    opportunity({ lotId: 'lot:a', preFinanceDevelopmentCost: 30_000, stabilizedValue: 60_000 }),
    opportunity({ lotId: 'lot:b', preFinanceDevelopmentCost: 30_000, stabilizedValue: 59_000 }),
  ], { tick: 20, marketInterestRate: 0.03 });
  assert.equal(awards.length, 1);
  assert.ok(market.listDevelopers()[0]!.availableCapital >= 0);
  assert.equal(market.listCommitments().length, 1);
});

test('same opportunity set yields one stable winner and identical state', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const first = new DeveloperMarketSystem();
  const second = new DeveloperMarketSystem();
  const input = [opportunity({ lotId: 'lot:stable', stabilizedValue: 100_000 })];
  assert.deepEqual(
    first.allocate(input, { tick: 30, marketInterestRate: 0.05 }),
    second.allocate(input, { tick: 30, marketInterestRate: 0.05 }),
  );
  assert.deepEqual(first.snapshotState(), second.snapshotState());
  assert.equal(first.lastAwards().length, 1);
});

test('global allocation rechecks developer capital after every award', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({
    developers: [developer({ availableCapital: 50_000, maxConcurrentProjects: 3 })],
  });
  const awards = market.allocate([
    opportunity({ lotId: 'lot:a', preFinanceDevelopmentCost: 30_000, stabilizedValue: 70_000 }),
    opportunity({ lotId: 'lot:b', preFinanceDevelopmentCost: 30_000, stabilizedValue: 69_000 }),
  ], { tick: 40, marketInterestRate: 0.03 });
  assert.equal(awards.length, 1);
  assert.equal(market.listDevelopers()[0]!.availableCapital, 20_000);
});

test('an active building commitment cannot be overwritten by a second award for the same lot', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({ developers: [developer({ availableCapital: 150_000 })] });
  const [firstAward] = market.allocate([
    opportunity({ lotId: 'lot:locked', preFinanceDevelopmentCost: 40_000, stabilizedValue: 80_000 }),
  ], { tick: 45, marketInterestRate: 0.04 });
  assert.ok(firstAward);
  const firstCommitment = market.listCommitments()[0]!;
  const capitalAfterFirst = market.listDevelopers()[0]!;

  const secondAwards = market.allocate([
    opportunity({ lotId: 'lot:locked', definitionId: 'residential_rowhouse', preFinanceDevelopmentCost: 50_000, stabilizedValue: 100_000 }),
  ], { tick: 55, marketInterestRate: 0.04 });

  assert.equal(secondAwards.length, 0);
  assert.deepEqual(market.listCommitments(), [firstCommitment]);
  assert.deepEqual(market.listDevelopers()[0], capitalAfterFirst);
});

test('committed equity recycles after stabilization with bounded realized return', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({ developers: [developer()] });
  const [award] = market.allocate([
    opportunity({ lotId: 'lot:recycle', preFinanceDevelopmentCost: 40_000, stabilizedValue: 60_000 }),
  ], { tick: 50, marketInterestRate: 0.04 });
  assert.ok(award);
  const afterAward = market.listDevelopers()[0]!;
  assert.equal(afterAward.availableCapital, 60_000);
  assert.equal(afterAward.committedCapital, 40_000);
  market.advance(award.releaseTick - 1);
  assert.equal(market.listCommitments().length, 1);
  market.advance(award.releaseTick);
  assert.equal(market.listCommitments().length, 0);
  assert.equal(market.listDevelopers()[0]!.committedCapital, 0);
  assert.ok(market.listDevelopers()[0]!.availableCapital > 100_000);
});

test('cancelling construction recovers a deterministic fraction of equity', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const market = new DeveloperMarketSystem({ developers: [developer()] });
  const [award] = market.allocate([
    opportunity({ lotId: 'lot:cancel', preFinanceDevelopmentCost: 40_000, stabilizedValue: 60_000 }),
  ], { tick: 60, marketInterestRate: 0.04 });
  assert.ok(award);
  assert.equal(market.cancelProject(award.buildingId, 0.5), true);
  assert.equal(market.listCommitments().length, 0);
  assert.equal(market.listDevelopers()[0]!.availableCapital, 80_000);
  assert.equal(market.listDevelopers()[0]!.committedCapital, 0);
});

test('developer state snapshot restores exactly and rejects inconsistent capital', async () => {
  const { DeveloperMarketSystem } = await marketModule();
  const original = new DeveloperMarketSystem({ developers: [developer()] });
  original.allocate([
    opportunity({ lotId: 'lot:save', preFinanceDevelopmentCost: 35_000, stabilizedValue: 70_000 }),
  ], { tick: 70, marketInterestRate: 0.04 });
  const snapshot = original.snapshotState();
  const restored = new DeveloperMarketSystem({ developers: [developer()] });
  restored.restoreState(snapshot);
  assert.deepEqual(restored.snapshotState(), snapshot);

  const invalid = structuredClone(snapshot) as unknown as {
    developers: Array<{ availableCapital: number }>;
  };
  invalid.developers[0]!.availableCapital = -1;
  assert.throws(() => restored.restoreState(invalid as never), /availableCapital/);
});
