import {
  DESIRED_TENURE_SHARES,
  HOUSING_BAND_PROFILES,
  HOUSING_BANDS,
  HOUSING_TENURES,
  housingBurden,
  housingCandidateScore,
  type HousingIncomeBand,
  type HousingTenure,
} from './HousingEconomics.ts';
import type { HousingTenureOption } from './HousingTenureSystem.ts';

const MAXIMUM_VOLUNTARY_TURNOVER_PER_CYCLE = 0.02;
const MINIMUM_MOVE_SCORE_IMPROVEMENT = 0.10;
const EPSILON = 1e-9;

export type HousingCohortAllocation = Readonly<{
  buildingId: string;
  band: HousingIncomeBand;
  tenure: HousingTenure;
  residents: number;
}>;

export type UnplacedHousingCohort = Readonly<{
  band: HousingIncomeBand;
  tenurePreference: HousingTenure;
  residents: number;
  displaced: boolean;
  displacedFromBuildingId?: string;
}>;

export type HousingRelocationTotals = Readonly<{
  movedResidents: number;
  displacedResidents: number;
  rehousedDisplacedResidents: number;
  failedSearchResidents: number;
}>;

export type HousingRelocationState = Readonly<{
  allocations: readonly HousingCohortAllocation[];
  unplaced: readonly UnplacedHousingCohort[];
  totals: HousingRelocationTotals;
}>;

export type HousingRelocationBandSnapshot = Readonly<{
  band: HousingIncomeBand;
  housedResidents: number;
  unplacedResidents: number;
  renterResidents: number;
  ownerResidents: number;
  costBurdenedResidents: number;
}>;

export type HousingBuildingRelocationSnapshot = Readonly<{
  buildingId: string;
  assignedResidents: number;
  renterResidents: number;
  ownerResidents: number;
  rentalOccupancyRate: number;
  ownershipOccupancyRate: number;
  costBurdenedResidents: number;
  movedInResidentsThisCycle: number;
  movedOutResidentsThisCycle: number;
  displacedResidentsThisCycle: number;
}>;

export type HousingRelocationSnapshot = Readonly<{
  population: number;
  housedResidents: number;
  unplacedResidents: number;
  renterResidents: number;
  ownerResidents: number;
  renterShare: number;
  ownerShare: number;
  rentalVacancyRate: number;
  ownershipVacancyRate: number;
  movedResidentsThisCycle: number;
  displacedResidentsThisCycle: number;
  rehousedDisplacedResidentsThisCycle: number;
  failedSearchResidentsThisCycle: number;
  costBurdenedResidents: number;
  totals: HousingRelocationTotals;
  byBand: Readonly<Record<HousingIncomeBand, HousingRelocationBandSnapshot>>;
  byBuilding: Readonly<Record<string, HousingBuildingRelocationSnapshot>>;
}>;

export type HousingReconcileInput = Readonly<{
  population: number;
  options: readonly HousingTenureOption[];
  allowVoluntaryMoves?: boolean;
}>;

type CycleMetrics = {
  moved: number;
  displaced: number;
  rehoused: number;
  failed: number;
  movedInByBuilding: Map<string, number>;
  movedOutByBuilding: Map<string, number>;
  displacedByBuilding: Map<string, number>;
};

type QueueItem = Readonly<{
  cohort: UnplacedHousingCohort;
  countFailure: boolean;
  countMoveOnPlacement: boolean;
}>;

function finiteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
}

function optionKey(buildingId: string, tenure: HousingTenure): string {
  return `${buildingId}|${tenure}`;
}

function allocationKey(item: Pick<HousingCohortAllocation, 'buildingId' | 'band' | 'tenure'>): string {
  return `${item.buildingId}|${item.band}|${item.tenure}`;
}

function unplacedKey(item: UnplacedHousingCohort): string {
  return `${item.band}|${item.tenurePreference}|${item.displaced ? '1' : '0'}|${item.displacedFromBuildingId ?? ''}`;
}

function tenureRank(tenure: HousingTenure): number {
  return tenure === 'renter' ? 0 : 1;
}

function validateOptions(options: readonly HousingTenureOption[]): readonly HousingTenureOption[] {
  const sorted = options.slice().sort((a, b) =>
    a.buildingId.localeCompare(b.buildingId) || tenureRank(a.tenure) - tenureRank(b.tenure));
  const seen = new Set<string>();
  for (const option of sorted) {
    if (option.buildingId.length === 0) throw new Error('buildingId must be non-empty');
    finiteNonNegative('capacity', option.capacity);
    finiteNonNegative('monthlyCost', option.monthlyCost);
    const key = optionKey(option.buildingId, option.tenure);
    if (seen.has(key)) throw new Error(`duplicate housing tenure option: ${key}`);
    seen.add(key);
    for (const [name, value] of Object.entries({
      personAccessibility: option.personAccessibility,
      serviceQuality: option.serviceQuality,
      neighborhoodQuality: option.neighborhoodQuality,
      utilityRatio: option.utilityRatio,
    })) {
      if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
    }
  }
  return sorted;
}

function emptyTotals(): HousingRelocationTotals {
  return Object.freeze({ movedResidents: 0, displacedResidents: 0, rehousedDisplacedResidents: 0, failedSearchResidents: 0 });
}

function emptyCycle(): CycleMetrics {
  return {
    moved: 0,
    displaced: 0,
    rehoused: 0,
    failed: 0,
    movedInByBuilding: new Map(),
    movedOutByBuilding: new Map(),
    displacedByBuilding: new Map(),
  };
}

function cloneCycle(cycle: CycleMetrics): CycleMetrics {
  return {
    moved: cycle.moved,
    displaced: cycle.displaced,
    rehoused: cycle.rehoused,
    failed: cycle.failed,
    movedInByBuilding: new Map(cycle.movedInByBuilding),
    movedOutByBuilding: new Map(cycle.movedOutByBuilding),
    displacedByBuilding: new Map(cycle.displacedByBuilding),
  };
}

function addMetric(map: Map<string, number>, key: string, amount: number): void {
  if (amount <= 0) return;
  map.set(key, (map.get(key) ?? 0) + amount);
}

function cloneUnplaced(item: UnplacedHousingCohort): UnplacedHousingCohort {
  return Object.freeze({
    band: item.band,
    tenurePreference: item.tenurePreference,
    residents: item.residents,
    displaced: item.displaced,
    ...(item.displacedFromBuildingId ? { displacedFromBuildingId: item.displacedFromBuildingId } : {}),
  });
}

function mergeAllocations(items: readonly HousingCohortAllocation[]): HousingCohortAllocation[] {
  const merged = new Map<string, HousingCohortAllocation>();
  for (const item of items) {
    if (item.residents <= EPSILON) continue;
    const key = allocationKey(item);
    const prior = merged.get(key);
    merged.set(key, Object.freeze({ ...item, residents: (prior?.residents ?? 0) + item.residents }));
  }
  return [...merged.values()].sort((a, b) =>
    a.buildingId.localeCompare(b.buildingId)
    || a.band.localeCompare(b.band)
    || tenureRank(a.tenure) - tenureRank(b.tenure));
}

function mergeUnplaced(items: readonly UnplacedHousingCohort[]): UnplacedHousingCohort[] {
  const merged = new Map<string, UnplacedHousingCohort>();
  for (const item of items) {
    if (item.residents <= EPSILON) continue;
    const key = unplacedKey(item);
    const prior = merged.get(key);
    merged.set(key, cloneUnplaced({ ...item, residents: (prior?.residents ?? 0) + item.residents }));
  }
  return [...merged.values()].sort((a, b) =>
    Number(b.displaced) - Number(a.displaced)
    || a.band.localeCompare(b.band)
    || tenureRank(a.tenurePreference) - tenureRank(b.tenurePreference)
    || (a.displacedFromBuildingId ?? '').localeCompare(b.displacedFromBuildingId ?? ''));
}

function entrantCohorts(population: number): UnplacedHousingCohort[] {
  if (population <= EPSILON) return [];
  const upper = population * HOUSING_BAND_PROFILES.upper.share;
  const middle = population * HOUSING_BAND_PROFILES.middle.share;
  const byBand: Record<HousingIncomeBand, number> = {
    upper,
    middle,
    lower: Math.max(0, population - upper - middle),
  };
  const result: UnplacedHousingCohort[] = [];
  for (const band of HOUSING_BANDS) {
    const residents = byBand[band];
    const owner = residents * DESIRED_TENURE_SHARES[band].owner;
    const renter = Math.max(0, residents - owner);
    if (renter > EPSILON) result.push(Object.freeze({ band, tenurePreference: 'renter', residents: renter, displaced: false }));
    if (owner > EPSILON) result.push(Object.freeze({ band, tenurePreference: 'owner', residents: owner, displaced: false }));
  }
  return result;
}

function optionScore(option: HousingTenureOption, band: HousingIncomeBand, preferredTenure: HousingTenure): number {
  return housingCandidateScore(option.monthlyCost, band, preferredTenure, option.tenure, option);
}

function rankedOptions(
  options: readonly HousingTenureOption[],
  band: HousingIncomeBand,
  preferredTenure: HousingTenure,
  excluded?: Readonly<{ buildingId: string; tenure: HousingTenure }>,
): HousingTenureOption[] {
  return options
    .filter((option) => !excluded || option.buildingId !== excluded.buildingId || option.tenure !== excluded.tenure)
    .slice()
    .sort((a, b) => {
      const scoreDifference = optionScore(b, band, preferredTenure) - optionScore(a, band, preferredTenure);
      return scoreDifference
        || a.monthlyCost - b.monthlyCost
        || a.buildingId.localeCompare(b.buildingId)
        || tenureRank(a.tenure) - tenureRank(b.tenure);
    });
}

export class HousingRelocationSystem {
  private allocations: HousingCohortAllocation[] = [];
  private unplaced: UnplacedHousingCohort[] = [];
  private totals: HousingRelocationTotals = emptyTotals();
  private latest: HousingRelocationSnapshot = this.buildSnapshot(0, [], emptyCycle());
  private initialized = false;
  private pendingCycle = emptyCycle();
  private latestCycle = emptyCycle();

  initialize(population: number, options: readonly HousingTenureOption[]): HousingRelocationSnapshot {
    finiteNonNegative('population', population);
    const validOptions = validateOptions(options);
    this.allocations = [];
    this.unplaced = entrantCohorts(population);
    this.totals = emptyTotals();
    this.pendingCycle = emptyCycle();
    this.latestCycle = emptyCycle();
    const cycle = emptyCycle();
    const queue = this.unplaced.map((cohort) => ({ cohort, countFailure: false, countMoveOnPlacement: false }));
    this.unplaced = [];
    this.placeQueue(queue, validOptions, cycle);
    this.allocations = mergeAllocations(this.allocations);
    this.unplaced = mergeUnplaced(this.unplaced);
    this.initialized = true;
    this.latest = this.buildSnapshot(population, validOptions, cycle);
    return this.snapshot();
  }

  reconcile(input: HousingReconcileInput): HousingRelocationSnapshot {
    finiteNonNegative('population', input.population);
    const options = validateOptions(input.options);
    if (!this.initialized) return this.initialize(input.population, options);

    const cycle = this.consumePendingCycle();
    const startHoused = this.allocations.reduce((sum, item) => sum + item.residents, 0);
    const baselineAllocations = this.allocations.map((item) => Object.freeze({ ...item }));

    this.reconcileOptionValidity(options);

    let represented = this.representedResidents();
    const newEntrants: UnplacedHousingCohort[] = [];
    if (input.population > represented + EPSILON) {
      newEntrants.push(...entrantCohorts(input.population - represented));
    } else if (input.population + EPSILON < represented) {
      this.contractPopulation(represented - input.population, options);
    }

    const queue: QueueItem[] = [
      ...this.unplaced.map((cohort) => Object.freeze({ cohort, countFailure: true, countMoveOnPlacement: cohort.displaced })),
      ...newEntrants.map((cohort) => Object.freeze({ cohort, countFailure: true, countMoveOnPlacement: false })),
    ];
    this.unplaced = [];
    this.placeQueue(queue, options, cycle);

    const movedSourceKeys = new Set<string>();
    this.processSeverelyBurdenedMovers(baselineAllocations, options, cycle, movedSourceKeys);
    if (input.allowVoluntaryMoves !== false) {
      const voluntaryBudget = Math.max(0, startHoused * MAXIMUM_VOLUNTARY_TURNOVER_PER_CYCLE);
      this.processVoluntaryMovers(baselineAllocations, options, cycle, movedSourceKeys, voluntaryBudget);
    }

    this.allocations = mergeAllocations(this.allocations);
    this.unplaced = mergeUnplaced(this.unplaced);
    represented = this.representedResidents();
    if (Math.abs(represented - input.population) > 1e-6) {
      throw new Error(`housing relocation resident conservation failed: ${represented} != ${input.population}`);
    }

    this.totals = Object.freeze({
      movedResidents: this.totals.movedResidents + cycle.moved,
      displacedResidents: this.totals.displacedResidents,
      rehousedDisplacedResidents: this.totals.rehousedDisplacedResidents + cycle.rehoused,
      failedSearchResidents: this.totals.failedSearchResidents + cycle.failed,
    });
    this.latestCycle = cloneCycle(cycle);
    this.latest = this.buildSnapshot(input.population, options, this.latestCycle);
    return this.snapshot();
  }

  displaceBuilding(buildingId: string): number {
    if (buildingId.length === 0) throw new Error('buildingId must be non-empty');
    const displaced = this.allocations.filter((item) => item.buildingId === buildingId);
    if (displaced.length === 0) return 0;
    this.allocations = this.allocations.filter((item) => item.buildingId !== buildingId);
    let residents = 0;
    const added: UnplacedHousingCohort[] = [];
    for (const allocation of displaced) {
      residents += allocation.residents;
      added.push(Object.freeze({
        band: allocation.band,
        tenurePreference: allocation.tenure,
        residents: allocation.residents,
        displaced: true,
        displacedFromBuildingId: buildingId,
      }));
    }
    this.unplaced = mergeUnplaced([...this.unplaced, ...added]);
    this.totals = Object.freeze({
      ...this.totals,
      displacedResidents: this.totals.displacedResidents + residents,
    });
    this.pendingCycle.displaced += residents;
    addMetric(this.pendingCycle.displacedByBuilding, buildingId, residents);
    addMetric(this.pendingCycle.movedOutByBuilding, buildingId, residents);
    return residents;
  }

  refreshSnapshot(population: number, options: readonly HousingTenureOption[]): HousingRelocationSnapshot {
    finiteNonNegative('population', population);
    const validOptions = validateOptions(options);
    if (!this.initialized) return this.initialize(population, validOptions);
    const represented = this.representedResidents();
    if (Math.abs(represented - population) > 1e-6) {
      throw new Error(`housing relocation resident conservation failed: ${represented} != ${population}`);
    }
    this.latest = this.buildSnapshot(population, validOptions, this.latestCycle);
    return this.snapshot();
  }

  snapshotState(): HousingRelocationState {
    return Object.freeze({
      allocations: Object.freeze(this.allocations.map((item) => Object.freeze({ ...item }))),
      unplaced: Object.freeze(this.unplaced.map(cloneUnplaced)),
      totals: Object.freeze({ ...this.totals }),
    });
  }

  restoreState(state: HousingRelocationState): HousingRelocationState {
    if (!state || typeof state !== 'object') throw new Error('housing relocation state must be an object');
    const allocationKeys = new Set<string>();
    const allocations: HousingCohortAllocation[] = [];
    for (const item of state.allocations) {
      this.validateBand(item.band);
      this.validateTenure(item.tenure);
      if (item.buildingId.length === 0) throw new Error('housing allocation buildingId must be non-empty');
      finiteNonNegative('housing allocation residents', item.residents);
      const key = allocationKey(item);
      if (allocationKeys.has(key)) throw new Error(`duplicate housing allocation: ${key}`);
      allocationKeys.add(key);
      allocations.push(Object.freeze({ ...item }));
    }
    const unplaced: UnplacedHousingCohort[] = [];
    for (const item of state.unplaced) {
      this.validateBand(item.band);
      this.validateTenure(item.tenurePreference);
      finiteNonNegative('unplaced residents', item.residents);
      if (item.displaced && !item.displacedFromBuildingId) throw new Error('displaced cohort must reference source building');
      unplaced.push(cloneUnplaced(item));
    }
    finiteNonNegative('movedResidents', state.totals.movedResidents);
    finiteNonNegative('displacedResidents', state.totals.displacedResidents);
    finiteNonNegative('rehousedDisplacedResidents', state.totals.rehousedDisplacedResidents);
    finiteNonNegative('failedSearchResidents', state.totals.failedSearchResidents);
    this.allocations = allocations;
    this.unplaced = mergeUnplaced(unplaced);
    this.totals = Object.freeze({ ...state.totals });
    this.initialized = true;
    this.pendingCycle = emptyCycle();
    this.latestCycle = emptyCycle();
    return this.snapshotState();
  }

  snapshot(): HousingRelocationSnapshot {
    return this.latest;
  }

  private placeQueue(queue: readonly QueueItem[], options: readonly HousingTenureOption[], cycle: CycleMetrics): void {
    const ordered = queue.slice().sort((a, b) =>
      Number(b.cohort.displaced) - Number(a.cohort.displaced)
      || a.cohort.band.localeCompare(b.cohort.band)
      || tenureRank(a.cohort.tenurePreference) - tenureRank(b.cohort.tenurePreference)
      || (a.cohort.displacedFromBuildingId ?? '').localeCompare(b.cohort.displacedFromBuildingId ?? ''));

    for (const item of ordered) {
      let remaining = item.cohort.residents;
      for (const option of rankedOptions(options, item.cohort.band, item.cohort.tenurePreference)) {
        if (remaining <= EPSILON) break;
        const vacancy = this.optionVacancy(option);
        if (vacancy <= EPSILON) continue;
        const assigned = Math.min(remaining, vacancy);
        this.addAllocation(option.buildingId, item.cohort.band, option.tenure, assigned);
        remaining -= assigned;
        if (item.cohort.displaced) {
          cycle.rehoused += assigned;
          if (item.countMoveOnPlacement) cycle.moved += assigned;
          addMetric(cycle.movedInByBuilding, option.buildingId, assigned);
        }
      }
      if (remaining > EPSILON) {
        this.unplaced.push(cloneUnplaced({ ...item.cohort, residents: remaining }));
        if (item.countFailure) cycle.failed += remaining;
      }
    }
  }

  private processSeverelyBurdenedMovers(
    baseline: readonly HousingCohortAllocation[],
    options: readonly HousingTenureOption[],
    cycle: CycleMetrics,
    movedSourceKeys: Set<string>,
  ): void {
    const optionMap = new Map(options.map((option) => [optionKey(option.buildingId, option.tenure), option] as const));
    const sorted = baseline.slice().sort((a, b) => allocationKey(a).localeCompare(allocationKey(b)));
    for (const original of sorted) {
      const sourceKey = allocationKey(original);
      const current = this.allocations.find((item) => allocationKey(item) === sourceKey);
      if (!current || current.residents <= EPSILON) continue;
      const currentOption = optionMap.get(optionKey(current.buildingId, current.tenure));
      if (!currentOption) continue;
      const profile = HOUSING_BAND_PROFILES[current.band];
      if (housingBurden(currentOption.monthlyCost, current.band) <= 2 * profile.maxHousingBurden) continue;
      const currentScore = optionScore(currentOption, current.band, current.tenure);
      const moved = this.moveAllocationToBetterOptions(current, options, currentScore, 0, current.residents, cycle);
      if (moved > EPSILON) movedSourceKeys.add(sourceKey);
    }
  }

  private processVoluntaryMovers(
    baseline: readonly HousingCohortAllocation[],
    options: readonly HousingTenureOption[],
    cycle: CycleMetrics,
    movedSourceKeys: ReadonlySet<string>,
    budget: number,
  ): void {
    if (budget <= EPSILON) return;
    const optionMap = new Map(options.map((option) => [optionKey(option.buildingId, option.tenure), option] as const));
    const candidates = baseline.slice().sort((a, b) => {
      const optionA = optionMap.get(optionKey(a.buildingId, a.tenure));
      const optionB = optionMap.get(optionKey(b.buildingId, b.tenure));
      const scoreA = optionA ? optionScore(optionA, a.band, a.tenure) : 1;
      const scoreB = optionB ? optionScore(optionB, b.band, b.tenure) : 1;
      return scoreA - scoreB || allocationKey(a).localeCompare(allocationKey(b));
    });
    let remainingBudget = budget;
    for (const original of candidates) {
      if (remainingBudget <= EPSILON) break;
      const sourceKey = allocationKey(original);
      if (movedSourceKeys.has(sourceKey)) continue;
      const current = this.allocations.find((item) => allocationKey(item) === sourceKey);
      if (!current || current.residents <= EPSILON) continue;
      const currentOption = optionMap.get(optionKey(current.buildingId, current.tenure));
      if (!currentOption) continue;
      const currentScore = optionScore(currentOption, current.band, current.tenure);
      const movable = Math.min(current.residents, remainingBudget);
      const moved = this.moveAllocationToBetterOptions(
        current,
        options,
        currentScore,
        MINIMUM_MOVE_SCORE_IMPROVEMENT,
        movable,
        cycle,
      );
      remainingBudget -= moved;
    }
  }

  private moveAllocationToBetterOptions(
    source: HousingCohortAllocation,
    options: readonly HousingTenureOption[],
    currentScore: number,
    requiredImprovement: number,
    maximumResidents: number,
    cycle: CycleMetrics,
  ): number {
    let remaining = maximumResidents;
    let moved = 0;
    const ranked = rankedOptions(options, source.band, source.tenure, source);
    for (const option of ranked) {
      if (remaining <= EPSILON) break;
      const score = optionScore(option, source.band, source.tenure);
      if (score + EPSILON < currentScore + requiredImprovement) continue;
      if (requiredImprovement === 0 && score <= currentScore + EPSILON) continue;
      const vacancy = this.optionVacancy(option);
      if (vacancy <= EPSILON) continue;
      const amount = Math.min(remaining, vacancy, this.currentAllocationResidents(source));
      if (amount <= EPSILON) continue;
      this.reduceAllocation(source, amount);
      this.addAllocation(option.buildingId, source.band, option.tenure, amount);
      remaining -= amount;
      moved += amount;
      cycle.moved += amount;
      addMetric(cycle.movedOutByBuilding, source.buildingId, amount);
      addMetric(cycle.movedInByBuilding, option.buildingId, amount);
    }
    return moved;
  }

  private reconcileOptionValidity(options: readonly HousingTenureOption[]): void {
    const optionMap = new Map(options.map((option) => [optionKey(option.buildingId, option.tenure), option] as const));
    const retained: HousingCohortAllocation[] = [];
    const newlyUnplaced: UnplacedHousingCohort[] = [];
    for (const allocation of this.allocations) {
      if (!optionMap.has(optionKey(allocation.buildingId, allocation.tenure))) {
        newlyUnplaced.push(Object.freeze({
          band: allocation.band,
          tenurePreference: allocation.tenure,
          residents: allocation.residents,
          displaced: false,
        }));
      } else {
        retained.push(allocation);
      }
    }
    this.allocations = mergeAllocations(retained);
    this.unplaced = mergeUnplaced([...this.unplaced, ...newlyUnplaced]);

    for (const option of options) {
      const matching = this.allocations
        .filter((item) => item.buildingId === option.buildingId && item.tenure === option.tenure)
        .sort((a, b) => {
          const scoreA = optionScore(option, a.band, a.tenure);
          const scoreB = optionScore(option, b.band, b.tenure);
          return scoreA - scoreB || a.band.localeCompare(b.band);
        });
      const assigned = matching.reduce((sum, item) => sum + item.residents, 0);
      let excess = Math.max(0, assigned - option.capacity);
      for (const allocation of matching) {
        if (excess <= EPSILON) break;
        const amount = Math.min(excess, this.currentAllocationResidents(allocation));
        this.reduceAllocation(allocation, amount);
        this.unplaced.push(Object.freeze({
          band: allocation.band,
          tenurePreference: allocation.tenure,
          residents: amount,
          displaced: false,
        }));
        excess -= amount;
      }
    }
    this.allocations = mergeAllocations(this.allocations);
    this.unplaced = mergeUnplaced(this.unplaced);
  }

  private contractPopulation(amount: number, options: readonly HousingTenureOption[]): void {
    let remaining = amount;
    const orderedUnplaced = this.unplaced.slice().sort((a, b) =>
      Number(a.displaced) - Number(b.displaced)
      || a.band.localeCompare(b.band)
      || tenureRank(a.tenurePreference) - tenureRank(b.tenurePreference));
    this.unplaced = [];
    for (const cohort of orderedUnplaced) {
      const removed = Math.min(remaining, cohort.residents);
      const kept = cohort.residents - removed;
      remaining -= removed;
      if (kept > EPSILON) this.unplaced.push(cloneUnplaced({ ...cohort, residents: kept }));
    }
    if (remaining <= EPSILON) {
      this.unplaced = mergeUnplaced(this.unplaced);
      return;
    }

    const optionMap = new Map(options.map((option) => [optionKey(option.buildingId, option.tenure), option] as const));
    const housed = this.allocations.slice().sort((a, b) => {
      const optionA = optionMap.get(optionKey(a.buildingId, a.tenure));
      const optionB = optionMap.get(optionKey(b.buildingId, b.tenure));
      const scoreA = optionA ? optionScore(optionA, a.band, a.tenure) : -1;
      const scoreB = optionB ? optionScore(optionB, b.band, b.tenure) : -1;
      return scoreA - scoreB || allocationKey(a).localeCompare(allocationKey(b));
    });
    for (const allocation of housed) {
      if (remaining <= EPSILON) break;
      const removed = Math.min(remaining, this.currentAllocationResidents(allocation));
      this.reduceAllocation(allocation, removed);
      remaining -= removed;
    }
    this.allocations = mergeAllocations(this.allocations);
    this.unplaced = mergeUnplaced(this.unplaced);
  }

  private optionVacancy(option: HousingTenureOption): number {
    const assigned = this.allocations
      .filter((item) => item.buildingId === option.buildingId && item.tenure === option.tenure)
      .reduce((sum, item) => sum + item.residents, 0);
    return Math.max(0, option.capacity - assigned);
  }

  private addAllocation(buildingId: string, band: HousingIncomeBand, tenure: HousingTenure, residents: number): void {
    if (residents <= EPSILON) return;
    this.allocations.push(Object.freeze({ buildingId, band, tenure, residents }));
    this.allocations = mergeAllocations(this.allocations);
  }

  private currentAllocationResidents(source: HousingCohortAllocation): number {
    return this.allocations.find((item) => allocationKey(item) === allocationKey(source))?.residents ?? 0;
  }

  private reduceAllocation(source: HousingCohortAllocation, residents: number): void {
    let remaining = residents;
    const key = allocationKey(source);
    const next: HousingCohortAllocation[] = [];
    for (const item of this.allocations) {
      if (allocationKey(item) !== key || remaining <= EPSILON) {
        next.push(item);
        continue;
      }
      const removed = Math.min(item.residents, remaining);
      const kept = item.residents - removed;
      remaining -= removed;
      if (kept > EPSILON) next.push(Object.freeze({ ...item, residents: kept }));
    }
    this.allocations = mergeAllocations(next);
  }

  private representedResidents(): number {
    return this.allocations.reduce((sum, item) => sum + item.residents, 0)
      + this.unplaced.reduce((sum, item) => sum + item.residents, 0);
  }

  private consumePendingCycle(): CycleMetrics {
    const cycle = this.pendingCycle;
    this.pendingCycle = emptyCycle();
    return cycle;
  }

  private buildSnapshot(
    population: number,
    options: readonly HousingTenureOption[],
    cycle: CycleMetrics,
  ): HousingRelocationSnapshot {
    const optionMap = new Map(options.map((option) => [optionKey(option.buildingId, option.tenure), option] as const));
    const byBand = {} as Record<HousingIncomeBand, HousingRelocationBandSnapshot>;
    for (const band of HOUSING_BANDS) {
      const allocations = this.allocations.filter((item) => item.band === band);
      const unplacedResidents = this.unplaced.filter((item) => item.band === band).reduce((sum, item) => sum + item.residents, 0);
      const renterResidents = allocations.filter((item) => item.tenure === 'renter').reduce((sum, item) => sum + item.residents, 0);
      const ownerResidents = allocations.filter((item) => item.tenure === 'owner').reduce((sum, item) => sum + item.residents, 0);
      const costBurdenedResidents = allocations.reduce((sum, item) => {
        const option = optionMap.get(optionKey(item.buildingId, item.tenure));
        if (!option) return sum;
        return sum + (housingBurden(option.monthlyCost, band) > HOUSING_BAND_PROFILES[band].maxHousingBurden ? item.residents : 0);
      }, 0);
      byBand[band] = Object.freeze({
        band,
        housedResidents: renterResidents + ownerResidents,
        unplacedResidents,
        renterResidents,
        ownerResidents,
        costBurdenedResidents,
      });
    }

    const buildingIds = [...new Set(options.map((option) => option.buildingId))].sort();
    const byBuilding: Record<string, HousingBuildingRelocationSnapshot> = {};
    for (const buildingId of buildingIds) {
      const allocations = this.allocations.filter((item) => item.buildingId === buildingId);
      const renterResidents = allocations.filter((item) => item.tenure === 'renter').reduce((sum, item) => sum + item.residents, 0);
      const ownerResidents = allocations.filter((item) => item.tenure === 'owner').reduce((sum, item) => sum + item.residents, 0);
      const rentalCapacity = options.find((option) => option.buildingId === buildingId && option.tenure === 'renter')?.capacity ?? 0;
      const ownershipCapacity = options.find((option) => option.buildingId === buildingId && option.tenure === 'owner')?.capacity ?? 0;
      const costBurdenedResidents = allocations.reduce((sum, item) => {
        const option = optionMap.get(optionKey(item.buildingId, item.tenure));
        return sum + (option && housingBurden(option.monthlyCost, item.band) > HOUSING_BAND_PROFILES[item.band].maxHousingBurden ? item.residents : 0);
      }, 0);
      byBuilding[buildingId] = Object.freeze({
        buildingId,
        assignedResidents: renterResidents + ownerResidents,
        renterResidents,
        ownerResidents,
        rentalOccupancyRate: rentalCapacity > 0 ? Math.min(1, renterResidents / rentalCapacity) : 0,
        ownershipOccupancyRate: ownershipCapacity > 0 ? Math.min(1, ownerResidents / ownershipCapacity) : 0,
        costBurdenedResidents,
        movedInResidentsThisCycle: cycle.movedInByBuilding.get(buildingId) ?? 0,
        movedOutResidentsThisCycle: cycle.movedOutByBuilding.get(buildingId) ?? 0,
        displacedResidentsThisCycle: cycle.displacedByBuilding.get(buildingId) ?? 0,
      });
    }

    const renterResidents = this.allocations.filter((item) => item.tenure === 'renter').reduce((sum, item) => sum + item.residents, 0);
    const ownerResidents = this.allocations.filter((item) => item.tenure === 'owner').reduce((sum, item) => sum + item.residents, 0);
    const housedResidents = renterResidents + ownerResidents;
    const unplacedResidents = this.unplaced.reduce((sum, item) => sum + item.residents, 0);
    const rentalCapacity = options.filter((option) => option.tenure === 'renter').reduce((sum, option) => sum + option.capacity, 0);
    const ownershipCapacity = options.filter((option) => option.tenure === 'owner').reduce((sum, option) => sum + option.capacity, 0);
    const costBurdenedResidents = HOUSING_BANDS.reduce((sum, band) => sum + byBand[band].costBurdenedResidents, 0);

    return Object.freeze({
      population,
      housedResidents,
      unplacedResidents,
      renterResidents,
      ownerResidents,
      renterShare: housedResidents > 0 ? renterResidents / housedResidents : 0,
      ownerShare: housedResidents > 0 ? ownerResidents / housedResidents : 0,
      rentalVacancyRate: rentalCapacity > 0 ? Math.max(0, 1 - renterResidents / rentalCapacity) : 0,
      ownershipVacancyRate: ownershipCapacity > 0 ? Math.max(0, 1 - ownerResidents / ownershipCapacity) : 0,
      movedResidentsThisCycle: cycle.moved,
      displacedResidentsThisCycle: cycle.displaced,
      rehousedDisplacedResidentsThisCycle: cycle.rehoused,
      failedSearchResidentsThisCycle: cycle.failed,
      costBurdenedResidents,
      totals: Object.freeze({ ...this.totals }),
      byBand: Object.freeze(byBand),
      byBuilding: Object.freeze(byBuilding),
    });
  }

  private validateBand(value: HousingIncomeBand): void {
    if (!(HOUSING_BANDS as readonly string[]).includes(value)) throw new Error(`invalid housing income band: ${String(value)}`);
  }

  private validateTenure(value: HousingTenure): void {
    if (!(HOUSING_TENURES as readonly string[]).includes(value)) throw new Error(`invalid housing tenure: ${String(value)}`);
  }
}