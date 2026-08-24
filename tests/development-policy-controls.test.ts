import test from 'node:test';
import assert from 'node:assert/strict';
import { DevelopmentPolicySystem } from '../src/simulation/development/DevelopmentPolicySystem.ts';
import { DevelopmentFeasibilitySystem } from '../src/simulation/development/DevelopmentFeasibilitySystem.ts';
import { RedevelopmentExecutionSystem } from '../src/simulation/development/RedevelopmentExecutionSystem.ts';
import { getBuildingDefinition } from '../src/data/buildings.ts';
import type { Lot } from '../src/world/lots/LotSystem.ts';
import { SimulationCore } from '../src/simulation/core/SimulationCore.ts';
import { TerrainGrid, type TerrainCell } from '../src/world/terrain/TerrainGrid.ts';
import { hydrateCore, serializeCore } from '../src/save/save.ts';

const lot: Lot = { id: 'lot:4,4', x: 4, y: 4, zone: 'residential', frontageRoadKey: '4,5' };
const baseContext = {
  demand: 0.8,
  taxRate: 0.10,
  personAccessibility: 0.9,
  freightAccessibility: 0.7,
  serviceQuality: 0.9,
  neighborhoodQuality: 0.9,
  utilityRatio: 1,
  constructionCostIndex: 1,
  marketInterestRate: 0.05,
  zoningMaxIntensity: 'high' as const,
  marketPressure: 0.8,
  marketRentMultiplier: 1,
  marketVacancyRate: 0.10,
  landValueMultiplier: 1,
};

function flat(width = 20, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({ elevation: 0.5, water: false, buildable: true, biome: 'grass' as const }));
  return new TerrainGrid(width, height, cells);
}

function housingCore(): SimulationCore {
  const core = new SimulationCore({ terrain: flat(), startingFunds: 500_000, seed: 812 });
  assert.equal(core.buildRoad(Array.from({ length: 14 }, (_, i) => ({ x: i + 2, y: 6 })), 'collector').ok, true);
  core.paintZone([{ x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 }], 'residential');
  assert.equal(core.placeUtility('power', 4, 7).ok, true);
  assert.equal(core.placeUtility('water', 8, 7).ok, true);
  const lots = core.lots.list().filter((item) => item.zone === 'residential').sort((a, b) => a.id.localeCompare(b.id));
  core.buildings.restore(lots.map((item) => ({
    id: `building:${item.id}`,
    lotId: item.id,
    x: item.x,
    y: item.y,
    zone: 'residential' as const,
    definitionId: 'residential_cottage',
    status: 'occupied' as const,
    constructionStartedTick: 0,
    completionTick: 0,
  })));
  core.population.restore(12);
  core.step(10);
  return core;
}

test('development policy state is bounded, deterministic, and density bonus raises residential intensity by one tier', () => {
  const policy = new DevelopmentPolicySystem();
  assert.deepEqual(policy.snapshot(), {
    densityBonus: 0,
    affordableHousingShare: 0,
    developmentFeeRate: 0,
    permittingCostReduction: 0,
    redevelopmentAffordableFloor: 0.85,
    lowerIncomeRelocationProtection: 0.90,
  });
  const state = policy.update({
    densityBonus: 1,
    affordableHousingShare: 0.2,
    developmentFeeRate: 0.06,
    permittingCostReduction: 0.25,
    redevelopmentAffordableFloor: 0.95,
    lowerIncomeRelocationProtection: 0.97,
  } as any);
  assert.equal(policy.adjustMaxIntensity('residential', 'medium'), 'high');
  assert.equal(policy.adjustMaxIntensity('commercial', 'medium'), 'medium');
  assert.equal((policy.snapshot() as any).lowerIncomeRelocationProtection, 0.97);
  assert.deepEqual(policy.snapshot(), state);
  assert.throws(() => policy.update({ affordableHousingShare: 0.31 }), /affordableHousingShare/i);
  assert.throws(() => policy.update({ redevelopmentAffordableFloor: 0.70 }), /redevelopmentAffordableFloor/i);
  assert.throws(() => policy.update({ lowerIncomeRelocationProtection: 0.49 } as any), /lowerIncomeRelocationProtection/i);
  assert.throws(() => policy.update({ lowerIncomeRelocationProtection: 1.01 } as any), /lowerIncomeRelocationProtection/i);
});

test('affordable requirement and development fee weaken residential underwriting while permitting incentive offsets cost', () => {
  const system = new DevelopmentFeasibilitySystem();
  const definition = getBuildingDefinition('residential_rowhouse');
  assert.ok(definition);
  const baseline = system.evaluateLot(lot, [definition], baseContext)[0]!;
  const regulated = system.evaluateLot(lot, [definition], {
    ...baseContext,
    policyAffordableHousingShare: 0.20,
    policyDevelopmentFeeRate: 0.08,
  })[0]!;
  const incentivized = system.evaluateLot(lot, [definition], {
    ...baseContext,
    policyAffordableHousingShare: 0.20,
    policyDevelopmentFeeRate: 0.08,
    policyPermittingCostReduction: 0.50,
  })[0]!;
  assert.ok(regulated.achievableRent < baseline.achievableRent);
  assert.ok(regulated.totalDevelopmentCost > baseline.totalDevelopmentCost);
  assert.ok(regulated.returnOnCost < baseline.returnOnCost);
  assert.ok(incentivized.totalDevelopmentCost < regulated.totalDevelopmentCost);
});

test('redevelopment affordable-capacity floor is policy-controlled instead of hard-coded', () => {
  const system = new RedevelopmentExecutionSystem();
  const replacement = new DevelopmentFeasibilitySystem().evaluateLot(lot, [getBuildingDefinition('residential_rowhouse')!], baseContext)[0]!;
  const input = {
    pressure: {
      buildingId: 'building:lot:4,4', lotId: lot.id, existingDefinitionId: 'residential_cottage',
      bestReplacementDefinitionId: replacement.definitionId, currentUseValue: 20_000, demolitionCost: 1_000,
      displacementCost: 1_000, netRedevelopmentValue: 30_000, pressure: 0.5,
    },
    residentCapacity: 10,
    affordabilityScore: 1,
    replacementEvaluation: replacement,
  } as const;
  const permissive = system.evaluate({ population: 80, physicalCapacity: 100, effectiveAffordableCapacity: 85, unplacedResidents: 0, minimumAffordableShare: 0.90 }, [input]);
  const protective = system.evaluate({ population: 80, physicalCapacity: 100, effectiveAffordableCapacity: 85, unplacedResidents: 0, minimumAffordableShare: 0.95 }, [input]);
  assert.equal(permissive.decisions[0]?.reason, 'admitted');
  assert.equal(protective.decisions[0]?.reason, 'affordable-capacity');
});

test('lower-income relocation protection blocks redevelopment when affordable slack cannot rehouse protected occupants', () => {
  const system = new RedevelopmentExecutionSystem();
  const replacement = new DevelopmentFeasibilitySystem().evaluateLot(lot, [getBuildingDefinition('residential_rowhouse')!], baseContext)[0]!;
  const input = {
    pressure: {
      buildingId: 'building:lot:4,4', lotId: lot.id, existingDefinitionId: 'residential_cottage',
      bestReplacementDefinitionId: replacement.definitionId, currentUseValue: 20_000, demolitionCost: 1_000,
      displacementCost: 1_000, netRedevelopmentValue: 30_000, pressure: 0.5,
    },
    residentCapacity: 10,
    affordabilityScore: 1,
    displacedLowerIncomeResidents: 8,
    lowerIncomeAffordableSlack: 6,
    replacementEvaluation: replacement,
  } as any;
  const result = system.evaluate({
    population: 50,
    physicalCapacity: 100,
    effectiveAffordableCapacity: 90,
    unplacedResidents: 0,
    minimumAffordableShare: 0.85,
    lowerIncomeRelocationProtection: 0.90,
  } as any, [input]);
  assert.equal(result.decisions[0]?.reason, 'lower-income-relocation');
});

test('SimulationCore policy controls change aggregate affordability and persist in Save V7', () => {
  const core = housingCore();
  const baselineAffordability = core.housingChoiceSnapshot.affordabilityIndex;
  const policy = core.setDevelopmentPolicy({
    densityBonus: 1,
    affordableHousingShare: 0.25,
    developmentFeeRate: 0.04,
    permittingCostReduction: 0.20,
    redevelopmentAffordableFloor: 0.95,
    lowerIncomeRelocationProtection: 0.96,
  } as any);
  assert.deepEqual(core.developmentPolicySnapshot, policy);
  assert.ok(core.housingChoiceSnapshot.affordabilityIndex >= baselineAffordability);
  const save = serializeCore(core);
  assert.deepEqual(save.developmentPolicy, policy);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(loaded.developmentPolicySnapshot, policy);
  assert.deepEqual(serializeCore(loaded), save);
});
