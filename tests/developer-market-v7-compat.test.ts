import test from 'node:test';
import assert from 'node:assert/strict';
import { DeveloperMarketSystem } from '../src/simulation/development/DeveloperMarketSystem.ts';
import type { DevelopmentFeasibilityResult, DeveloperSeed } from '../src/simulation/development/DevelopmentTypes.ts';

const developer: DeveloperSeed = {
  id: 'semantic-builder',
  availableCapital: 200_000,
  hurdleRate: 0.05,
  maxLeverage: 0,
  financingSpread: 0,
  riskTolerance: 1,
  maxConcurrentProjects: 2,
  minimumProjectCost: 0,
  preferences: { residential: 0, commercial: 0, industrial: 0 },
};

const semanticOpportunity: DevelopmentFeasibilityResult = {
  lotId: 'lot:semantic',
  definitionId: 'residential_rowhouse',
  zone: 'residential',
  legal: true,
  feasible: true,
  landValue: 12_000,
  accessScore: 0.9,
  achievableRent: 1_000,
  rentableCapacity: 30,
  grossPotentialRent: 30_000,
  vacancyRate: 0.05,
  effectiveGrossIncome: 28_500,
  operatingExpenses: 5_000,
  propertyTaxes: 100,
  netOperatingIncome: 23_400,
  hardConstructionCost: 40_000,
  parkingCost: 18_000,
  softCosts: 6_000,
  sitePreparationCost: 0,
  preFinanceDevelopmentCost: 80_000,
  marketFinancingCost: 0,
  totalDevelopmentCost: 80_000,
  capRate: 0.06,
  stabilizedValue: 150_000,
  yieldOnCost: 0.2925,
  returnOnCost: 0.875,
  residualLandValue: 60_000,
  riskScore: 0.2,
  rejectionReasons: [],
  qualityTier: 'premium',
  parkingProfile: 'standard',
  parkingSpaces: 6,
  useMixKey: 'residential_rowhouse|residential:10000:30:0:320',
};

test('V7 developer snapshots strip B1 semantic commitment fields while live commitments retain them', () => {
  const market = new DeveloperMarketSystem({ developers: [developer] });
  const [award] = market.allocate([semanticOpportunity], { tick: 20, marketInterestRate: 0.04 });
  assert.ok(award);

  const live = market.listCommitments()[0]!;
  assert.equal(live.qualityTier, 'premium');
  assert.equal(live.parkingProfile, 'standard');
  assert.equal(live.parkingSpaces, 6);
  assert.equal(live.useMixKey, semanticOpportunity.useMixKey);

  const persisted = market.snapshotState().commitments[0]! as unknown as Record<string, unknown>;
  assert.equal('qualityTier' in persisted, false);
  assert.equal('parkingProfile' in persisted, false);
  assert.equal('parkingSpaces' in persisted, false);
  assert.equal('useMixKey' in persisted, false);

  const restored = new DeveloperMarketSystem({ developers: [developer] });
  restored.restoreState(market.snapshotState());
  const restoredLive = restored.listCommitments()[0]!;
  assert.equal(restoredLive.qualityTier, 'standard');
  assert.equal(restoredLive.parkingProfile, 'legacy-none');
  assert.equal(restoredLive.parkingSpaces, 0);
  assert.equal(restoredLive.useMixKey, restoredLive.definitionId);
});
