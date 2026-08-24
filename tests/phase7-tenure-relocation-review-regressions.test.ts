import test from 'node:test';
import assert from 'node:assert/strict';
import { HousingRelocationSystem } from '../src/simulation/housing/HousingRelocationSystem.ts';
import type { HousingTenureOption } from '../src/simulation/housing/HousingTenureSystem.ts';
import { RedevelopmentExecutionSystem, type RedevelopmentExecutionInput } from '../src/simulation/development/RedevelopmentExecutionSystem.ts';
import type { DevelopmentFeasibilityResult } from '../src/simulation/development/DevelopmentTypes.ts';

const quality = Object.freeze({
  personAccessibility: 0.8,
  serviceQuality: 0.8,
  neighborhoodQuality: 0.8,
  utilityRatio: 1,
});

function renterOption(buildingId: string, monthlyCost: number): HousingTenureOption {
  return Object.freeze({
    buildingId,
    tenure: 'renter',
    capacity: 10,
    monthlyCost,
    monthlyRent: monthlyCost,
    ...quality,
  });
}

function feasibleReplacement(lotId: string): DevelopmentFeasibilityResult {
  return Object.freeze({
    lotId,
    definitionId: 'residential_rowhouse',
    zone: 'residential',
    legal: true,
    feasible: true,
    landValue: 10,
    accessScore: 1,
    achievableRent: 1_000,
    rentableCapacity: 10,
    grossPotentialRent: 120_000,
    vacancyRate: 0.05,
    effectiveGrossIncome: 114_000,
    operatingExpenses: 20_000,
    propertyTaxes: 5_000,
    netOperatingIncome: 20,
    hardConstructionCost: 60,
    softCosts: 10,
    sitePreparationCost: 10,
    preFinanceDevelopmentCost: 100,
    marketFinancingCost: 10,
    totalDevelopmentCost: 110,
    capRate: 0.06,
    stabilizedValue: 150,
    yieldOnCost: 20 / 110,
    returnOnCost: 40 / 110,
    residualLandValue: 50,
    riskScore: 0.2,
    rejectionReasons: Object.freeze([]),
  });
}

function redevelopmentInput(lotId: string): RedevelopmentExecutionInput {
  return Object.freeze({
    pressure: Object.freeze({
      buildingId: `building:${lotId}`,
      lotId,
      existingDefinitionId: 'residential_cottage',
      bestReplacementDefinitionId: 'residential_rowhouse',
      currentUseValue: 10,
      demolitionCost: 0,
      displacementCost: 0,
      netRedevelopmentValue: 20,
      pressure: 0.5,
    }),
    residentCapacity: 10,
    affordabilityScore: 1,
    displacedLowerIncomeResidents: 10,
    lowerIncomeAffordableSlack: 18,
    replacementEvaluation: feasibleReplacement(lotId),
  });
}

test('derived housing refresh preserves the latest relocation-cycle diagnostics until the next reconcile', () => {
  const system = new HousingRelocationSystem();
  system.initialize(10, [
    renterOption('building:a', 500),
    renterOption('building:b', 2_000),
  ]);

  const moved = system.reconcile({
    population: 10,
    options: [
      renterOption('building:a', 2_000),
      renterOption('building:b', 500),
    ],
    allowVoluntaryMoves: true,
  });
  assert.ok(moved.movedResidentsThisCycle > 0);
  assert.ok(moved.byBuilding['building:b']!.movedInResidentsThisCycle > 0);

  const refreshed = system.refreshSnapshot(10, [
    renterOption('building:a', 2_000),
    renterOption('building:b', 500),
  ]);
  assert.equal(refreshed.movedResidentsThisCycle, moved.movedResidentsThisCycle);
  assert.equal(
    refreshed.byBuilding['building:b']!.movedInResidentsThisCycle,
    moved.byBuilding['building:b']!.movedInResidentsThisCycle,
  );
});

test('cumulative lower-income relocation reservation consumes only the policy-protected share', () => {
  const system = new RedevelopmentExecutionSystem();
  const snapshot = system.evaluate({
    population: 0,
    physicalCapacity: 100,
    effectiveAffordableCapacity: 100,
    unplacedResidents: 0,
    minimumAffordableShare: 0,
    lowerIncomeRelocationProtection: 0.90,
  }, [redevelopmentInput('lot:a'), redevelopmentInput('lot:b')]);

  assert.deepEqual(snapshot.decisions.map((decision) => decision.reason), ['admitted', 'admitted']);
});
