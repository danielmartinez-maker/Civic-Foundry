import { clamp01 } from '../core/types.ts';

export type HousingIncomeBand = 'lower' | 'middle' | 'upper';

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

type BandProfile = Readonly<{
  share: number;
  monthlyIncome: number;
  maxRentBurden: number;
}>;

const BAND_PROFILES: Readonly<Record<HousingIncomeBand, BandProfile>> = Object.freeze({
  lower: Object.freeze({ share: 0.45, monthlyIncome: 1_500, maxRentBurden: 0.35 }),
  middle: Object.freeze({ share: 0.40, monthlyIncome: 2_600, maxRentBurden: 0.32 }),
  upper: Object.freeze({ share: 0.15, monthlyIncome: 4_500, maxRentBurden: 0.28 }),
});

const ALLOCATION_ORDER: readonly HousingIncomeBand[] = ['upper', 'middle', 'lower'];
const BANDS: readonly HousingIncomeBand[] = ['lower', 'middle', 'upper'];

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} must be non-negative`);
}

function affordabilityScore(monthlyRent: number, profile: BandProfile): number {
  const burden = monthlyRent / profile.monthlyIncome;
  return clamp01((2 * profile.maxRentBurden - burden) / profile.maxRentBurden);
}

function qualityScore(option: HousingOption): number {
  return clamp01(
    0.30 * clamp01(option.neighborhoodQuality)
    + 0.25 * clamp01(option.serviceQuality)
    + 0.25 * clamp01(option.personAccessibility)
    + 0.20 * clamp01(option.utilityRatio),
  );
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

function emptySnapshot(population = 0): HousingChoiceSnapshot {
  const upper = emptyBand('upper', population * BAND_PROFILES.upper.share);
  const middle = emptyBand('middle', population * BAND_PROFILES.middle.share);
  const lowerTarget = Math.max(0, population - upper.targetResidents - middle.targetResidents);
  const lower = emptyBand('lower', lowerTarget);
  return Object.freeze({
    population,
    physicalCapacity: 0,
    effectiveAffordableCapacity: 0,
    housedResidents: 0,
    unplacedResidents: population,
    affordabilityIndex: 1,
    costBurdenedResidents: 0,
    costBurdenShare: 0,
    byBand: Object.freeze({ lower, middle, upper }),
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
      for (const band of BANDS) {
        const profile = BAND_PROFILES[band];
        burdenByBand[band] = option.monthlyRent / profile.monthlyIncome;
        affordabilityByBand[band] = affordabilityScore(option.monthlyRent, profile);
      }
      const weightedAffordability = BANDS.reduce(
        (sum, band) => sum + BAND_PROFILES[band].share * affordabilityByBand[band],
        0,
      );
      return Object.freeze({
        option,
        quality: qualityScore(option),
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

    const upperTarget = population * BAND_PROFILES.upper.share;
    const middleTarget = population * BAND_PROFILES.middle.share;
    const targets: Record<HousingIncomeBand, number> = {
      upper: upperTarget,
      middle: middleTarget,
      lower: Math.max(0, population - upperTarget - middleTarget),
    };
    const bandSnapshots = {} as Record<HousingIncomeBand, HousingBandSnapshot>;

    for (const band of ALLOCATION_ORDER) {
      const profile = BAND_PROFILES[band];
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
        if (burden > profile.maxRentBurden) {
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

  snapshot(): HousingChoiceSnapshot {
    return this.latest;
  }
}