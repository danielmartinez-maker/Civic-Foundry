import test from 'node:test';
import assert from 'node:assert/strict';
import { RedevelopmentExecutionSystem } from '../src/simulation/development/RedevelopmentExecutionSystem.ts';
import type { DevelopmentFeasibilityResult } from '../src/simulation/development/DevelopmentTypes.ts';
import type { ResidentialRedevelopmentPressure } from '../src/simulation/development/RedevelopmentPressureSystem.ts';

function evaluation(overrides: Partial<DevelopmentFeasibilityResult> = {}): DevelopmentFeasibilityResult {
  return {
    lotId: 'lot:a',
    definitionId: 'residential_rowhouse',
    zone: 'residential',
    legal: true,
    feasible: true,
    landValue: 12_000,
    accessScore: 0.8,
    achievableRent: 600,
    rentableCapacity: 28,
    grossPotentialRent: 16_800,
    vacancyRate: 0.08,
    effectiveGrossIncome: 15_456,
    operatingExpenses: 4_636.8,
    propertyTaxes: 25,
    netOperatingIncome: 10_794.2,
    hardConstructionCost: 80_000,
    softCosts: 11_200,
    sitePreparationCost: 0,
    preFinanceDevelopmentCost: 103_200,
    marketFinancingCost: 2_000,
    totalDevelopmentCost: 105_200,
    capRate: 0.06,
    stabilizedValue: 180_000,
    yieldOnCost: 10_794.2 / 105_200,
    returnOnCost: (180_000 - 105_200) / 105_200,
    residualLandValue: 76_000,
    riskScore: 0.3,
    rejectionReasons: [],
    ...overrides,
  };
}

function pressure(overrides: Partial<ResidentialRedevelopmentPressure> = {}): ResidentialRedevelopmentPressure {
  return {
    buildingId: 'building:lot:a',
    lotId: 'lot:a',
    existingDefinitionId: 'residential_cottage',
    bestReplacementDefinitionId: 'residential_rowhouse',
    currentUseValue: 70_000,
    demolitionCost: 2_800,
    displacementCost: 1_500,
    netRedevelopmentValue: 30_000,
    pressure: 0.45,
    ...overrides,
  };
}

const housing = {
  population: 20,
  physicalCapacity: 40,
  effectiveAffordableCapacity: 32,
  unplacedResidents: 0,
} as const;

test('redevelopment execution blocks demolition that would violate the physical relocation floor', () => {
  const result = new RedevelopmentExecutionSystem().evaluate(
    { ...housing, population: 35 },
    [{ pressure: pressure(), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation() }],
  );
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.decisions[0]?.reason, 'physical-capacity');
});

test('redevelopment execution blocks all demolition while residents are already unplaced', () => {
  const result = new RedevelopmentExecutionSystem().evaluate(
    { ...housing, unplacedResidents: 1 },
    [{ pressure: pressure(), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation() }],
  );
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.decisions[0]?.reason, 'unplaced-residents');
});

test('redevelopment execution reserves relocation slack cumulatively in deterministic pressure order', () => {
  const first = { pressure: pressure({ lotId: 'lot:a', buildingId: 'building:lot:a', pressure: 0.6 }), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation({ lotId: 'lot:a' }) };
  const second = { pressure: pressure({ lotId: 'lot:b', buildingId: 'building:lot:b', pressure: 0.5 }), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation({ lotId: 'lot:b' }) };
  const result = new RedevelopmentExecutionSystem().evaluate(
    { population: 20, physicalCapacity: 35, effectiveAffordableCapacity: 30, unplacedResidents: 0 },
    [second, first],
  );
  assert.deepEqual(result.opportunities.map((item) => item.lotId), ['lot:a']);
  assert.equal(result.decisions.find((item) => item.lotId === 'lot:b')?.reason, 'physical-capacity');
  assert.equal(result.remainingPhysicalCapacity, 25);
});

test('redevelopment execution adds demolition and displacement friction to developer underwriting', () => {
  const base = evaluation();
  const signal = pressure({ demolitionCost: 2_800, displacementCost: 1_500 });
  const result = new RedevelopmentExecutionSystem().evaluate(
    housing,
    [{ pressure: signal, residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: base }],
  );
  assert.equal(result.opportunities.length, 1);
  const adjusted = result.opportunities[0]!;
  const friction = signal.demolitionCost + signal.displacementCost;
  assert.equal(adjusted.preFinanceDevelopmentCost, base.preFinanceDevelopmentCost + friction);
  assert.ok(adjusted.marketFinancingCost > base.marketFinancingCost);
  assert.equal(adjusted.totalDevelopmentCost, adjusted.preFinanceDevelopmentCost + adjusted.marketFinancingCost);
  assert.ok(adjusted.returnOnCost < base.returnOnCost);
  assert.ok(adjusted.yieldOnCost < base.yieldOnCost);
  assert.ok(adjusted.residualLandValue < base.residualLandValue);
});

test('redevelopment execution rejects low pressure and mismatched best-replacement diagnostics', () => {
  const system = new RedevelopmentExecutionSystem();
  const result = system.evaluate(housing, [
    { pressure: pressure({ lotId: 'lot:low', buildingId: 'building:lot:low', pressure: 0.2 }), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation({ lotId: 'lot:low' }) },
    { pressure: pressure({ lotId: 'lot:mismatch', buildingId: 'building:lot:mismatch', bestReplacementDefinitionId: 'residential_apartment' }), residentCapacity: 10, affordabilityScore: 0.8, replacementEvaluation: evaluation({ lotId: 'lot:mismatch' }) },
  ]);
  assert.equal(result.opportunities.length, 0);
  assert.deepEqual(result.decisions.map((item) => item.reason).sort(), ['low-pressure', 'replacement-mismatch']);
});
