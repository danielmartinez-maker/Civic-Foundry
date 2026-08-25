import test from 'node:test';
import assert from 'node:assert/strict';
import { getBuildingDefinition } from '../src/data/buildings.ts';
import { QUALITY_PROFILES } from '../src/data/urbanFabric.ts';
import { DevelopmentFeasibilitySystem } from '../src/simulation/development/DevelopmentFeasibilitySystem.ts';
import type { DevelopmentParcelContext } from '../src/simulation/development/DevelopmentTypes.ts';
import {
  baselineParkingSpacesForDefinition,
  enumerateUrbanCandidates,
  parkingSpacesForProfile,
} from '../src/simulation/urban/UrbanDevelopmentCandidate.ts';
import type { Lot } from '../src/world/lots/LotSystem.ts';

const lot: Lot = { id: 'lot:urban', x: 2, y: 2, zone: 'commercial', frontageRoadKey: '2,1' };

function context(personAccessibility = 0.85): DevelopmentParcelContext {
  return {
    demand: 0.8,
    taxRate: 0.10,
    personAccessibility,
    freightAccessibility: 0.75,
    serviceQuality: 0.9,
    neighborhoodQuality: 0.85,
    utilityRatio: 1,
    constructionCostIndex: 1,
    marketInterestRate: 0.05,
    zoningMaxIntensity: 'high',
    marketPressure: 0.8,
    marketRentMultiplier: 1,
    marketVacancyRate: 0.10,
    landValueMultiplier: 1,
    marketByUse: {
      residential: { demand: 0.7, taxRate: 0.10, marketRentMultiplier: 0.95, marketVacancyRate: 0.08 },
      commercial: { demand: 0.9, taxRate: 0.12, marketRentMultiplier: 1.15, marketVacancyRate: 0.09 },
      industrial: { demand: 0.5, taxRate: 0.11, marketRentMultiplier: 1.00, marketVacancyRate: 0.12 },
    },
  };
}

test('semantic candidate order is insertion-order independent and excludes migration-only parking', () => {
  const definitions = [
    getBuildingDefinition('commercial_mixed_tower'),
    getBuildingDefinition('commercial_block'),
  ];
  const forward = enumerateUrbanCandidates(definitions);
  const reverse = enumerateUrbanCandidates(definitions.slice().reverse());
  assert.deepEqual(forward, reverse);
  assert.ok(forward.length > 0);
  assert.ok(forward.every((candidate) => candidate.parkingProfile !== 'legacy-none'));
  assert.deepEqual(
    forward.map((candidate) => [candidate.definitionId, candidate.qualityTier, candidate.parkingProfile]),
    forward.map((candidate) => [candidate.definitionId, candidate.qualityTier, candidate.parkingProfile]).slice().sort((a, b) =>
      String(a[0]).localeCompare(String(b[0]))
      || ['economy', 'standard', 'premium', 'luxury'].indexOf(String(a[1])) - ['economy', 'standard', 'premium', 'luxury'].indexOf(String(b[1]))
      || ['reduced', 'standard', 'abundant', 'structured'].indexOf(String(a[2])) - ['reduced', 'standard', 'abundant', 'structured'].indexOf(String(b[2])),
    ),
  );
});

test('quality construction cost multipliers are strictly monotonic', () => {
  assert.ok(QUALITY_PROFILES.economy.hardConstructionCost < QUALITY_PROFILES.standard.hardConstructionCost);
  assert.ok(QUALITY_PROFILES.standard.hardConstructionCost < QUALITY_PROFILES.premium.hardConstructionCost);
  assert.ok(QUALITY_PROFILES.premium.hardConstructionCost < QUALITY_PROFILES.luxury.hardConstructionCost);
});

test('parking baseline and profile spaces are deterministic from actual component capacity', () => {
  assert.equal(baselineParkingSpacesForDefinition('commercial_mixed_block'), 9);
  assert.equal(parkingSpacesForProfile('commercial_mixed_block', 'reduced'), 5);
  assert.equal(parkingSpacesForProfile('commercial_mixed_block', 'standard'), 9);
  assert.equal(parkingSpacesForProfile('commercial_mixed_block', 'abundant'), 14);
  assert.equal(parkingSpacesForProfile('commercial_mixed_block', 'structured'), 9);
});

test('quality and parking change real underwriting while carrying the semantic tuple', () => {
  const system = new DevelopmentFeasibilitySystem();
  const candidates = enumerateUrbanCandidates([getBuildingDefinition('commercial_mixed_block')]);
  const evaluations = system.evaluateUrbanCandidates(lot, candidates, context());
  const find = (quality: 'economy' | 'standard' | 'premium' | 'luxury', parking: 'reduced' | 'standard' | 'abundant' | 'structured') => {
    const result = evaluations.find((item) => item.qualityTier === quality && item.parkingProfile === parking);
    assert.ok(result);
    return result;
  };
  const economy = find('economy', 'standard');
  const standard = find('standard', 'standard');
  const premium = find('premium', 'standard');
  const luxury = find('luxury', 'standard');
  assert.ok(economy.hardConstructionCost < standard.hardConstructionCost);
  assert.ok(standard.hardConstructionCost < premium.hardConstructionCost);
  assert.ok(premium.hardConstructionCost < luxury.hardConstructionCost);
  assert.ok(find('standard', 'structured').parkingCost > standard.parkingCost);
  assert.equal(standard.parkingSpaces, 9);
  assert.equal(standard.useMixKey.includes('commercial_mixed_block'), true);
});

test('reduced parking rent penalty applies only when person accessibility is weak', () => {
  const system = new DevelopmentFeasibilitySystem();
  const candidates = enumerateUrbanCandidates([getBuildingDefinition('commercial_mixed_block')])
    .filter((item) => item.qualityTier === 'standard' && (item.parkingProfile === 'reduced' || item.parkingProfile === 'standard'));
  const weak = system.evaluateUrbanCandidates(lot, candidates, context(0.35));
  const strong = system.evaluateUrbanCandidates(lot, candidates, context(0.90));
  const rent = (items: typeof weak, parking: 'reduced' | 'standard') => items.find((item) => item.parkingProfile === parking)!.achievableRent;
  assert.ok(rent(weak, 'reduced') < rent(weak, 'standard'));
  assert.equal(rent(strong, 'reduced'), rent(strong, 'standard'));
});