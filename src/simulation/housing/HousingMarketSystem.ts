import { getBuildingDefinition } from '../../data/buildings.ts';
import { HOUSEHOLD_WAGE_BY_ARCHETYPE, HOUSING_CADENCE, HOUSING_CONFIG, MIGRANT_ARCHETYPES } from '../../data/housing.ts';
import { clamp, clamp01 } from '../core/types.ts';
import type { Firm } from '../economy/FirmSystem.ts';
import { HouseholdCohortSystem } from './HouseholdCohortSystem.ts';
import { HouseholdIncomeSystem } from './HouseholdIncomeSystem.ts';
import { HousingChoiceSystem } from './HousingChoiceSystem.ts';
import { HousingSupplySystem } from './HousingSupplySystem.ts';
import type {
  HouseholdAffordabilityState,
  HouseholdCohort,
  HouseholdTravelDemand,
  HousingBuildingConditions,
  HousingCandidate,
  HousingChoiceResult,
  HousingMarketSnapshot,
  HousingMarketStateSnapshot,
  HousingMarketTickInput,
  MortgageProxy,
} from './HousingTypes.ts';

type MutableHousehold = { -readonly [K in keyof HouseholdCohort]: HouseholdCohort[K] };

function cloneHousehold(household: HouseholdCohort): MutableHousehold {
  return {
    ...household,
    employerFirmIds: [...household.employerFirmIds],
    mortgage: household.mortgage ? { ...household.mortgage } : null,
    preferences: { ...household.preferences },
  } as MutableHousehold;
}

function burdenState(burden: number): HouseholdAffordabilityState {
  if (burden < HOUSING_CONFIG.comfortableBurden) return 'comfortable';
  if (burden < HOUSING_CONFIG.manageableBurden) return 'manageable';
  if (burden < HOUSING_CONFIG.severeBurden) return 'stressed';
  return 'severe';
}

function weightedMedian(values: readonly { value: number; weight: number }[]): number {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((a, b) => a.value - b.value);
  const total = ordered.reduce((sum, item) => sum + item.weight, 0);
  let cumulative = 0;
  for (const item of ordered) {
    cumulative += item.weight;
    if (cumulative * 2 >= total) return item.value;
  }
  return ordered[ordered.length - 1]!.value;
}

function densityForDefinition(definitionId: string): number {
  const intensity = getBuildingDefinition(definitionId).intensity;
  return intensity === 'low' ? 0.3 : intensity === 'medium' ? 0.6 : 0.9;
}

export class HousingMarketSystem {
  readonly households = new HouseholdCohortSystem();
  readonly supply = new HousingSupplySystem();
  readonly income = new HouseholdIncomeSystem();
  readonly choice = new HousingChoiceSystem();
  private nextMigrantArchetype = 0;
  private cumulativeInMigration = 0;
  private cumulativeOutMigration = 0;
  private conditionsByBuilding: Readonly<Record<string, HousingBuildingConditions>> = Object.freeze({});

  tick(input: HousingMarketTickInput): HousingMarketSnapshot {
    if (!Number.isInteger(input.tick) || input.tick < 0) throw new Error('housing tick must be a non-negative integer');
    if (!Number.isFinite(input.marketInterestRate) || input.marketInterestRate < 0) throw new Error('housing market interest rate must be non-negative and finite');
    if (!Number.isFinite(input.employmentVacancies) || input.employmentVacancies < 0) throw new Error('employmentVacancies must be non-negative and finite');

    if (input.tick % HOUSING_CADENCE.conditions === 0) this.updateConditions(input);
    if (input.tick % HOUSING_CADENCE.economics === 0) this.updateHouseholdEconomics(input);
    if (input.tick % HOUSING_CADENCE.market === 0) this.clearMarket(input);
    return this.snapshot();
  }

  population(): number { return this.households.residentPopulation(); }

  travelDemand(firms: readonly Firm[]): HouseholdTravelDemand[] {
    const firmsById = new Map(firms.map((firm) => [firm.id, firm] as const));
    return this.households.list()
      .filter((household) => household.buildingId !== null)
      .map((household): HouseholdTravelDemand => {
        const employerBuildings = household.employerFirmIds
          .map((firmId) => firmsById.get(firmId)?.buildingId)
          .filter((buildingId): buildingId is string => buildingId !== undefined)
          .sort();
        const commuterWeight = household.employedWorkers * household.weight;
        const shoppingWeight = Math.max(0, Math.round(household.householdSize * household.weight * 0.25));
        return Object.freeze({
          originBuildingId: household.buildingId!,
          ...(employerBuildings[0] ? { destinationBuildingId: employerBuildings[0] } : {}),
          commuterWeight,
          shoppingWeight,
        });
      })
      .filter((item) => item.commuterWeight > 0 || item.shoppingWeight > 0)
      .sort((a, b) => a.originBuildingId.localeCompare(b.originBuildingId) || (a.destinationBuildingId ?? '').localeCompare(b.destinationBuildingId ?? ''));
  }

  snapshot(): HousingMarketSnapshot {
    const households = this.households.list();
    const ledgers = this.supply.list();
    const representedHouseholds = households.reduce((sum, household) => sum + household.weight, 0);
    const renterHouseholds = households.filter((household) => household.tenure === 'renter').reduce((sum, household) => sum + household.weight, 0);
    const ownerHouseholds = households.filter((household) => household.tenure === 'owner').reduce((sum, household) => sum + household.weight, 0);
    const searchingHouseholds = households.filter((household) => household.searchState === 'searching').reduce((sum, household) => sum + household.weight, 0);
    const displacedHouseholds = households.filter((household) => household.displacementState === 'displaced').reduce((sum, household) => sum + household.weight, 0);
    const unhousedHouseholds = households.filter((household) => household.displacementState === 'unhoused').reduce((sum, household) => sum + household.weight, 0);
    const rentalUnits = ledgers.reduce((sum, ledger) => sum + ledger.rentalProductUnits, 0);
    const vacantRental = ledgers.reduce((sum, ledger) => sum + ledger.vacantRentableUnits, 0);
    const saleUnits = ledgers.reduce((sum, ledger) => sum + ledger.forSaleProductUnits, 0);
    const vacantSale = ledgers.reduce((sum, ledger) => sum + ledger.vacantForSaleUnits, 0);
    const burden = (state: HouseholdAffordabilityState) => households.filter((household) => household.affordabilityState === state).reduce((sum, household) => sum + household.weight, 0);
    const overcrowdedHouseholds = households.filter((household) => {
      if (!household.buildingId) return false;
      const ledger = this.supply.get(household.buildingId);
      return !!ledger && ledger.residentLoad > ledger.residentCapacity;
    }).reduce((sum, household) => sum + household.weight, 0);
    const medianSalePrice = weightedMedian(ledgers.filter((ledger) => ledger.forSaleProductUnits > 0).map((ledger) => ({ value: ledger.estimatedSalePrice, weight: ledger.forSaleProductUnits })));
    const ownershipQualifiedSearchers = households.filter((household) => household.searchState === 'searching').reduce((sum, household) => sum + (medianSalePrice > 0 && this.choice.quoteMortgage(household, 0.05, medianSalePrice).eligible ? household.weight : 0), 0);

    return Object.freeze({
      population: this.population(),
      representedHouseholds,
      renterHouseholds,
      ownerHouseholds,
      searchingHouseholds,
      displacedHouseholds,
      unhousedHouseholds,
      rentalVacancyRate: rentalUnits === 0 ? 0 : vacantRental / rentalUnits,
      forSaleVacancyRate: saleUnits === 0 ? 0 : vacantSale / saleUnits,
      medianAskingRent: weightedMedian(ledgers.filter((ledger) => ledger.rentalProductUnits > 0).map((ledger) => ({ value: ledger.askingRent, weight: ledger.rentalProductUnits }))),
      medianEffectiveRent: weightedMedian(ledgers.filter((ledger) => ledger.rentalProductUnits > 0).map((ledger) => ({ value: ledger.effectiveRent, weight: ledger.rentalProductUnits }))),
      medianSalePrice,
      comfortableHouseholds: burden('comfortable'),
      manageableHouseholds: burden('manageable'),
      stressedHouseholds: burden('stressed'),
      severeBurdenHouseholds: burden('severe'),
      overcrowdedHouseholds,
      inMigrationHouseholds: this.cumulativeInMigration,
      outMigrationHouseholds: this.cumulativeOutMigration,
      turnover: ledgers.reduce((sum, ledger) => sum + ledger.turnover, 0),
      ownershipQualifiedSearchers,
      redevelopmentPressure: ledgers.length === 0 ? 0 : ledgers.reduce((sum, ledger) => sum + ledger.redevelopmentPressure, 0) / ledgers.length,
    });
  }

  snapshotState(): HousingMarketStateSnapshot {
    return Object.freeze({
      households: this.households.snapshotState(),
      supply: this.supply.snapshotState(),
      nextMigrantArchetype: this.nextMigrantArchetype,
      cumulativeInMigration: this.cumulativeInMigration,
      cumulativeOutMigration: this.cumulativeOutMigration,
    });
  }

  restoreState(state: HousingMarketStateSnapshot): void {
    if (!state || typeof state !== 'object') throw new Error('housing market state must be an object');
    for (const [name, value] of [
      ['nextMigrantArchetype', state.nextMigrantArchetype],
      ['cumulativeInMigration', state.cumulativeInMigration],
      ['cumulativeOutMigration', state.cumulativeOutMigration],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
    }
    const nextHouseholds = new HouseholdCohortSystem();
    const nextSupply = new HousingSupplySystem();
    nextHouseholds.restoreState(state.households);
    nextSupply.restoreState(state.supply);
    this.households.restoreState(nextHouseholds.snapshotState());
    this.supply.restoreState(nextSupply.snapshotState());
    this.nextMigrantArchetype = state.nextMigrantArchetype;
    this.cumulativeInMigration = state.cumulativeInMigration;
    this.cumulativeOutMigration = state.cumulativeOutMigration;
  }

  private updateConditions(input: HousingMarketTickInput): void {
    this.supply.syncBuildings(input.buildings, input.tick);
    this.conditionsByBuilding = Object.freeze({ ...input.conditionsByBuilding });
    for (const ledger of this.supply.list()) {
      const condition = input.conditionsByBuilding[ledger.buildingId];
      if (!condition) continue;
      this.supply.updateMarketState(ledger.buildingId, {
        quality: clamp01(condition.quality),
        accessibility: clamp01(condition.accessibility),
        habitability: clamp01(condition.habitability),
        lastUpdatedTick: input.tick,
      });
    }
  }

  private updateHouseholdEconomics(input: HousingMarketTickInput): void {
    this.income.reconcile(this.households, input.firms);
    const state = this.households.snapshotState();
    const households = state.households.map(cloneHousehold);
    for (const household of households) {
      if (household.mortgage) {
        const monthlyRate = household.mortgage.annualRate / 12;
        const interest = household.mortgage.remainingPrincipal * monthlyRate;
        const principalPaid = Math.max(0, household.mortgage.scheduledPayment - interest);
        household.mortgage = { ...household.mortgage, remainingPrincipal: Math.max(0, household.mortgage.remainingPrincipal - principalPaid) };
        household.housingCost = household.mortgage.scheduledPayment;
      }
      const surplus = Math.max(0, household.disposableHousingIncome - household.housingCost);
      household.liquidSavings = Math.min(household.liquidSavings + surplus * HOUSING_CONFIG.savingsRate, HOUSING_CONFIG.savingsCapMonths * Math.max(1, household.grossIncome));
      household.housingCostBurden = household.housingCost <= 0 ? 0 : household.housingCost / Math.max(1, household.grossIncome);
      household.affordabilityState = burdenState(household.housingCostBurden);
      household.arrearsCycles = household.housingCost > household.disposableHousingIncome ? household.arrearsCycles + 1 : 0;
    }
    this.households.restoreState({ households, nextId: state.nextId });
  }

  private clearMarket(input: HousingMarketTickInput): void {
    this.advanceSearchStates();
    this.createInboundMigrants(input);
    this.updatePrices(input);
    this.matchSearchers(input);
    this.processOutMigration();
    this.households.mergeCompatible();
  }

  private advanceSearchStates(): void {
    const state = this.households.snapshotState();
    const households = state.households.map(cloneHousehold);
    for (const household of households) {
      if (household.buildingId) household.residenceCycles += 1;
      if (household.affordabilityState === 'severe') {
        household.severeBurdenCycles += 1;
        household.searchState = 'searching';
        household.lastMoveReason = household.lastMoveReason ?? 'housing-burden';
      } else household.severeBurdenCycles = 0;
      if (!household.buildingId) {
        household.searchState = 'searching';
        household.unhousedCycles += 1;
        household.displacementState = 'unhoused';
      } else household.unhousedCycles = 0;
    }
    this.households.restoreState({ households, nextId: state.nextId });
  }

  private createInboundMigrants(input: HousingMarketTickInput): void {
    const vacantUnits = this.supply.list().reduce((sum, ledger) => sum + ledger.vacantRentableUnits + ledger.vacantForSaleUnits, 0);
    const count = Math.min(HOUSING_CONFIG.maxInboundHouseholdsPerMarketCycle, Math.floor(input.employmentVacancies), vacantUnits);
    if (count <= 0) return;
    const active = input.firms.filter((firm) => firm.status === 'operating' || firm.status === 'distressed');
    const averageWage = active.length === 0
      ? HOUSEHOLD_WAGE_BY_ARCHETYPE.retail_local
      : active.reduce((sum, firm) => sum + HOUSEHOLD_WAGE_BY_ARCHETYPE[firm.archetype], 0) / active.length;
    for (let index = 0; index < count; index++) {
      const archetype = MIGRANT_ARCHETYPES[this.nextMigrantArchetype % MIGRANT_ARCHETYPES.length]!;
      this.nextMigrantArchetype += 1;
      const grossIncome = Math.max(HOUSING_CONFIG.unemployedWorkerFallbackIncome, averageWage) * archetype.workers;
      this.households.create({
        weight: 1,
        householdSize: archetype.householdSize,
        workers: archetype.workers,
        grossIncome,
        disposableHousingIncome: grossIncome * HOUSING_CONFIG.disposableIncomeRatio,
        employmentStability: active.length === 0 ? 0.25 : active.reduce((sum, firm) => sum + firm.cashHealth, 0) / active.length,
        tenure: 'seeking',
        buildingId: null,
        unitRequirement: 1,
        vehicleAccess: archetype.vehicleAccess,
        liquidSavings: grossIncome * archetype.savingsMonths,
        housingCost: 0,
      }, input.tick);
      this.cumulativeInMigration += 1;
    }
  }

  private updatePrices(input: HousingMarketTickInput): void {
    const searchers = this.households.list().filter((household) => household.searchState === 'searching');
    for (const ledger of this.supply.list()) {
      const qualifiedRenters = searchers.filter((household) => ledger.rentalProductUnits > 0 && ledger.askingRent / Math.max(1, household.grossIncome) <= HOUSING_CONFIG.maxNewMoveBurden);
      const qualifiedRentalApplicants = qualifiedRenters.reduce((sum, household) => sum + household.weight, 0);
      const medianQualifiedIncome = weightedMedian(qualifiedRenters.map((household) => ({ value: household.grossIncome, weight: household.weight })));
      const qualifiedBuyers = searchers.filter((household) => ledger.forSaleProductUnits > 0 && this.choice.quoteMortgage(household, input.marketInterestRate, ledger.estimatedSalePrice).eligible);
      const qualifiedBuyerCount = qualifiedBuyers.reduce((sum, household) => sum + household.weight, 0);
      const occupancyRate = ledger.rentalProductUnits === 0 ? 0 : ledger.renterOccupiedUnits / ledger.rentalProductUnits;
      const vacancyRate = ledger.rentalProductUnits === 0 ? 0 : ledger.vacantRentableUnits / ledger.rentalProductUnits;
      const occupancyPressure = clamp((occupancyRate - HOUSING_CONFIG.targetOccupancy) / 0.10, -1, 1);
      const applicantPressure = clamp(qualifiedRentalApplicants / Math.max(1, ledger.vacantRentableUnits) - 1, -1, 1);
      const incomeSupport = clamp(medianQualifiedIncome / Math.max(1, ledger.askingRent * 3) - 1, -0.5, 0.5);
      const raw = 0.012 * occupancyPressure + 0.010 * applicantPressure + 0.004 * incomeSupport
        + 0.003 * (ledger.quality - 0.70) + 0.003 * (ledger.accessibility - 0.70) - 0.020 * (1 - ledger.habitability);
      let rentChange = ledger.rentalProductUnits === 0 ? 0 : clamp(raw, -HOUSING_CONFIG.maxNormalRentChange, HOUSING_CONFIG.maxNormalRentChange);
      if (ledger.rentalProductUnits > 0 && vacancyRate >= HOUSING_CONFIG.severeVacancyRate) rentChange = Math.min(rentChange, -HOUSING_CONFIG.maxSevereVacancyRentCut);
      const priorRent = ledger.askingRent;
      const askingRent = priorRent * (1 + rentChange);
      const effectiveRent = askingRent * (1 - clamp((vacancyRate - 0.08) * 0.30, 0, 0.12));
      const buyerPressure = qualifiedBuyerCount / Math.max(1, ledger.vacantForSaleUnits);
      const anchor = effectiveRent * HOUSING_CONFIG.salePriceToEffectiveRent;
      const targetSalePrice = anchor
        * clamp(0.85 + ledger.quality * 0.30, 0.85, 1.15)
        * clamp(0.90 + ledger.accessibility * 0.20, 0.90, 1.10)
        * clamp(0.95 + buyerPressure * 0.05, 0.90, 1.10)
        * clamp(1.10 - input.marketInterestRate * 4, 0.65, 1.10);
      const priceChange = ledger.forSaleProductUnits === 0 || ledger.estimatedSalePrice <= 0
        ? 0
        : clamp(targetSalePrice / ledger.estimatedSalePrice - 1, -HOUSING_CONFIG.maxSalePriceChange, HOUSING_CONFIG.maxSalePriceChange);
      const estimatedSalePrice = ledger.estimatedSalePrice * (1 + priceChange);
      const definition = getBuildingDefinition(ledger.definitionId);
      const annualNoi = effectiveRent * ledger.renterOccupiedUnits * 12 * (1 - definition.operatingExpenseRatio);
      const existingUseValue = annualNoi / Math.max(0.045, definition.baseCapRate);
      this.supply.updateMarketState(ledger.buildingId, {
        priorRent, askingRent, effectiveRent, rentChange,
        askingSalePrice: estimatedSalePrice, estimatedSalePrice, priceChange,
        qualifiedRentalApplicants, qualifiedBuyerPressure: buyerPressure,
        vacancyDuration: vacancyRate > 0 ? ledger.vacancyDuration + 1 : 0,
        existingUseValue, lastUpdatedTick: input.tick,
      });
    }
  }

  private matchSearchers(input: HousingMarketTickInput): void {
    const searchers = this.households.list()
      .filter((household) => household.searchState === 'searching')
      .sort((a, b) => this.searchPriority(a) - this.searchPriority(b) || a.id.localeCompare(b.id));
    for (const snapshotHousehold of searchers) {
      const current = this.households.get(snapshotHousehold.id);
      if (!current || current.searchState !== 'searching') continue;
      const ranked = this.choice.rankCandidates(current, this.candidatesFor(current), {
        marketInterestRate: input.marketInterestRate,
        voluntaryMove: current.buildingId !== null,
      });
      const best = ranked.find((result) => result.eligible);
      if (!best) continue;
      if (current.buildingId) {
        const currentCandidate = this.candidateForCurrent(current);
        if (currentCandidate) {
          const currentResult = this.choice.evaluateCandidate(current, currentCandidate, { marketInterestRate: input.marketInterestRate, voluntaryMove: false });
          if (best.totalUtility - currentResult.totalUtility <= current.moveFriction) continue;
        }
      }
      const targetLedger = this.supply.get(best.buildingId);
      if (!targetLedger) continue;
      const availableUnits = best.tenure === 'renter' ? targetLedger.vacantRentableUnits : targetLedger.vacantForSaleUnits;
      const maxWeight = Math.floor(availableUnits / Math.max(1, current.unitRequirement));
      if (maxWeight <= 0) continue;
      let mover = current;
      if (current.weight > maxWeight) mover = this.households.split(current.id, maxWeight, 'housing-capacity').branch;
      this.moveHousehold(mover, best, input.tick, input.marketInterestRate);
    }
  }

  private moveHousehold(household: HouseholdCohort, result: HousingChoiceResult, tick: number, marketInterestRate: number): void {
    const units = household.unitRequirement * household.weight;
    const residents = household.householdSize * household.weight;
    if (household.buildingId && (household.tenure === 'renter' || household.tenure === 'owner')) this.supply.vacate(household.buildingId, household.tenure, units, residents);
    this.supply.occupy(result.buildingId, result.tenure, units, residents);
    let mortgage: MortgageProxy | null = null;
    if (result.tenure === 'owner' && result.mortgage) {
      mortgage = {
        originalPrincipal: result.mortgage.principal,
        remainingPrincipal: result.mortgage.principal,
        annualRate: marketInterestRate,
        scheduledPayment: result.mortgage.scheduledPayment,
        purchaseTick: tick,
      };
    }
    this.households.assignResidence(household.id, result.buildingId, result.tenure, result.housingCost, mortgage, 'market-move');
    if (result.tenure === 'owner' && result.mortgage) {
      const state = this.households.snapshotState();
      const households = state.households.map(cloneHousehold);
      const target = households.find((item) => item.id === household.id)!;
      target.liquidSavings = Math.max(0, target.liquidSavings - result.mortgage.requiredDownPayment - result.mortgage.transactionReserve);
      this.households.restoreState({ households, nextId: state.nextId });
    }
  }

  private processOutMigration(): void {
    const candidates = this.households.list().filter((household) =>
      (!household.buildingId && household.unhousedCycles >= HOUSING_CONFIG.outMigrationUnhousedCycles)
      || (household.buildingId !== null && household.severeBurdenCycles >= HOUSING_CONFIG.outMigrationSevereBurdenCycles));
    for (const household of candidates.sort((a, b) => a.id.localeCompare(b.id))) {
      if (household.buildingId && (household.tenure === 'renter' || household.tenure === 'owner')) {
        const ledger = this.supply.get(household.buildingId);
        if (ledger) this.supply.vacate(household.buildingId, household.tenure, household.unitRequirement * household.weight, household.householdSize * household.weight);
      }
      this.cumulativeOutMigration += household.weight;
      this.households.remove(household.id);
    }
  }

  private candidatesFor(household: HouseholdCohort): HousingCandidate[] {
    const currentLedger = household.buildingId ? this.supply.get(household.buildingId) : undefined;
    const ledgers = this.supply.list().slice().sort((a, b) => {
      if (currentLedger) {
        const distanceA = Math.abs(a.x - currentLedger.x) + Math.abs(a.y - currentLedger.y);
        const distanceB = Math.abs(b.x - currentLedger.x) + Math.abs(b.y - currentLedger.y);
        if (distanceA !== distanceB) return distanceA - distanceB;
      }
      return b.accessibility - a.accessibility || a.buildingId.localeCompare(b.buildingId);
    });
    const candidates: HousingCandidate[] = [];
    for (const ledger of ledgers) {
      if (ledger.vacantRentableUnits > 0) candidates.push(this.toCandidate(ledger, 'renter'));
      if (ledger.vacantForSaleUnits > 0) candidates.push(this.toCandidate(ledger, 'owner'));
      if (candidates.length >= HOUSING_CONFIG.maxCandidateBuildings) break;
    }
    return candidates.slice(0, HOUSING_CONFIG.maxCandidateBuildings);
  }

  private candidateForCurrent(household: HouseholdCohort): HousingCandidate | null {
    if (!household.buildingId || (household.tenure !== 'renter' && household.tenure !== 'owner')) return null;
    const ledger = this.supply.get(household.buildingId);
    if (!ledger) return null;
    const candidate = this.toCandidate(ledger, household.tenure);
    return { ...candidate, availableUnits: Math.max(household.unitRequirement, candidate.availableUnits) };
  }

  private toCandidate(ledger: ReturnType<HousingSupplySystem['list']>[number], tenure: 'renter' | 'owner'): HousingCandidate {
    const condition = this.conditionsByBuilding[ledger.buildingId];
    return {
      buildingId: ledger.buildingId,
      tenure,
      housingCost: tenure === 'renter' ? ledger.effectiveRent : 0,
      askingPrice: tenure === 'owner' ? ledger.estimatedSalePrice : 0,
      availableUnits: tenure === 'renter' ? ledger.vacantRentableUnits : ledger.vacantForSaleUnits,
      residentsPerUnit: ledger.housingUnits === 0 ? 0 : ledger.residentCapacity / ledger.housingUnits,
      accessibility: ledger.accessibility,
      services: clamp01(condition?.services ?? ledger.quality),
      neighborhood: clamp01(condition?.neighborhood ?? ledger.quality),
      quality: ledger.quality,
      density: densityForDefinition(ledger.definitionId),
      overcrowdingRatio: clamp01(Math.max(0, ledger.residentLoad / Math.max(1, ledger.residentCapacity) - 1)),
      displacementRisk: clamp01(ledger.displacementRiskHouseholds / Math.max(1, ledger.renterOccupiedUnits + ledger.ownerOccupiedUnits)),
    };
  }

  private searchPriority(household: HouseholdCohort): number {
    if (household.displacementState === 'unhoused' || household.displacementState === 'displaced') return 0;
    if (household.affordabilityState === 'severe') return 1;
    return 2;
  }
}
