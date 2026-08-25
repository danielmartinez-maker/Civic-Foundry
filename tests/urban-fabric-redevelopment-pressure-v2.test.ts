import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RedevelopmentPressureSystem,
  type PhysicalRedevelopmentPressureInput,
} from '../src/simulation/development/RedevelopmentPressureSystem.ts';

test('unused FAR deterioration demand and profitability create explainable physical redevelopment pressure', () => {
  const system = new RedevelopmentPressureSystem();
  const low = system.evaluatePhysical(physicalInput({
    unusedEffectiveFARRatio: 0.05,
    landImprovementRatio: 0.25,
    buildingCondition: 92,
    demandScore: 0.20,
    accessibilityChange: 0,
    rezoned: false,
    assemblyOpportunity: 0,
    profitabilityScore: 0.15,
  }));
  const high = system.evaluatePhysical(physicalInput({
    unusedEffectiveFARRatio: 0.85,
    landImprovementRatio: 2.5,
    buildingCondition: 28,
    demandScore: 0.90,
    accessibilityChange: 0.35,
    rezoned: true,
    assemblyOpportunity: 0.70,
    profitabilityScore: 0.95,
  }));

  assert.ok(high.pressure > low.pressure);
  assert.ok(high.pressure >= 0 && high.pressure <= 1);
  assert.ok(high.positivePressure > high.penaltyPressure);
  assert.ok(high.reasons.includes('unused-far'));
  assert.ok(high.reasons.includes('deterioration'));
  assert.ok(high.reasons.includes('redevelopment-profitability'));
});

test('relocation demolition and preservation friction reduce otherwise identical pressure', () => {
  const system = new RedevelopmentPressureSystem();
  const base = system.evaluatePhysical(physicalInput());
  const constrained = system.evaluatePhysical(physicalInput({
    relocationCostRatio: 0.75,
    demolitionCostRatio: 0.65,
    preservationRestriction: 0.90,
  }));

  assert.ok(constrained.pressure < base.pressure);
  assert.ok(constrained.penaltyPressure > base.penaltyPressure);
  assert.ok(constrained.reasons.includes('relocation-friction'));
  assert.ok(constrained.reasons.includes('preservation-restriction'));
});

test('physical pressure diagnostics are deterministic and do not mutate legacy snapshot state', () => {
  const system = new RedevelopmentPressureSystem();
  const before = system.snapshot();
  const first = system.evaluatePhysical(physicalInput());
  const second = system.evaluatePhysical(physicalInput());

  assert.deepEqual(second, first);
  assert.deepEqual(system.snapshot(), before);
  assert.equal(first.pressure, Math.max(0, Math.min(1, first.positivePressure - first.penaltyPressure)));
});

function physicalInput(overrides: Partial<PhysicalRedevelopmentPressureInput> = {}): PhysicalRedevelopmentPressureInput {
  return {
    parcelId: 'parcel:p1',
    unusedEffectiveFARRatio: 0.65,
    landImprovementRatio: 1.8,
    buildingCondition: 45,
    demandScore: 0.75,
    accessibilityChange: 0.20,
    rezoned: true,
    assemblyOpportunity: 0.45,
    profitabilityScore: 0.80,
    relocationCostRatio: 0.10,
    demolitionCostRatio: 0.12,
    preservationRestriction: 0,
    ...overrides,
  };
}
