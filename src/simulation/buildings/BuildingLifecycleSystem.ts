import type {
  BuildingLifecycleState,
  BuildingTypology,
  BuildingV2,
} from './BuildingTypes.ts';

const TICKS_PER_YEAR = 250;
const EPSILON = 1e-9;

export type BuildingLifecycleInput = Readonly<{
  maintenanceSpend: number;
  occupancyRatio: number;
  utilizationRatio: number;
  environmentalStress: number;
  serviceStress: number;
  cadenceTicks: number;
}>;

export class BuildingLifecycleSystem {
  tick(
    building: BuildingV2,
    typology: BuildingTypology,
    input: BuildingLifecycleInput,
  ): BuildingLifecycleState {
    validateBuilding(building, typology);
    validateInput(input);

    const previous = building.lifecycle;
    const cadenceYears = input.cadenceTicks / TICKS_PER_YEAR;
    const required = requiredMaintenanceCost(building, typology);
    const shortfall = Math.max(0, required - input.maintenanceSpend);
    const surplus = Math.max(0, input.maintenanceSpend - required);
    const shortfallRatio = required > EPSILON ? shortfall / required : 0;
    const previousBacklogRatio = required > EPSILON ? previous.maintenanceBacklog / required : 0;

    const backlogRepayment = Math.min(previous.maintenanceBacklog, surplus * 0.75);
    const maintenanceBacklog = Math.max(
      0,
      previous.maintenanceBacklog + shortfall - backlogRepayment,
    );
    const backlogRatio = required > EPSILON ? maintenanceBacklog / required : 0;
    const deferredMaintenanceTicks = shortfall > EPSILON
      ? previous.deferredMaintenanceTicks + input.cadenceTicks
      : Math.max(0, previous.deferredMaintenanceTicks - input.cadenceTicks);

    const chronicVacancy = input.occupancyRatio < 0.20;
    const healthyOccupancy = input.occupancyRatio >= 0.50;
    const vacancyDurationTicks = chronicVacancy
      ? previous.vacancyDurationTicks + input.cadenceTicks
      : healthyOccupancy
        ? Math.max(0, previous.vacancyDurationTicks - input.cadenceTicks * 2)
        : Math.max(0, previous.vacancyDurationTicks - input.cadenceTicks * 0.25);

    const ageTicks = previous.ageTicks + input.cadenceTicks;
    const effectiveAge = Math.max(0, previous.effectiveAge + cadenceYears);
    const ageStress = Math.min(2, effectiveAge / 50);
    const vacancyStress = chronicVacancy
      ? 1 - input.occupancyRatio
      : Math.max(0, 0.35 - input.occupancyRatio) * 0.5;
    const utilizationStress = input.utilizationRatio > 0.90
      ? (input.utilizationRatio - 0.90) * 2
      : input.utilizationRatio < 0.20
        ? (0.20 - input.utilizationRatio) * 0.5
        : 0;
    const backlogStress = Math.min(3, backlogRatio);
    const baseDecay = cadenceYears * (0.45 + ageStress * 0.35);
    const maintenanceDecay = cadenceYears * (shortfallRatio * 2.4 + backlogStress * 0.55);
    const vacancyDecay = cadenceYears * vacancyStress * 2.0;
    const utilizationDecay = cadenceYears * utilizationStress * 0.7;
    const environmentalDecay = cadenceYears * input.environmentalStress * 1.0;
    const serviceDecay = cadenceYears * input.serviceStress * 0.7;
    const restoration = required > EPSILON
      ? Math.min(0.75 * cadenceYears, surplus / required * 0.5)
      : 0;

    const structuralCondition = boundedCondition(
      previous.structuralCondition
        - baseDecay * 0.55
        - maintenanceDecay * 0.40
        - vacancyDecay * 0.15
        - environmentalDecay * 0.25
        + restoration * 0.35,
    );
    const systemsCondition = boundedCondition(
      previous.systemsCondition
        - baseDecay * 0.90
        - maintenanceDecay * 1.10
        - utilizationDecay * 0.70
        - serviceDecay * 0.65
        + restoration * 0.90,
    );
    const exteriorCondition = boundedCondition(
      previous.exteriorCondition
        - baseDecay * 0.75
        - maintenanceDecay * 0.70
        - vacancyDecay * 1.10
        - environmentalDecay * 1.15
        + restoration * 0.75,
    );
    const condition = boundedCondition(
      structuralCondition * 0.40
        + systemsCondition * 0.35
        + exteriorCondition * 0.25,
    );

    const vacancyYears = vacancyDurationTicks / TICKS_PER_YEAR;
    const conditionDistress = (100 - condition) * 0.62;
    const vacancyDistress = Math.min(20, vacancyYears * 5);
    const backlogDistress = Math.min(18, backlogStress * 6);
    const deferredDistress = Math.min(10, deferredMaintenanceTicks / TICKS_PER_YEAR * 2.5);
    const distressScore = clamp(conditionDistress + vacancyDistress + backlogDistress + deferredDistress, 0, 100);

    return Object.freeze({
      ageTicks,
      condition,
      structuralCondition,
      systemsCondition,
      exteriorCondition,
      maintenanceBacklog,
      deferredMaintenanceTicks,
      effectiveAge,
      vacancyDurationTicks,
      distressScore,
      ...(previous.lastMajorRenovationTick === undefined
        ? {}
        : { lastMajorRenovationTick: previous.lastMajorRenovationTick }),
    });
  }
}

export function requiredMaintenanceCost(
  building: BuildingV2,
  typology: BuildingTypology,
): number {
  validateBuilding(building, typology);
  const effectiveAge = Math.max(0, building.lifecycle.effectiveAge);
  const ageFactor = 1 + Math.min(effectiveAge, 100) / 100;
  const complexityFactor = Math.max(0.50, typology.complexityFactor);
  return building.grossFloorAreaM2
    * typology.maintenanceCostPerM2
    * ageFactor
    * complexityFactor;
}

export function conditionRentFactor(condition: number): number {
  if (!Number.isFinite(condition)) throw new Error('condition must be finite');
  const value = clamp(condition, 0, 100);
  if (value >= 80) return 0.95 + ((value - 80) / 20) * 0.05;
  if (value >= 60) return 0.88 + ((value - 60) / 20) * 0.07;
  if (value >= 35) return 0.70 + ((value - 35) / 25) * 0.18;
  if (value >= 20) return 0.50 + ((value - 20) / 15) * 0.20;
  return 0.30 + (value / 20) * 0.20;
}

export function conditionBand(condition: number): 'good' | 'aging' | 'worn' | 'deteriorated' | 'distressed' {
  if (!Number.isFinite(condition)) throw new Error('condition must be finite');
  const value = clamp(condition, 0, 100);
  if (value >= 80) return 'good';
  if (value >= 60) return 'aging';
  if (value >= 35) return 'worn';
  if (value >= 20) return 'deteriorated';
  return 'distressed';
}

function validateBuilding(building: BuildingV2, typology: BuildingTypology): void {
  if (building.typologyId !== typology.id) {
    throw new Error(`building typology mismatch: ${building.typologyId} !== ${typology.id}`);
  }
  if (!Number.isFinite(building.grossFloorAreaM2) || building.grossFloorAreaM2 < 0) {
    throw new Error('building grossFloorAreaM2 must be finite and non-negative');
  }
  if (!Number.isFinite(typology.maintenanceCostPerM2) || typology.maintenanceCostPerM2 < 0) {
    throw new Error('typology maintenanceCostPerM2 must be finite and non-negative');
  }
  if (!Number.isFinite(typology.complexityFactor) || typology.complexityFactor <= 0) {
    throw new Error('typology complexityFactor must be positive and finite');
  }
  validateLifecycle(building.lifecycle);
}

function validateLifecycle(state: BuildingLifecycleState): void {
  const values: Array<readonly [string, number]> = [
    ['ageTicks', state.ageTicks],
    ['condition', state.condition],
    ['structuralCondition', state.structuralCondition],
    ['systemsCondition', state.systemsCondition],
    ['exteriorCondition', state.exteriorCondition],
    ['maintenanceBacklog', state.maintenanceBacklog],
    ['deferredMaintenanceTicks', state.deferredMaintenanceTicks],
    ['effectiveAge', state.effectiveAge],
    ['vacancyDurationTicks', state.vacancyDurationTicks],
    ['distressScore', state.distressScore],
  ];
  for (const [name, value] of values) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`lifecycle ${name} must be finite and non-negative`);
  }
  for (const [name, value] of [
    ['condition', state.condition],
    ['structuralCondition', state.structuralCondition],
    ['systemsCondition', state.systemsCondition],
    ['exteriorCondition', state.exteriorCondition],
    ['distressScore', state.distressScore],
  ] as const) {
    if (value > 100) throw new Error(`lifecycle ${name} must not exceed 100`);
  }
}

function validateInput(input: BuildingLifecycleInput): void {
  const finiteValues: Array<readonly [string, number]> = [
    ['maintenanceSpend', input.maintenanceSpend],
    ['occupancyRatio', input.occupancyRatio],
    ['utilizationRatio', input.utilizationRatio],
    ['environmentalStress', input.environmentalStress],
    ['serviceStress', input.serviceStress],
    ['cadenceTicks', input.cadenceTicks],
  ];
  for (const [name, value] of finiteValues) {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
  }
  if (input.maintenanceSpend < 0) throw new Error('maintenanceSpend must be non-negative');
  for (const [name, value] of [
    ['occupancyRatio', input.occupancyRatio],
    ['utilizationRatio', input.utilizationRatio],
    ['environmentalStress', input.environmentalStress],
    ['serviceStress', input.serviceStress],
  ] as const) {
    if (value < 0 || value > 1) throw new Error(`${name} must be within [0, 1]`);
  }
  if (!Number.isInteger(input.cadenceTicks) || input.cadenceTicks <= 0) {
    throw new Error('cadenceTicks must be a positive integer');
  }
}

function boundedCondition(value: number): number {
  return clamp(value, 0, 100);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
