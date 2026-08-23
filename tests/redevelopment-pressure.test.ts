import test from 'node:test';
import assert from 'node:assert/strict';
import { RedevelopmentPressureSystem } from '../src/simulation/development/RedevelopmentPressureSystem.ts';
import type { DevelopmentFeasibilityResult } from '../src/simulation/development/DevelopmentTypes.ts';

function evaluation(overrides: Partial<DevelopmentFeasibilityResult> = {}): DevelopmentFeasibilityResult {
  return {
    lotId: 'lot:1',
    definitionId: 'residential_cottage',
    zone: 'residential',
    legal: true,
    feasible: true,
    landValue: 30_000,
    accessScore: 0.8,
    achievableRent: 600,
    rentableCapacity: 10,
    grossPotentialRent: 6_000,
    vacancyRate: 0.08,
    effectiveGrossIncome: 5_520,
    operatingExpenses: 1_000,
    propertyTaxes: 300,
    netOperatingIncome: 4_220,
    hardConstructionCost: 35_000,
    softCosts: 5_000,
    sitePreparationCost: 0,
    preFinanceDevelopmentCost: 70_000,
    marketFinancingCost: 3_000,
    totalDevelopmentCost: 73_000,
    capRate: 0.06,
    stabilizedValue: 100_000,
    yieldOnCost: 0.06,
    returnOnCost: 0.37,
    residualLandValue: 40_000,
    riskScore: 0.1,
    rejectionReasons: [],
    ...overrides,
  };
}

test('no feasible replacement yields zero redevelopment pressure', () => {
  const existing = evaluation();
  const infeasible = evaluation({
    definitionId: 'residential_rowhouse',
    feasible: false,
    stabilizedValue: 220_000,
    rejectionReasons: ['utility'],
  });
  const result = new RedevelopmentPressureSystem().evaluate([{
    buildingId: 'building:1',
    lotId: 'lot:1',
    existingDefinitionId: 'residential_cottage',
    existingBaseConstructionCost: 35_000,
    assignedResidents: 5,
    existingEvaluation: existing,
    replacementEvaluations: [infeasible],
  }]);

  assert.equal(result.parcels.length, 1);
  assert.equal(result.parcels[0]!.pressure, 0);
  assert.equal(result.parcels[0]!.bestReplacementDefinitionId, undefined);
  assert.equal(result.highPressureCount, 0);
});

test('materially profitable replacement creates positive redevelopment pressure', () => {
  const existing = evaluation({ stabilizedValue: 100_000 });
  const replacement = evaluation({
    definitionId: 'residential_apartment',
    landValue: 40_000,
    totalDevelopmentCost: 140_000,
    stabilizedValue: 320_000,
  });
  const result = new RedevelopmentPressureSystem().evaluate([{
    buildingId: 'building:1',
    lotId: 'lot:1',
    existingDefinitionId: 'residential_cottage',
    existingBaseConstructionCost: 35_000,
    assignedResidents: 5,
    existingEvaluation: existing,
    replacementEvaluations: [replacement],
  }]);

  const parcel = result.parcels[0]!;
  assert.equal(parcel.bestReplacementDefinitionId, 'residential_apartment');
  assert.ok(parcel.netRedevelopmentValue > 0);
  assert.ok(parcel.pressure > 0);
  assert.ok(parcel.pressure <= 1.25);
});

test('higher displacement burden lowers redevelopment pressure', () => {
  const existing = evaluation({ stabilizedValue: 100_000 });
  const replacement = evaluation({
    definitionId: 'residential_apartment',
    landValue: 40_000,
    totalDevelopmentCost: 140_000,
    stabilizedValue: 320_000,
  });
  const system = new RedevelopmentPressureSystem();
  const low = system.evaluate([{
    buildingId: 'building:1',
    lotId: 'lot:1',
    existingDefinitionId: 'residential_cottage',
    existingBaseConstructionCost: 35_000,
    assignedResidents: 5,
    existingEvaluation: existing,
    replacementEvaluations: [replacement],
  }]).parcels[0]!;
  const high = system.evaluate([{
    buildingId: 'building:1',
    lotId: 'lot:1',
    existingDefinitionId: 'residential_cottage',
    existingBaseConstructionCost: 35_000,
    assignedResidents: 250,
    existingEvaluation: existing,
    replacementEvaluations: [replacement],
  }]).parcels[0]!;

  assert.ok(high.displacementCost > low.displacementCost);
  assert.ok(high.pressure < low.pressure);
});

test('redevelopment parcels rank by pressure then stable lot id', () => {
  const existing = evaluation({ stabilizedValue: 100_000 });
  const strongReplacement = evaluation({
    definitionId: 'residential_apartment', landValue: 40_000, totalDevelopmentCost: 130_000, stabilizedValue: 340_000,
  });
  const moderateReplacement = evaluation({
    definitionId: 'residential_rowhouse', landValue: 35_000, totalDevelopmentCost: 140_000, stabilizedValue: 260_000,
  });
  const system = new RedevelopmentPressureSystem();
  const result = system.evaluate([
    {
      buildingId: 'building:b', lotId: 'lot:b', existingDefinitionId: 'residential_cottage', existingBaseConstructionCost: 35_000,
      assignedResidents: 5, existingEvaluation: { ...existing, lotId: 'lot:b' }, replacementEvaluations: [{ ...moderateReplacement, lotId: 'lot:b' }],
    },
    {
      buildingId: 'building:a', lotId: 'lot:a', existingDefinitionId: 'residential_cottage', existingBaseConstructionCost: 35_000,
      assignedResidents: 5, existingEvaluation: { ...existing, lotId: 'lot:a' }, replacementEvaluations: [{ ...strongReplacement, lotId: 'lot:a' }],
    },
  ]);

  assert.equal(result.parcels[0]!.lotId, 'lot:a');
  assert.ok(result.parcels[0]!.pressure >= result.parcels[1]!.pressure);
});

test('redevelopment pressure is deterministic and independent of input order', () => {
  const existing = evaluation({ stabilizedValue: 100_000 });
  const replacement = evaluation({
    definitionId: 'residential_apartment', landValue: 40_000, totalDevelopmentCost: 140_000, stabilizedValue: 320_000,
  });
  const inputs = [
    {
      buildingId: 'building:b', lotId: 'lot:b', existingDefinitionId: 'residential_cottage', existingBaseConstructionCost: 35_000,
      assignedResidents: 6, existingEvaluation: { ...existing, lotId: 'lot:b' }, replacementEvaluations: [{ ...replacement, lotId: 'lot:b' }],
    },
    {
      buildingId: 'building:a', lotId: 'lot:a', existingDefinitionId: 'residential_cottage', existingBaseConstructionCost: 35_000,
      assignedResidents: 4, existingEvaluation: { ...existing, lotId: 'lot:a' }, replacementEvaluations: [{ ...replacement, lotId: 'lot:a' }],
    },
  ] as const;
  const first = new RedevelopmentPressureSystem();
  const second = new RedevelopmentPressureSystem();

  assert.deepEqual(first.evaluate(inputs), second.evaluate([...inputs].reverse()));
  assert.deepEqual(first.snapshot(), second.snapshot());
});

test('redevelopment pressure rejects invalid construction and displacement inputs', () => {
  const existing = evaluation();
  const replacement = evaluation({ definitionId: 'residential_rowhouse' });
  const system = new RedevelopmentPressureSystem();
  const base = {
    buildingId: 'building:1', lotId: 'lot:1', existingDefinitionId: 'residential_cottage',
    existingBaseConstructionCost: 35_000, assignedResidents: 5, existingEvaluation: existing, replacementEvaluations: [replacement],
  } as const;

  assert.throws(() => system.evaluate([{ ...base, existingBaseConstructionCost: -1 }]), /existingBaseConstructionCost/);
  assert.throws(() => system.evaluate([{ ...base, assignedResidents: -1 }]), /assignedResidents/);
  assert.throws(() => system.evaluate([{ ...base, assignedResidents: Number.NaN }]), /assignedResidents/);
  assert.throws(() => system.evaluate([{ ...base, existingBaseConstructionCost: Number.POSITIVE_INFINITY }]), /existingBaseConstructionCost/);
});
