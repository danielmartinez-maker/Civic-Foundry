import { clamp01 } from '../core/types.ts';
import {
  HOUSING_ALLOCATION_ORDER,
  HOUSING_BAND_PROFILES,
  HOUSING_BANDS,
  housingAffordabilityScore,
  housingBurden,
  housingQualityScore,
  type HousingIncomeBand,
} from './HousingEconomics.ts';
import type { HousingRelocationSnapshot, HousingRelocationState } from './HousingRelocationSystem.ts';
import type { HousingTenureOption } from './HousingTenureSystem.ts';

export type { HousingIncomeBand } from './HousingEconomics.ts';

export type HousingOption = Readonly<{
  buildingId: string;
  capacity: number;
  monthlyRent: number;
  personAccessibility: number;
  serviceQuality: number;
  neighborhoodQuality: number;
  utilityRatio: number;
}>;

export type HousingBuildingAllocation = Readonly<{
  buildingId: string;
  assignedResidents: number;
  occupancyRate: number;
  affordabilityScore: number;
  averageRentBurden: number;
  costBurdenedResidents: number;
}>;

export type HousingBandSnapshot = Readonly<{
  band: HousingIncomeBand;
  targetResidents: number;
  assignedResidents: number;
  unplacedResidents: number;
  averageRentBurden: number;
  costBurdenedResidents: number;
}>;

export type HousingChoiceSnapshot = Readonly<{
  population: number;
  physicalCapacity: number;
  effectiveAffordableCapacity: number;
  housedResidents: number;
  unplacedResidents: number;
  affordabilityIndex: number;
  costBurdenedResidents: number;
  costBurdenShare: number;
  byBand: Readonly<Record<HousingIncomeBand, HousingBandSnapshot>>;
  byBuilding: Readonly<Record<string, HousingBuildingAllocation>>;
}>;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} must be non-negative`);
}

function validateOption(option: HousingOption): void {
  if (option.buildingId.length === 0) throw new Error('buildingId must be non-empty');
  nonNegative('capacity', option.capacity);
  nonNegative('monthlyRent', option.monthlyRent);
  finite('personAccessibility', option.personAccessibility);
  finite('serviceQuality', option.serviceQuality);
  finite('neighborhoodQuality', option.neighborhoodQuality);
  finite('utilityRatio', option.utilityRatio);
}

function emptyBand(band: HousingIncomeBand, targetResidents = 0): HousingBandSnapshot {
  return Object.freeze({
    band,
    targetResidents,
    assignedResidents: 0,
    unplacedResidents: targetResidents,
    averageRentBurden: 0,
    costBurdenedResidents: 0,
  });
}

function targetsForPopulation(population: number): Readonly<Record<HousingIncomeBand, number>> {
  const upper = population * HOUSING_BAND_PROFILES.upper.share;
  const middle = population * HOUSING_BAND_PROFILES.middle.share;
  return Object.freeze({
    upper,
    middle,
    lower: Math.max(0, population - upper - middle),
  });
}

function emptySnapshot(population = 0): HousingChoiceSnapshot {
  const targets = targetsForPopulation(population);
  return Object.freeze({
    population,
    physicalCapacity: 0,
    effectiveAffordableCapacity: 0,
    housedResidents: 0,
    unplacedResidents: population,
    affordabilityIndex: 1,
    costBurdenedResidents: 0,
    costBurdenShare: 0,
    byBand: Object.freeze({
      lower: emptyBand('lower', targets.lower),
      middle: emptyBand('middle', targets.middle),
      upper: emptyBand('upper', targets.upper),
    }),
    byBuilding: Object.freeze({}),
  });
}

type EvaluatedOption = Readonly<{
  option: HousingOption;
  quality: number;
  burdenByBand: Readonly<Record<HousingIncomeBand, number>>;
  affordabilityByBand: Readonly<Record<HousingIncomeBand, number>>;
  weightedAffordability: number;
}>;

type BuildingAccumulator = {
  assignedResidents: number;
  rentBurdenTotal: number;
  costBurdenedResidents: number;
};

export class HousingChoiceSystem {
  private latest: HousingChoiceSnapshot = emptySnapshot();

  /**
   * Legacy stateless aggregate allocator retained for standalone diagnostics/tests.
   * SimulationCore uses evaluateFromRelocation() so authoritative occupancy is persistent.
   */
  evaluate(population: number, options: readonly HousingOption[]): HousingChoiceSnapshot {
    nonNegative('population', population);
    const sorted = options.slice().sort((a, b) => a.buildingId.localeCompare(b.buildingId));
    const seen = new Set<string>();
    for (const option of sorted) {
      validateOption(option);
      if (seen.has(option.buildingId)) throw new Error(`duplicate buildingId: ${option.buildingId}`);
      seen.add(option.buildingId);
    }
    if (sorted.length === 0) {
      this.latest = emptySnapshot(population);
      return this.latest;
    }

    const evaluated: EvaluatedOption[] = sorted.map((option) => {
      const burdenByBand = {} as Record<HousingIncomeBand, number>;
      const affordabilityByBand = {} as Record<HousingIncomeBand, number>;
      for (const band of HOUSING_BANDS) {
        burdenByBand[band] = housingBurden(option.monthlyRent, band);
        affordabilityByBand[band] = housingAffordabilityScore(option.monthlyRent, band);
      }
      const weightedAffordability = HOUSING_BANDS.reduce(
        (sum, band) => sum + HOUSING_BAND_PROFILES[band].share * affordabilityByBand[band],
        0,
      );
      return Object.freeze({
        option,
        quality: housingQualityScore(option),
        burdenByBand: Object.freeze(burdenByBand),
        affordabilityByBand: Object.freeze(affordabilityByBand),
        weightedAffordability: clamp01(weightedAffordability),
      });
    });

    const physicalCapacity = evaluated.reduce((sum, item) => sum + item.option.capacity, 0);
    const effectiveAffordableCapacity = Math.min(
      physicalCapacity,
      Math.max(0, evaluated.reduce(
        (sum, item) => sum + item.option.capacity * item.weightedAffordability,
        0,
      )),
    );
    const affordabilityIndex = physicalCapacity > 0
      ? clamp01(effectiveAffordableCapacity / physicalCapacity)
      : 1;

    const remainingCapacity = new Map<string, number>(
      evaluated.map((item) => [item.option.buildingId, item.option.capacity] as const),
    );
    const buildingAccumulators = new Map<string, BuildingAccumulator>(
      evaluated.map((item) => [item.option.buildingId, {
        assignedResidents: 0,
        rentBurdenTotal: 0,
        costBurdenedResidents: 0,
      }] as const),
    );

    const targets = targetsForPopulation(population);
    const bandSnapshots = {} as Record<HousingIncomeBand, HousingBandSnapshot>;

    for (const band of HOUSING_ALLOCATION_ORDER) {
      const profile = HOUSING_BAND_PROFILES[band];
      let remainingResidents = targets[band];
      let assignedResidents = 0;
      let rentBurdenTotal = 0;
      let costBurdenedResidents = 0;
      const ranked = evaluated.slice().sort((a, b) => {
        const aWeight = 0.05 + 0.60 * a.affordabilityByBand[band] + 0.35 * a.quality;
        const bWeight = 0.05 + 0.60 * b.affordabilityByBand[band] + 0.35 * b.quality;
        return bWeight - aWeight || a.option.buildingId.localeCompare(b.option.buildingId);
      });

      for (const item of ranked) {
        if (remainingResidents <= 0) break;
        const capacity = remainingCapacity.get(item.option.buildingId) ?? 0;
        if (capacity <= 0) continue;
        const assigned = Math.min(remainingResidents, capacity);
        if (assigned <= 0) continue;
        const burden = item.burdenByBand[band];
        const accumulator = buildingAccumulators.get(item.option.buildingId)!;
        accumulator.assignedResidents += assigned;
        accumulator.rentBurdenTotal += assigned * burden;
        if (burden > profile.maxHousingBurden) {
          accumulator.costBurdenedResidents += assigned;
          costBurdenedResidents += assigned;
        }
        remainingCapacity.set(item.option.buildingId, capacity - assigned);
        assignedResidents += assigned;
        rentBurdenTotal += assigned * burden;
        remainingResidents -= assigned;
      }

      bandSnapshots[band] = Object.freeze({
        band,
        targetResidents: targets[band],
        assignedResidents,
        unplacedResidents: Math.max(0, targets[band] - assignedResidents),
        averageRentBurden: assignedResidents > 0 ? rentBurdenTotal / assignedResidents : 0,
        costBurdenedResidents,
      });
    }

    const byBuilding: Record<string, HousingBuildingAllocation> = {};
    let housedResidents = 0;
    let costBurdenedResidents = 0;
    for (const item of evaluated) {
      const accumulator = buildingAccumulators.get(item.option.buildingId)!;
      housedResidents += accumulator.assignedResidents;
      costBurdenedResidents += accumulator.costBurdenedResidents;
      byBuilding[item.option.buildingId] = Object.freeze({
        buildingId: item.option.buildingId,
        assignedResidents: accumulator.assignedResidents,
        occupancyRate: item.option.capacity > 0
          ? clamp01(accumulator.assignedResidents / item.option.capacity)
          : 0,
        affordabilityScore: item.weightedAffordability,
        averageRentBurden: accumulator.assignedResidents > 0
          ? accumulator.rentBurdenTotal / accumulator.assignedResidents
          : 0,
        costBurdenedResidents: accumulator.costBurdenedResidents,
      });
    }

    housedResidents = Math.min(population, physicalCapacity, housedResidents);
    this.latest = Object.freeze({
      population,
      physicalCapacity,
      effectiveAffordableCapacity,
      housedResidents,
      unplacedResidents: Math.max(0, population - housedResidents),
      affordabilityIndex,
      costBurdenedResidents,
      costBurdenShare: housedResidents > 0 ? clamp01(costBurdenedResidents / housedResidents) : 0,
      byBand: Object.freeze({
        lower: bandSnapshots.lower,
        middle: bandSnapshots.middle,
        upper: bandSnapshots.upper,
      }),
      byBuilding: Object.freeze(byBuilding),
    });
    return this.latest;
  }

  evaluateFromRelocation(
    population: number,
    options: readonly HousingTenureOption[],
    state: HousingRelocationState,
    relocation: HousingRelocationSnapshot,
  ): HousingChoiceSnapshot {
    nonNegative('population', population);
    const sorted = options.slice().sort((a, b) =>
      a.buildingId.localeCompare(b.buildingId) || a.tenure.localeCompare(b.tenure));
    const optionMap = new Map(sorted.map((option) => [`${option.buildingId}|${option.tenure}`, option] as const));
    const buildingIds = [...new Set(sorted.map((option) => option.buildingId))].sort();

    const physicalCapacity = sorted.reduce((sum, option) => sum + option.capacity, 0);
    const effectiveAffordableCapacity = Math.min(
      physicalCapacity,
      Math.max(0, sorted.reduce((sum, option) => {
        const weighted = HOUSING_BANDS.reduce(
          (bandSum, band) => bandSum + HOUSING_BAND_PROFILES[band].share * housingAffordabilityScore(option.monthlyCost, band),
          0,
        );
        return sum + option.capacity * clamp01(weighted);
      }, 0)),
    );
    const affordabilityIndex = physicalCapacity > 0
      ? clamp01(effectiveAffordableCapacity / physicalCapacity)
      : 1;

    const targets = targetsForPopulation(population);
    const byBand = {} as Record<HousingIncomeBand, HousingBandSnapshot>;
    for (const band of HOUSING_BANDS) {
      const allocations = state.allocations.filter((item) => item.band === band);
      const assignedResidents = allocations.reduce((sum, item) => sum + item.residents, 0);
      const unplacedResidents = state.unplaced.filter((item) => item.band === band).reduce((sum, item) => sum + item.residents, 0);
      let burdenTotal = 0;
      let costBurdenedResidents = 0;
      for (const allocation of allocations) {
        const option = optionMap.get(`${allocation.buildingId}|${allocation.tenure}`);
        if (!option) continue;
        const burden = housingBurden(option.monthlyCost, band);
        burdenTotal += burden * allocation.residents;
        if (burden > HOUSING_BAND_PROFILES[band].maxHousingBurden) costBurdenedResidents += allocation.residents;
      }
      byBand[band] = Object.freeze({
        band,
        targetResidents: targets[band],
        assignedResidents,
        unplacedResidents,
        averageRentBurden: assignedResidents > 0 ? burdenTotal / assignedResidents : 0,
        costBurdenedResidents,
      });
    }

    const byBuilding: Record<string, HousingBuildingAllocation> = {};
    for (const buildingId of buildingIds) {
      const buildingOptions = sorted.filter((option) => option.buildingId === buildingId);
      const capacity = buildingOptions.reduce((sum, option) => sum + option.capacity, 0);
      const allocations = state.allocations.filter((item) => item.buildingId === buildingId);
      const assignedResidents = allocations.reduce((sum, item) => sum + item.residents, 0);
      let burdenTotal = 0;
      let costBurdenedResidents = 0;
      for (const allocation of allocations) {
        const option = optionMap.get(`${allocation.buildingId}|${allocation.tenure}`);
        if (!option) continue;
        const burden = housingBurden(option.monthlyCost, allocation.band);
        burdenTotal += burden * allocation.residents;
        if (burden > HOUSING_BAND_PROFILES[allocation.band].maxHousingBurden) costBurdenedResidents += allocation.residents;
      }
      const weightedAffordability = capacity > 0
        ? buildingOptions.reduce((sum, option) => {
          const optionWeighted = HOUSING_BANDS.reduce(
            (bandSum, band) => bandSum + HOUSING_BAND_PROFILES[band].share * housingAffordabilityScore(option.monthlyCost, band),
            0,
          );
          return sum + option.capacity * clamp01(optionWeighted);
        }, 0) / capacity
        : 1;
      byBuilding[buildingId] = Object.freeze({
        buildingId,
        assignedResidents,
        occupancyRate: capacity > 0 ? clamp01(assignedResidents / capacity) : 0,
        affordabilityScore: clamp01(weightedAffordability),
        averageRentBurden: assignedResidents > 0 ? burdenTotal / assignedResidents : 0,
        costBurdenedResidents,
      });
    }

    this.latest = Object.freeze({
      population,
      physicalCapacity,
      effectiveAffordableCapacity,
      housedResidents: relocation.housedResidents,
      unplacedResidents: relocation.unplacedResidents,
      affordabilityIndex,
      costBurdenedResidents: relocation.costBurdenedResidents,
      costBurdenShare: relocation.housedResidents > 0
        ? clamp01(relocation.costBurdenedResidents / relocation.housedResidents)
        : 0,
      byBand: Object.freeze(byBand),
      byBuilding: Object.freeze(byBuilding),
    });
    return this.latest;
  }

  snapshot(): HousingChoiceSnapshot {
    return this.latest;
  }
}
