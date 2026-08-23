# Deterministic Developer Pro Forma & Competition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic demand-triggered parcel buildout with deterministic parcel underwriting, differentiated developer bidding/capital allocation, project lifecycle ownership, and reproducible save/restore state.

**Architecture:** Add a pure `DevelopmentFeasibilitySystem` that underwrites legal project variants from parcel and city signals without mutating state. Add a stateful `DeveloperMarketSystem` that applies developer-specific financing, hurdle rates, preferences, risk tolerance, capital constraints, deterministic bid ranking, award allocation, and capital recycling. Keep `BuildingSystem` focused on construction/occupancy lifecycle; `SimulationCore` composes the market context and starts awarded projects.

**Tech Stack:** TypeScript ES modules; Node 22+ built-in `node:test`; `tsc` strict typechecking; deterministic simulation with no `Math.random()`.

**Spec:** `docs/superpowers/specs/2026-08-22-developer-pro-forma-competition-design.md`

## Global Constraints

- Target branch: `metropolitan-era`.
- Preserve deterministic replay for identical seed and save state.
- No `Math.random()`, wall-clock time, unordered state-dependent iteration, or hidden stochastic financing assumptions.
- Development evaluation remains on the existing 10-tick cadence unless regression/performance testing demonstrates a need to slow it.
- Keep broad player-facing zone categories (`residential`, `commercial`, `industrial`); do not add a density-zoning UI in this phase.
- Do not implement land-owner agents, auctions, banks/lender agents, amortizing debt, bankruptcy, M&A, speculative land banking, or macro credit cycles.
- New mutable developer state must be serialized and restored.
- Existing V6 saves must still hydrate; they begin with default developer state and no fabricated historical commitments.
- All feature work follows red-green-refactor TDD and ends with `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:smoke`.

---

## File Structure

### Create

- `src/simulation/development/DevelopmentTypes.ts` — shared immutable project-underwriting, bid, award, developer-state, and context types.
- `src/simulation/development/DevelopmentFeasibilitySystem.ts` — pure parcel/project underwriting and validation.
- `src/simulation/development/DeveloperMarketSystem.ts` — deterministic developer roster, developer-specific financing, bid ranking, awards, commitments, recycling, cancel/recovery, diagnostics, snapshot/restore.
- `tests/development-feasibility.test.ts` — parcel economics and legality tests.
- `tests/developer-market.test.ts` — developer bidding, capital, deterministic allocation, lifecycle tests.
- `tests/development-integration.test.ts` — `SimulationCore` integration and regression behavior.
- `src/save/saveV7.ts` — Save V7 envelope containing development-market state.
- `tests/save-v7.test.ts` — V7 round-trip, V6 migration, deterministic continuation, reference validation.

### Modify

- `src/data/buildings.ts` — add multiple project variants while preserving legacy zone lookup compatibility.
- `src/simulation/buildings/BuildingSystem.ts` — accept approved project starts, store developer/project finance metadata, and resolve capacities by `definitionId`.
- `src/simulation/core/SimulationCore.ts` — own development subsystems, compose parcel signals, run market cadence, recycle capital, and cancel commitments on bulldoze.
- `src/save/save.ts` — make V7 the default serializer/hydrator while retaining V4–V6 exports.
- `package.json` — bump package/game version to `0.7.0-metropolitan` only when Save V7 becomes the default.
- Existing tests that construct `Building` fixtures — keep new finance metadata optional so these fixtures remain source-compatible.

---

### Task 1: Data-driven project variants and definition lookup

**Files:**
- Modify: `src/data/buildings.ts`
- Create/Test: `tests/development-feasibility.test.ts`

**Interfaces:**
- Produces: `BuildingDefinition`, `BUILDING_VARIANTS`, `BUILDING_DEFINITION_BY_ID`, `getBuildingDefinition(id)`, and backward-compatible `BUILDING_DEFINITIONS[zone]`.
- Consumes: existing `ZoneType`.

- [ ] **Step 1: Write the failing catalog test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILDING_DEFINITIONS,
  BUILDING_VARIANTS,
  getBuildingDefinition,
} from '../src/data/buildings.ts';

test('building catalog exposes multiple deterministic development variants per zone', () => {
  assert.deepEqual(Object.keys(BUILDING_VARIANTS), ['residential', 'commercial', 'industrial']);
  for (const zone of ['residential', 'commercial', 'industrial'] as const) {
    assert.ok(BUILDING_VARIANTS[zone].length >= 3);
    assert.equal(BUILDING_DEFINITIONS[zone].zone, zone);
    for (const definition of BUILDING_VARIANTS[zone]) {
      assert.equal(getBuildingDefinition(definition.id), definition);
      assert.ok(definition.baseConstructionCost > 0);
      assert.ok(definition.baseRent > 0);
      assert.ok(definition.softCostRatio >= 0 && definition.softCostRatio < 1);
      assert.ok(definition.operatingExpenseRatio >= 0 && definition.operatingExpenseRatio < 1);
      assert.ok(definition.baseVacancy >= 0 && definition.baseVacancy < 1);
    }
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts
```

Expected: FAIL because `BUILDING_VARIANTS` / `getBuildingDefinition` do not exist.

- [ ] **Step 3: Expand `BuildingDefinition` without breaking legacy callers**

Implement these fields:

```ts
export type BuildingIntensity = 'low' | 'medium' | 'high';

export type BuildingDefinition = Readonly<{
  id: string;
  zone: ZoneType;
  intensity: BuildingIntensity;
  constructionTicks: number;
  residentCapacity: number;
  jobCapacity: number;
  powerDemand: number;
  waterDemand: number;
  garbageGeneration: number;
  taxBase: number;
  baseConstructionCost: number;
  softCostRatio: number;
  baseRent: number;
  operatingExpenseRatio: number;
  baseVacancy: number;
  baseCapRate: number;
  minimumAccess: number;
  minimumUtilityRatio: number;
  minimumServiceQuality: number;
  complexityFactor: number;
  riskWeight: number;
}>;
```

Create exactly three variants per zone with stable IDs:

```ts
residential_cottage
residential_rowhouse
residential_apartment
commercial_shop
commercial_block
commercial_office
industrial_workshop
industrial_warehouse
industrial_plant
```

Use calibrated first-pass hard costs and capacities:

```ts
// residential: cost 35k/80k/170k; residents 10/28/72
// commercial: cost 55k/125k/240k; jobs 8/22/45
// industrial: cost 85k/175k/320k; jobs 14/32/70
```

Use `BUILDING_DEFINITIONS` as a compatibility map to the low-intensity variant of each zone. Construct `BUILDING_DEFINITION_BY_ID` from the variants and throw on unknown IDs:

```ts
export function getBuildingDefinition(id: string): BuildingDefinition {
  const definition = BUILDING_DEFINITION_BY_ID[id];
  if (!definition) throw new Error(`unknown building definition: ${id}`);
  return definition;
}
```

- [ ] **Step 4: Run the focused test and typecheck**

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/buildings.ts tests/development-feasibility.test.ts
git commit -m "feat: add development project variants"
```

---

### Task 2: Pure parcel underwriting

**Files:**
- Create: `src/simulation/development/DevelopmentTypes.ts`
- Create: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify/Test: `tests/development-feasibility.test.ts`

**Interfaces:**
- Consumes: `Lot`, `BuildingDefinition`, zone demand/tax/access/service/utility/construction/interest signals.
- Produces: `DevelopmentParcelContext`, `DevelopmentFeasibilityResult`, `DevelopmentFeasibilitySystem.evaluateLot(lot, definitions, context)`.

- [ ] **Step 1: Add failing economics tests**

Append tests that construct one residential lot and compare the same definition under controlled contexts:

```ts
const lot = { id: 'lot:4,4', x: 4, y: 4, zone: 'residential' as const, frontageRoadKey: '4,5' };
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
};

test('higher rent-side demand improves parcel underwriting', () => {
  const system = new DevelopmentFeasibilitySystem();
  const definition = getBuildingDefinition('residential_rowhouse');
  const weak = system.evaluateLot(lot, [definition], { ...baseContext, demand: 0.15 })[0]!;
  const strong = system.evaluateLot(lot, [definition], { ...baseContext, demand: 1.0 })[0]!;
  assert.ok(strong.achievableRent > weak.achievableRent);
  assert.ok(strong.netOperatingIncome > weak.netOperatingIncome);
  assert.ok(strong.returnOnCost > weak.returnOnCost);
});

test('vacancy taxes financing and construction costs suppress project return', () => {
  const system = new DevelopmentFeasibilitySystem();
  const definition = getBuildingDefinition('commercial_block');
  const lotC = { ...lot, zone: 'commercial' as const };
  const healthy = system.evaluateLot(lotC, [definition], { ...baseContext, demand: 0.9, taxRate: 0.08 })[0]!;
  const stressed = system.evaluateLot(lotC, [definition], {
    ...baseContext,
    demand: 0.1,
    taxRate: 0.25,
    constructionCostIndex: 1.6,
    marketInterestRate: 0.12,
  })[0]!;
  assert.ok(stressed.vacancyRate > healthy.vacancyRate);
  assert.ok(stressed.propertyTaxes > healthy.propertyTaxes);
  assert.ok(stressed.preFinanceDevelopmentCost > healthy.preFinanceDevelopmentCost);
  assert.ok(stressed.returnOnCost < healthy.returnOnCost);
});

test('minimum services utilities access and zoning intensity reject illegal candidates', () => {
  const system = new DevelopmentFeasibilitySystem();
  const apartment = getBuildingDefinition('residential_apartment');
  const [result] = system.evaluateLot(lot, [apartment], {
    ...baseContext,
    personAccessibility: 0.1,
    utilityRatio: 0.2,
    serviceQuality: 0.2,
    zoningMaxIntensity: 'medium',
  });
  assert.equal(result!.legal, false);
  assert.equal(result!.feasible, false);
  assert.ok(result!.rejectionReasons.includes('zoning-intensity'));
  assert.ok(result!.rejectionReasons.includes('access'));
  assert.ok(result!.rejectionReasons.includes('utilities'));
  assert.ok(result!.rejectionReasons.includes('services'));
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts
```

Expected: FAIL because development types/system do not exist.

- [ ] **Step 3: Define immutable underwriting types**

`DevelopmentTypes.ts` must define:

```ts
export type DevelopmentParcelContext = Readonly<{
  demand: number;                 // -1..1 from DemandSystem
  taxRate: number;                // 0..0.25
  personAccessibility: number;    // 0..1
  freightAccessibility: number;   // 0..1
  serviceQuality: number;         // 0..1
  neighborhoodQuality: number;    // 0..1
  utilityRatio: number;           // 0..1
  constructionCostIndex: number;  // >0
  marketInterestRate: number;     // >=0
  zoningMaxIntensity: BuildingIntensity;
}>;

export type DevelopmentFeasibilityResult = Readonly<{
  lotId: string;
  definitionId: string;
  zone: ZoneType;
  legal: boolean;
  feasible: boolean;
  landValue: number;
  achievableRent: number;
  grossPotentialRent: number;
  vacancyRate: number;
  effectiveGrossIncome: number;
  operatingExpenses: number;
  propertyTaxes: number;
  netOperatingIncome: number;
  hardConstructionCost: number;
  softCosts: number;
  sitePreparationCost: number;
  preFinanceDevelopmentCost: number;
  marketFinancingCost: number;
  totalDevelopmentCost: number;
  stabilizedValue: number;
  yieldOnCost: number;
  returnOnCost: number;
  residualLandValue: number;
  riskScore: number;
  rejectionReasons: readonly string[];
}>;
```

Also define shared bid/award/state types needed by Task 3, but do not implement market behavior here.

- [ ] **Step 4: Implement bounded deterministic formulas**

`DevelopmentFeasibilitySystem.evaluateLot()` must:

1. validate all numeric inputs with `Number.isFinite`;
2. sort definitions by `id` before evaluating;
3. derive zone-specific access (`industrial` emphasizes freight; other zones emphasize person access);
4. clamp factors using local helpers only;
5. compute market-level financing with a neutral 55% leverage proxy solely for comparable parcel economics; Task 3 recomputes developer-specific financing.

Use these formulas exactly as the initial implementation contract:

```ts
const demandFactor = clamp(0.65 + ((context.demand + 1) / 2) * 0.85, 0.65, 1.50);
const accessScore = definition.zone === 'industrial'
  ? 0.75 * context.freightAccessibility + 0.25 * context.personAccessibility
  : 0.80 * context.personAccessibility + 0.20 * context.freightAccessibility;
const accessFactor = clamp(0.70 + accessScore * 0.60, 0.70, 1.30);
const serviceFactor = clamp(0.75 + context.serviceQuality * 0.45, 0.75, 1.20);
const utilityFactor = clamp(0.50 + context.utilityRatio * 0.50, 0.50, 1.00);
const neighborhoodFactor = clamp(0.75 + context.neighborhoodQuality * 0.50, 0.75, 1.25);
const achievableRent = definition.baseRent * demandFactor * accessFactor * serviceFactor * utilityFactor * neighborhoodFactor;

const weakDemandPenalty = Math.max(0, 0.5 - ((context.demand + 1) / 2)) * 0.18;
const poorAccessPenalty = Math.max(0, 0.6 - accessScore) * 0.16;
const servicePenalty = Math.max(0, 0.6 - context.serviceQuality) * 0.12;
const strongDemandReduction = Math.max(0, ((context.demand + 1) / 2) - 0.7) * 0.10;
const vacancyRate = clamp(definition.baseVacancy + weakDemandPenalty + poorAccessPenalty + servicePenalty - strongDemandReduction, 0.03, 0.35);

const rentableCapacity = Math.max(1, definition.residentCapacity + definition.jobCapacity);
const grossPotentialRent = achievableRent * rentableCapacity;
const effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate);
const operatingExpenses = effectiveGrossIncome * definition.operatingExpenseRatio;
const propertyTaxes = definition.taxBase * context.taxRate;
const netOperatingIncome = Math.max(0, effectiveGrossIncome - operatingExpenses - propertyTaxes);

const hardConstructionCost = definition.baseConstructionCost * context.constructionCostIndex * definition.complexityFactor;
const softCosts = hardConstructionCost * definition.softCostRatio;
const deficiency = Math.max(0, 1 - Math.min(context.utilityRatio, context.serviceQuality, accessScore));
const sitePreparationCost = hardConstructionCost * deficiency * 0.08;
const landValue = zoneBaseLandValue(definition.zone) * demandFactor * accessFactor * serviceFactor * neighborhoodFactor;
const preFinanceDevelopmentCost = landValue + hardConstructionCost + softCosts + sitePreparationCost;
const neutralDebt = preFinanceDevelopmentCost * 0.55;
const durationYears = definition.constructionTicks / 250;
const marketFinancingCost = neutralDebt * context.marketInterestRate * durationYears;
const totalDevelopmentCost = preFinanceDevelopmentCost + marketFinancingCost;
const capRate = clamp(definition.baseCapRate + definition.riskWeight * 0.015 + (1 - accessScore) * 0.01, 0.045, 0.11);
const stabilizedValue = netOperatingIncome / capRate;
const yieldOnCost = totalDevelopmentCost > 0 ? netOperatingIncome / totalDevelopmentCost : 0;
const returnOnCost = totalDevelopmentCost > 0 ? (stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost : -1;
const requiredDeveloperProfit = preFinanceDevelopmentCost * 0.10;
const residualLandValue = stabilizedValue - (hardConstructionCost + softCosts + sitePreparationCost + marketFinancingCost) - requiredDeveloperProfit;
```

Set `legal=false` only for zoning/intensity mismatch. Set `feasible=false` when illegal, minimum access/utility/service thresholds fail, residual land value is below estimated land value, or NOI is zero. Hurdle/capital constraints belong only to Task 3.

- [ ] **Step 5: Add invalid-input tests and make them pass**

```ts
assert.throws(
  () => system.evaluateLot(lot, [definition], { ...baseContext, constructionCostIndex: Number.NaN }),
  /constructionCostIndex/,
);
assert.throws(
  () => system.evaluateLot(lot, [definition], { ...baseContext, marketInterestRate: -0.01 }),
  /marketInterestRate/,
);
```

- [ ] **Step 6: Run focused suite and typecheck**

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/simulation/development/DevelopmentTypes.ts src/simulation/development/DevelopmentFeasibilitySystem.ts tests/development-feasibility.test.ts
git commit -m "feat: add deterministic parcel underwriting"
```

---

### Task 3: Deterministic developer competition and capital allocation

**Files:**
- Create: `src/simulation/development/DeveloperMarketSystem.ts`
- Modify: `src/simulation/development/DevelopmentTypes.ts`
- Create/Test: `tests/developer-market.test.ts`

**Interfaces:**
- Consumes: `DevelopmentFeasibilityResult[]`, project definitions, `marketInterestRate`, tick.
- Produces: `DeveloperMarketSystem.allocate(opportunities, context)`, `advance(tick)`, `cancelProject(buildingId, recoveryRatio)`, `listDevelopers()`, `lastBids()`, `lastAwards()`, `snapshotState()`, `restoreState()`.

- [ ] **Step 1: Write failing developer differentiation tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { DeveloperMarketSystem } from '../src/simulation/development/DeveloperMarketSystem.ts';

// Use compact fixtures with the exact DevelopmentFeasibilityResult shape.
test('developer hurdles preferences and financing produce different bid ranks', () => {
  const market = new DeveloperMarketSystem();
  const awards = market.allocate([
    fixtureOpportunity({ lotId: 'lot:r', definitionId: 'residential_rowhouse', zone: 'residential', returnOnCost: 0.18, riskScore: 0.30 }),
    fixtureOpportunity({ lotId: 'lot:i', definitionId: 'industrial_warehouse', zone: 'industrial', returnOnCost: 0.17, riskScore: 0.28 }),
  ], { tick: 10, marketInterestRate: 0.05 });
  assert.ok(awards.length > 0);
  assert.ok(market.lastBids().some((bid) => bid.preferenceBonus > 0));
});

test('insufficient capital and concurrent-project limits prevent unlimited awards', () => {
  const market = new DeveloperMarketSystem({
    developers: [fixtureDeveloper({ id: 'tiny', availableCapital: 30_000, maxConcurrentProjects: 1, hurdleRate: 0.05 })],
  });
  const awards = market.allocate([
    fixtureOpportunity({ lotId: 'lot:1', requiredMarketEquity: 20_000, returnOnCost: 0.20 }),
    fixtureOpportunity({ lotId: 'lot:2', requiredMarketEquity: 20_000, returnOnCost: 0.20 }),
  ], { tick: 10, marketInterestRate: 0.05 });
  assert.equal(awards.length, 1);
  assert.ok(market.listDevelopers()[0]!.availableCapital >= 0);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/developer-market.test.ts
```

Expected: FAIL because `DeveloperMarketSystem` does not exist.

- [ ] **Step 3: Define developer and bid state**

Use these stable developer IDs and defaults:

```ts
local_builder: {
  availableCapital: 120_000, hurdleRate: 0.10, maxLeverage: 0.55,
  financingSpread: 0.035, riskTolerance: 0.55, maxConcurrentProjects: 2,
  preferences: { residential: 0.05, commercial: 0.00, industrial: -0.05 },
}
urban_developer: {
  availableCapital: 300_000, hurdleRate: 0.11, maxLeverage: 0.65,
  financingSpread: 0.030, riskTolerance: 0.70, maxConcurrentProjects: 3,
  preferences: { residential: 0.025, commercial: 0.04, industrial: -0.02 },
}
industrial_specialist: {
  availableCapital: 260_000, hurdleRate: 0.105, maxLeverage: 0.65,
  financingSpread: 0.025, riskTolerance: 0.80, maxConcurrentProjects: 3,
  preferences: { residential: -0.05, commercial: 0.00, industrial: 0.06 },
}
institutional_developer: {
  availableCapital: 600_000, hurdleRate: 0.09, maxLeverage: 0.75,
  financingSpread: 0.018, riskTolerance: 0.85, maxConcurrentProjects: 4,
  minimumProjectCost: 100_000,
  preferences: { residential: 0.02, commercial: 0.03, industrial: 0.03 },
}
```

State types must include active commitments keyed by `buildingId`/award ID with `lotId`, `developerId`, `equity`, `awardTick`, `completionTick`, `releaseTick`, and `expectedReturn`.

- [ ] **Step 4: Implement developer-specific underwriting and deterministic bid order**

For every market-feasible opportunity and every developer sorted by `id`:

```ts
const leverage = Math.min(developer.maxLeverage, 0.75);
const debt = opportunity.preFinanceDevelopmentCost * leverage;
const equity = opportunity.preFinanceDevelopmentCost - debt;
const durationYears = definition.constructionTicks / 250;
const financingCost = debt * (context.marketInterestRate + developer.financingSpread) * durationYears;
const totalDevelopmentCost = opportunity.preFinanceDevelopmentCost + financingCost;
const expectedReturn = totalDevelopmentCost > 0
  ? (opportunity.stabilizedValue - totalDevelopmentCost) / totalDevelopmentCost
  : -1;
const expectedReturnMargin = expectedReturn - developer.hurdleRate;
const preferenceBonus = developer.preferences[opportunity.zone] ?? 0;
const capitalEfficiencyBonus = clamp01(1 - equity / Math.max(1, developer.availableCapital)) * 0.025;
const residualValueBonus = clamp(opportunity.residualLandValue / Math.max(1, opportunity.landValue), -1, 2) * 0.01;
const riskPenalty = Math.max(0, opportunity.riskScore - developer.riskTolerance) * 0.10;
const rankScore = expectedReturnMargin + preferenceBonus + capitalEfficiencyBonus + residualValueBonus - riskPenalty;
```

Reject bids when expected return is below hurdle, risk exceeds tolerance, equity exceeds available capital, project slots are full, or minimum project-cost constraints fail.

Sort bids per parcel by:

```ts
rankScore DESC
residualLandValue DESC
requiredEquity ASC
developerId ASC
```

Then globally sort parcel winners by:

```ts
rankScore DESC
expectedReturnMargin DESC
residualLandValue DESC
lotId ASC
```

Re-check capital/slots immediately before each award; update capital/commitments after each award. Never use random tie-breaking.

- [ ] **Step 5: Add deterministic winner and sequential allocation tests**

```ts
test('same opportunity set yields one stable winner and identical repeated state', () => {
  const a = new DeveloperMarketSystem();
  const b = new DeveloperMarketSystem();
  const input = [fixtureOpportunity({ lotId: 'lot:1', returnOnCost: 0.25 })];
  assert.deepEqual(a.allocate(input, { tick: 10, marketInterestRate: 0.05 }), b.allocate(input, { tick: 10, marketInterestRate: 0.05 }));
  assert.deepEqual(a.snapshotState(), b.snapshotState());
});

test('global allocation rechecks capital after each award', () => {
  const market = new DeveloperMarketSystem({ developers: [fixtureDeveloper({ id: 'solo', availableCapital: 50_000, maxConcurrentProjects: 3, hurdleRate: 0.01 })] });
  const awards = market.allocate([
    fixtureOpportunity({ lotId: 'lot:a', requiredMarketEquity: 30_000, returnOnCost: 0.30 }),
    fixtureOpportunity({ lotId: 'lot:b', requiredMarketEquity: 30_000, returnOnCost: 0.29 }),
  ], { tick: 20, marketInterestRate: 0.03 });
  assert.equal(awards.length, 1);
});
```

- [ ] **Step 6: Implement capital recycling and cancellation**

On award, compute:

```ts
releaseTick = completionTick + 100;
```

At `advance(tick)`, release commitments whose `releaseTick <= tick` and grow capital by:

```ts
realizedReturn = clamp(expectedReturn, -0.25, 0.35);
returnedCapital = equity * (1 + realizedReturn);
```

For construction bulldoze/cancel, use deterministic 50% equity recovery:

```ts
cancelProject(buildingId, 0.50)
```

This removes the commitment, frees the project slot, and adds `equity * 0.50` back to available capital.

- [ ] **Step 7: Test snapshot/restore invariants**

`restoreState()` must reject non-finite/negative capital, duplicate commitment IDs, unknown developer IDs, leverage outside `[0,1)`, and commitments that would make `committedCapital` disagree with the sum of active commitment equity.

- [ ] **Step 8: Run focused suite and typecheck**

```bash
node --experimental-strip-types --test tests/developer-market.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/simulation/development/DevelopmentTypes.ts src/simulation/development/DeveloperMarketSystem.ts tests/developer-market.test.ts
git commit -m "feat: add deterministic developer competition"
```

---

### Task 4: Make `BuildingSystem` a lifecycle executor

**Files:**
- Modify: `src/simulation/buildings/BuildingSystem.ts`
- Modify/Test: `tests/development-integration.test.ts`
- Modify as required: existing test fixture helpers only if strict typing requires it; prefer optional metadata to avoid churn.

**Interfaces:**
- Consumes: `DevelopmentAward`.
- Produces: `BuildingSystem.startDevelopment(tick, lot, award): Building`; building owner/finance metadata; capacity lookup by definition ID.

- [ ] **Step 1: Write failing lifecycle test**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { BuildingSystem } from '../src/simulation/buildings/BuildingSystem.ts';

const lot = { id: 'lot:2,2', x: 2, y: 2, zone: 'residential' as const, frontageRoadKey: '2,3' };

test('BuildingSystem starts only an awarded project and preserves developer metadata', () => {
  const buildings = new BuildingSystem();
  const award = fixtureAward({ lotId: lot.id, definitionId: 'residential_rowhouse', developerId: 'local_builder', requiredEquity: 30_000, totalDevelopmentCost: 75_000 });
  const started = buildings.startDevelopment(100, lot, award);
  assert.equal(started.developerId, 'local_builder');
  assert.equal(started.definitionId, 'residential_rowhouse');
  assert.equal(started.status, 'construction');
  assert.throws(() => buildings.startDevelopment(101, lot, award), /already developed|occupied/i);
});
```

- [ ] **Step 2: Run focused test and verify RED**

```bash
node --experimental-strip-types --test tests/development-integration.test.ts
```

Expected: FAIL because `startDevelopment` does not exist.

- [ ] **Step 3: Add optional finance/owner metadata and explicit start API**

Extend `Building` with optional backward-compatible fields:

```ts
developerId?: string;
projectCost?: number;
requiredEquity?: number;
awardScore?: number;
```

Implement:

```ts
startDevelopment(tick: number, lot: Lot, award: DevelopmentAward): Building
```

Validate lot/award IDs and zone/definition compatibility. Use `getBuildingDefinition(award.definitionId)` for construction ticks. Do not perform financial feasibility inside this method.

Remove `evaluateDevelopment()` after `SimulationCore` is migrated in Task 5; until then it may remain temporarily to keep the branch compiling during the TDD sequence.

- [ ] **Step 4: Resolve capacity/tax-demand consumers by definition ID**

Change `residentialCapacity()` and `jobCapacity()` from zone-only lookups to:

```ts
const definition = getBuildingDefinition(building.definitionId);
```

For legacy/custom fixture IDs that are not in the catalog, retain zone fallback:

```ts
function definitionForBuilding(building: Building): BuildingDefinition {
  return BUILDING_DEFINITION_BY_ID[building.definitionId] ?? BUILDING_DEFINITIONS[building.zone];
}
```

Use the same helper anywhere building resource/tax characteristics are looked up from zone-only data if variant-specific behavior would otherwise be lost.

- [ ] **Step 5: Run integration test plus existing city-loop test**

```bash
node --experimental-strip-types --test tests/development-integration.test.ts tests/core-city-loop.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/buildings/BuildingSystem.ts tests/development-integration.test.ts
git commit -m "refactor: make buildings execute development awards"
```

---

### Task 5: Integrate the development market into `SimulationCore`

**Files:**
- Modify: `src/simulation/core/SimulationCore.ts`
- Modify: `src/simulation/buildings/BuildingSystem.ts` (remove old auto-development method after integration)
- Modify/Test: `tests/development-integration.test.ts`
- Regression: `tests/core-city-loop.test.ts`, `tests/phase6-headless.test.ts`

**Interfaces:**
- Produces public read-only systems: `developmentFeasibility`, `developerMarket`.
- Produces private helpers: `evaluateDevelopmentMarket()`, `developmentContextForLot(lot)`.
- Consumes existing demand, taxes, utility, traffic, mobility, neighborhood/service, roads, economy snapshots.

- [ ] **Step 1: Write failing city-level behavior tests**

```ts
test('city does not auto-build when project economics fail developer hurdles', () => {
  const core = buildFlatDevelopmentCore();
  core.taxes.setRate('residential', 0.25);
  core.step(300);
  assert.equal(core.buildings.list().length, 0);
  assert.ok(core.developerMarket.lastBids().length === 0 || core.developerMarket.lastAwards().length === 0);
});

test('managed accessible parcels can receive deterministic development awards', () => {
  const a = buildFlatDevelopmentCore({ utilities: true });
  const b = buildFlatDevelopmentCore({ utilities: true });
  a.step(800);
  b.step(800);
  assert.ok(a.buildings.list().length > 0);
  assert.deepEqual(a.developerMarket.lastAwards(), b.developerMarket.lastAwards());
  assert.deepEqual(a.buildings.list(), b.buildings.list());
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
node --experimental-strip-types --test tests/development-integration.test.ts
```

Expected: FAIL because `SimulationCore` does not expose/run the market.

- [ ] **Step 3: Instantiate the development systems**

Add:

```ts
readonly developmentFeasibility: DevelopmentFeasibilitySystem;
readonly developerMarket: DeveloperMarketSystem;
```

Construct both in `SimulationCore` with deterministic defaults.

- [ ] **Step 4: Compose per-lot market signals from existing systems**

Implement `developmentContextForLot(lot)` using only current deterministic state:

```ts
const roadX = Number(lot.frontageRoadKey.split(',')[0]);
const roadY = Number(lot.frontageRoadKey.split(',')[1]);
const frontage = this.roads.get(roadX, roadY);
const roadAccessBonus = frontage?.type === 'arterial' ? 0.12 : frontage?.type === 'collector' ? 0.07 : 0.02;

const personAccessibility = clamp01(this.mobilitySnapshot.personAccessibility + roadAccessBonus);
const freightAccessibility = clamp01(this.trafficSnapshot.jobAccessibility + roadAccessBonus);
const utilityRatio = Math.min(this.utilitySnapshot.power.serviceRatio, this.utilitySnapshot.water.serviceRatio);
const serviceQuality = lot.zone === 'commercial'
  ? this.neighborhoodSnapshot.commercialServiceQuality
  : this.neighborhoodSnapshot.citywideServiceQuality;
const neighborhoodQuality = clamp01(serviceQuality * 0.7 + personAccessibility * 0.3);
const constructionCostIndex = clamp(1 + (1 - utilityRatio) * 0.20 + (1 - serviceQuality) * 0.10, 0.85, 1.50);
const marketInterestRate = clamp(0.045 + Math.max(0, this.economySnapshot.unpaidOperatingCost ?? 0) / 1_000_000, 0.03, 0.12);
const zoningMaxIntensity = personAccessibility >= 0.78 && utilityRatio >= 0.85 ? 'high' : personAccessibility >= 0.55 ? 'medium' : 'low';
```

If `TrafficAnalyticsSnapshot` uses different exact property names, map to the existing job/commercial accessibility fields already consumed by `DemandSystem`; do not invent parallel pathfinding.

- [ ] **Step 5: Replace the old 10-tick build trigger**

Replace:

```ts
this.buildings.evaluateDevelopment(this.clock.tick, this.lots.list(), this.demandSnapshot);
```

with:

```ts
this.evaluateDevelopmentMarket();
```

`evaluateDevelopmentMarket()` must:

1. filter lots already present in `BuildingSystem`;
2. skip zones with demand `<= 0.05`;
3. evaluate `BUILDING_VARIANTS[lot.zone]` with the lot context;
4. flatten results in lot-ID/definition-ID stable order;
5. call `developerMarket.allocate(...)` once globally per evaluation cycle;
6. start each award by resolving its lot and calling `buildings.startDevelopment(...)`;
7. attach `buildingId` back to the market commitment using a deterministic `confirmAwardBuilding(awardId, building.id)` API if needed.

- [ ] **Step 6: Advance/recycle developer capital every tick and handle bulldoze cancellation**

After `buildings.tick(this.clock.tick)`, call:

```ts
this.developerMarket.advance(this.clock.tick);
```

In `bulldozeAt`, before returning a removed building:

```ts
if (building.developerId) this.developerMarket.cancelProject(building.id, 0.50);
```

Cancellation must be a no-op if the commitment already recycled.

- [ ] **Step 7: Remove `BuildingSystem.evaluateDevelopment()`**

Delete the obsolete demand-triggered implementation once all compilation/test callers have migrated.

- [ ] **Step 8: Run feature and core regression tests**

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts tests/core-city-loop.test.ts tests/phase6-headless.test.ts
npm run typecheck
```

Expected: PASS. If `core-city-loop` calibrated growth now stalls, tune project economics/data, not the test's business assertion; managed infrastructure must still eventually grow while utility failure must still stall.

- [ ] **Step 9: Commit**

```bash
git add src/simulation/core/SimulationCore.ts src/simulation/buildings/BuildingSystem.ts tests/development-integration.test.ts
git commit -m "feat: integrate developer market into city simulation"
```

---

### Task 6: Save V7 and deterministic continuation

**Files:**
- Create: `src/save/saveV7.ts`
- Modify: `src/save/save.ts`
- Modify: `package.json`
- Create/Test: `tests/save-v7.test.ts`
- Regression: `tests/save-v6.test.ts`

**Interfaces:**
- Produces: `SaveV7`, `serializeCoreV7`, `hydrateCoreV7`.
- Consumes: `DeveloperMarketStateSnapshot`, V6 serializer/hydrator.

- [ ] **Step 1: Write failing Save V7 tests**

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCore, serializeCore, serializeCoreV6 } from '../src/save/save.ts';

test('default save API serializes Save V7 development state', () => {
  const core = buildDevelopmentCity();
  core.step(900);
  const save = serializeCore(core);
  assert.equal(save.saveVersion, 7);
  assert.equal(save.gameVersion, '0.7.0-metropolitan');
  assert.ok('developmentMarket' in save);
});

test('Save V7 resumes developer capital commitments and future awards identically', () => {
  const uninterrupted = buildDevelopmentCity();
  uninterrupted.step(900);
  const save = serializeCore(uninterrupted);
  const loaded = hydrateCore(structuredClone(save));
  assert.deepEqual(serializeCore(loaded), save);
  uninterrupted.step(700);
  loaded.step(700);
  assert.deepEqual(serializeCore(loaded), serializeCore(uninterrupted));
});

test('loading V6 starts with default developers and no fabricated commitments', () => {
  const core = buildDevelopmentCity();
  core.step(400);
  const v6 = serializeCoreV6(core);
  const loaded = hydrateCore(v6);
  assert.equal(loaded.developerMarket.snapshotState().commitments.length, 0);
  assert.equal(loaded.developerMarket.listDevelopers().length, 4);
});
```

- [ ] **Step 2: Run save test and verify RED**

```bash
node --experimental-strip-types --test tests/save-v7.test.ts
```

Expected: FAIL because Save V7 is not implemented.

- [ ] **Step 3: Implement V7 envelope by layering over V6**

Use:

```ts
export type SaveV7 = Omit<SaveV6, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 7;
  gameVersion: '0.7.0-metropolitan';
  developmentMarket: DeveloperMarketStateSnapshot;
};
```

`serializeCoreV7(core)` spreads V6 data, replaces version fields, and stores `core.developerMarket.snapshotState()`.

`hydrateCoreV7(input)` behavior:

```ts
if (!isRecord(input)) throw new Error('save must be an object');
if (input.saveVersion !== 7) return hydrateCoreV6(input);
```

For V7, convert the shared envelope to V6, hydrate V6, then validate/restore `developmentMarket`. After restore, verify every active commitment's building ID resolves to an existing building and developer IDs are valid. Do not require commitments for buildings from migrated V6 saves.

- [ ] **Step 4: Make V7 the default API and bump package version**

`src/save/save.ts` must continue exporting V4, V5, V6 functions/types and additionally export V7. Default:

```ts
export function serializeCore(core: SimulationCore): SaveV7 { return serializeCoreV7(core); }
export function hydrateCore(input: unknown): SimulationCore { return hydrateCoreV7(input); }
```

Set in `package.json`:

```json
"version": "0.7.0-metropolitan"
```

- [ ] **Step 5: Add invalid-reference test**

```ts
const save = structuredClone(serializeCore(core));
const commitment = save.developmentMarket.commitments[0];
assert.ok(commitment);
commitment.buildingId = 'missing-building';
assert.throws(() => hydrateCore(save), /development.*building|building.*development/i);
```

- [ ] **Step 6: Run V7 and V6 save suites plus typecheck**

```bash
node --experimental-strip-types --test tests/save-v7.test.ts tests/save-v6.test.ts
npm run typecheck
```

Expected: PASS. Existing `tests/save-v6.test.ts` may need its default-API version assertion updated only if it intentionally tests the current default serializer; V6-specific helpers and round-trip guarantees must remain intact.

- [ ] **Step 7: Commit**

```bash
git add src/save/saveV7.ts src/save/save.ts package.json tests/save-v7.test.ts tests/save-v6.test.ts
git commit -m "feat: persist developer market in save v7"
```

---

### Task 7: Diagnostics, invariants, and performance guardrails

**Files:**
- Modify: `src/simulation/development/DeveloperMarketSystem.ts`
- Modify: `src/simulation/development/DevelopmentFeasibilitySystem.ts`
- Modify/Test: `tests/developer-market.test.ts`
- Modify/Test: `tests/development-integration.test.ts`

**Interfaces:**
- Produces bounded diagnostics: `lastEvaluations()`, `lastBids()`, `lastAwards()`, `getDeveloperState(id)`, `getParcelFeasibility(lotId)`.

- [ ] **Step 1: Write failing observability and bounded-history tests**

```ts
test('development diagnostics expose copies and remain bounded to the latest cycle', () => {
  const market = new DeveloperMarketSystem();
  market.allocate(firstCycle, { tick: 10, marketInterestRate: 0.05 });
  const first = market.lastAwards();
  market.allocate(secondCycle, { tick: 20, marketInterestRate: 0.05 });
  assert.notDeepEqual(market.lastAwards(), first);
  const developers = market.listDevelopers();
  developers[0]!.availableCapital = 0;
  assert.notEqual(market.listDevelopers()[0]!.availableCapital, 0);
});
```

- [ ] **Step 2: Run focused test and verify RED if APIs/copy semantics are incomplete**

```bash
node --experimental-strip-types --test tests/developer-market.test.ts tests/development-integration.test.ts
```

- [ ] **Step 3: Implement copy-safe, one-cycle diagnostics**

Store only the latest evaluation/bid/award arrays. Return cloned/frozen plain records; never expose internal mutable maps or arrays.

- [ ] **Step 4: Add duplicate-lot/negative-capital/non-finite guard tests**

Test that allocation cannot award two projects to one lot, no post-award developer capital is negative, restore rejects inconsistent commitment totals, and feasibility rejects non-finite values.

- [ ] **Step 5: Run focused suites and typecheck**

```bash
node --experimental-strip-types --test tests/development-feasibility.test.ts tests/developer-market.test.ts tests/development-integration.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/simulation/development tests/developer-market.test.ts tests/development-integration.test.ts
git commit -m "test: harden developer market invariants"
```

---

### Task 8: Full regression, build, smoke, and release evidence

**Files:**
- Modify only if a verified regression requires a targeted fix.
- Optional docs update: `README.md` if it contains a phase/version feature list that would otherwise become incorrect.

**Interfaces:**
- Produces verified release evidence only; no new feature surface.

- [ ] **Step 1: Run the complete unit/integration suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Run strict typecheck**

```bash
npm run typecheck
```

Expected: PASS with zero TypeScript errors.

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: PASS and `dist/` generated.

- [ ] **Step 4: Run Phase 6 smoke regression**

```bash
npm run test:smoke
```

Expected: PASS. The development subsystem must not break the existing economy/traffic/service/transit smoke path.

- [ ] **Step 5: Run deterministic continuation test three times**

```bash
for i in 1 2 3; do node --experimental-strip-types --test tests/save-v7.test.ts tests/development-integration.test.ts || exit 1; done
```

Expected: all three runs PASS with no order-dependent flakes.

- [ ] **Step 6: Inspect the final diff for scope creep**

```bash
git diff --stat <implementation-base>...HEAD
git diff <implementation-base>...HEAD -- src/simulation/development src/simulation/buildings/BuildingSystem.ts src/simulation/core/SimulationCore.ts src/save src/data/buildings.ts package.json tests
```

Confirm no banks, land auctions, player-facing density UI, speculative land ownership, or unrelated refactors were introduced.

- [ ] **Step 7: Commit any final documentation-only correction**

```bash
git add README.md docs
# Only if something actually changed:
git commit -m "docs: document developer pro forma simulation"
```

- [ ] **Step 8: Verification gate**

Before claiming completion, invoke `superpowers:verification-before-completion` and cite fresh command output for tests, typecheck, build, and smoke.
