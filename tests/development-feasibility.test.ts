import assert from "node:assert/strict";
import test from "node:test";

import * as buildingCatalog from "../src/data/buildings.ts";
import type { BuildingDefinition } from "../src/data/buildings.ts";
import type { Lot } from "../src/world/lots/LotSystem.ts";

const catalog = buildingCatalog as unknown as {
  BUILDING_DEFINITIONS: Record<string, { id: string; zone: string }>;
  BUILDING_VARIANTS?: Record<
    string,
    ReadonlyArray<{
      id: string;
      zone: string;
      baseConstructionCost: number;
      baseRent: number;
      softCostRatio: number;
      operatingExpenseRatio: number;
      baseVacancy: number;
    }>
  >;
  getBuildingDefinition?: (id: string) => unknown;
};

test("building catalog exposes multiple deterministic development variants per zone", () => {
  assert.ok(catalog.BUILDING_VARIANTS, "expected BUILDING_VARIANTS export");
  assert.equal(
    typeof catalog.getBuildingDefinition,
    "function",
    "expected getBuildingDefinition export",
  );
  assert.deepEqual(Object.keys(catalog.BUILDING_VARIANTS), [
    "residential",
    "commercial",
    "industrial",
  ]);

  for (const zone of ["residential", "commercial", "industrial"] as const) {
    const variants = catalog.BUILDING_VARIANTS[zone]!;
    assert.ok(
      variants.length >= 3,
      `${zone} should expose at least three project variants`,
    );
    assert.equal(catalog.BUILDING_DEFINITIONS[zone]!.zone, zone);
    for (const definition of variants) {
      assert.equal(catalog.getBuildingDefinition!(definition.id), definition);
      assert.ok(definition.baseConstructionCost > 0);
      assert.ok(definition.baseRent > 0);
      assert.ok(definition.softCostRatio >= 0 && definition.softCostRatio < 1);
      assert.ok(
        definition.operatingExpenseRatio >= 0 &&
          definition.operatingExpenseRatio < 1,
      );
      assert.ok(definition.baseVacancy >= 0 && definition.baseVacancy < 1);
    }
  }
});

const lot: Lot = {
  id: "lot:4,4",
  x: 4,
  y: 4,
  zone: "residential",
  frontageRoadKey: "4,5",
};
const baseContext = {
  demand: 0.8,
  taxRate: 0.1,
  personAccessibility: 0.9,
  freightAccessibility: 0.7,
  serviceQuality: 0.9,
  neighborhoodQuality: 0.9,
  utilityRatio: 1,
  constructionCostIndex: 1,
  marketInterestRate: 0.05,
  zoningMaxIntensity: "high" as const,
  marketPressure: 0.8,
  marketRentMultiplier: 1,
  marketVacancyRate: 0.1,
  landValueMultiplier: 1,
};

async function feasibilitySystem() {
  const module = await import(
    "../src/simulation/development/DevelopmentFeasibilitySystem.ts"
  );
  return new module.DevelopmentFeasibilitySystem();
}

function definition(id: string): BuildingDefinition {
  assert.equal(typeof catalog.getBuildingDefinition, "function");
  return catalog.getBuildingDefinition!(id) as BuildingDefinition;
}

test("higher market rent multiplier improves parcel underwriting", async () => {
  const system = await feasibilitySystem();
  const project = definition("residential_rowhouse");
  const weak = system.evaluateLot(lot, [project], {
    ...baseContext,
    marketRentMultiplier: 0.75,
  })[0]!;
  const strong = system.evaluateLot(lot, [project], {
    ...baseContext,
    marketRentMultiplier: 1.35,
  })[0]!;
  assert.ok(strong.achievableRent > weak.achievableRent);
  assert.ok(strong.netOperatingIncome > weak.netOperatingIncome);
  assert.ok(strong.returnOnCost > weak.returnOnCost);
});

test("higher explicit market vacancy suppresses project income and return", async () => {
  const system = await feasibilitySystem();
  const project = definition("commercial_block");
  const commercialLot: Lot = { ...lot, zone: "commercial" };
  const healthy = system.evaluateLot(commercialLot, [project], {
    ...baseContext,
    marketVacancyRate: 0.05,
  })[0]!;
  const stressed = system.evaluateLot(commercialLot, [project], {
    ...baseContext,
    marketVacancyRate: 0.28,
  })[0]!;
  assert.ok(stressed.vacancyRate > healthy.vacancyRate);
  assert.ok(stressed.effectiveGrossIncome < healthy.effectiveGrossIncome);
  assert.ok(stressed.netOperatingIncome < healthy.netOperatingIncome);
  assert.ok(stressed.returnOnCost < healthy.returnOnCost);
});

test("taxes financing and construction costs still suppress project return", async () => {
  const system = await feasibilitySystem();
  const project = definition("commercial_block");
  const commercialLot: Lot = { ...lot, zone: "commercial" };
  const healthy = system.evaluateLot(commercialLot, [project], {
    ...baseContext,
    taxRate: 0.08,
  })[0]!;
  const stressed = system.evaluateLot(commercialLot, [project], {
    ...baseContext,
    taxRate: 0.25,
    constructionCostIndex: 1.6,
    marketInterestRate: 0.12,
  })[0]!;
  assert.ok(stressed.propertyTaxes > healthy.propertyTaxes);
  assert.ok(
    stressed.preFinanceDevelopmentCost > healthy.preFinanceDevelopmentCost,
  );
  assert.ok(stressed.marketFinancingCost > healthy.marketFinancingCost);
  assert.ok(stressed.returnOnCost < healthy.returnOnCost);
});

test("higher land value multiplier raises land cost and suppresses return", async () => {
  const system = await feasibilitySystem();
  const project = definition("residential_rowhouse");
  const cheapLand = system.evaluateLot(lot, [project], {
    ...baseContext,
    landValueMultiplier: 0.65,
  })[0]!;
  const expensiveLand = system.evaluateLot(lot, [project], {
    ...baseContext,
    landValueMultiplier: 1.55,
  })[0]!;
  assert.ok(expensiveLand.landValue > cheapLand.landValue);
  assert.ok(
    expensiveLand.preFinanceDevelopmentCost > cheapLand.preFinanceDevelopmentCost,
  );
  assert.ok(expensiveLand.returnOnCost < cheapLand.returnOnCost);
});

test("minimum services utilities access and zoning intensity reject candidates explicitly", async () => {
  const system = await feasibilitySystem();
  const apartment = definition("residential_apartment");
  const result = system.evaluateLot(lot, [apartment], {
    ...baseContext,
    personAccessibility: 0.1,
    utilityRatio: 0.2,
    serviceQuality: 0.2,
    zoningMaxIntensity: "medium" as const,
  })[0]!;
  assert.equal(result.legal, false);
  assert.equal(result.feasible, false);
  assert.ok(result.rejectionReasons.includes("zoning-intensity"));
  assert.ok(result.rejectionReasons.includes("access"));
  assert.ok(result.rejectionReasons.includes("utilities"));
  assert.ok(result.rejectionReasons.includes("services"));
});

test("industrial underwriting weights freight access more heavily than person access for physical feasibility", async () => {
  const system = await feasibilitySystem();
  const project = definition("industrial_workshop");
  const industrialLot: Lot = { ...lot, zone: "industrial" };
  const freightRich = system.evaluateLot(industrialLot, [project], {
    ...baseContext,
    personAccessibility: 0.3,
    freightAccessibility: 1,
  })[0]!;
  const personRich = system.evaluateLot(industrialLot, [project], {
    ...baseContext,
    personAccessibility: 1,
    freightAccessibility: 0.3,
  })[0]!;
  assert.ok(freightRich.accessScore > personRich.accessScore);
  assert.ok(freightRich.riskScore < personRich.riskScore);
});

test("underwriting rejects invalid market and financial inputs", async () => {
  const system = await feasibilitySystem();
  const project = definition("residential_cottage");
  assert.throws(
    () =>
      system.evaluateLot(lot, [project], {
        ...baseContext,
        constructionCostIndex: Number.NaN,
      }),
    /constructionCostIndex/,
  );
  assert.throws(
    () =>
      system.evaluateLot(lot, [project], {
        ...baseContext,
        marketInterestRate: -0.01,
      }),
    /marketInterestRate/,
  );
  assert.throws(
    () =>
      system.evaluateLot(lot, [project], {
        ...baseContext,
        marketRentMultiplier: 0,
      }),
    /marketRentMultiplier/,
  );
  assert.throws(
    () =>
      system.evaluateLot(lot, [project], {
        ...baseContext,
        marketVacancyRate: 1,
      }),
    /marketVacancyRate/,
  );
  assert.throws(
    () =>
      system.evaluateLot(lot, [project], {
        ...baseContext,
        landValueMultiplier: Number.NaN,
      }),
    /landValueMultiplier/,
  );
});
