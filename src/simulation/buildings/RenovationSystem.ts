import { getBuildingTypology } from '../../data/buildingTypologies.ts';
import type {
  BuildingLifecycleState,
  BuildingProjectState,
  BuildingRenovationScope,
  BuildingTypology,
  BuildingV2,
} from './BuildingTypes.ts';
import type { ParcelDevelopmentEnvelope, UseType } from '../zoning/ZoningTypes.ts';

const TICKS_PER_YEAR = 250;

export type RenovationScope = BuildingRenovationScope;

export type RenovationMarketContext = Readonly<{
  currentPropertyValue: number;
  projectedPropertyValue: number;
  hurdleRate: number;
  financingRate: number;
}>;

export type RenovationProposal = Readonly<{
  scope: RenovationScope;
  feasible: boolean;
  cost: number;
  financingCost: number;
  totalInvestment: number;
  projectedCondition: number;
  projectedStructuralCondition: number;
  projectedSystemsCondition: number;
  projectedExteriorCondition: number;
  projectedEffectiveAge: number;
  expectedReturn: number;
  requiresVacancy: boolean;
  durationTicks: number;
  rejectionReasons: readonly string[];
}>;

export type RenovationEvaluation = RenovationProposal & Readonly<{
  destinationUse: UseType;
}>;

export const RENOVATION_SCOPES: Readonly<Record<RenovationScope, Readonly<{
  costPerM2: number;
  durationTicks: number;
  targetCondition: number;
  effectiveAgeMultiplier: number;
  requiresVacancy: boolean;
}>>> = Object.freeze({
  light: Object.freeze({
    costPerM2: 180,
    durationTicks: 20,
    targetCondition: 68,
    effectiveAgeMultiplier: 0.90,
    requiresVacancy: false,
  }),
  major: Object.freeze({
    costPerM2: 520,
    durationTicks: 55,
    targetCondition: 82,
    effectiveAgeMultiplier: 0.55,
    requiresVacancy: true,
  }),
  gut: Object.freeze({
    costPerM2: 900,
    durationTicks: 90,
    targetCondition: 94,
    effectiveAgeMultiplier: 0.25,
    requiresVacancy: true,
  }),
});

export class RenovationSystem {
  propose(
    building: BuildingV2,
    typology: BuildingTypology,
    market: RenovationMarketContext,
    scope: RenovationScope,
  ): RenovationProposal {
    validateBuilding(building, typology);
    validateMarket(market);
    const definition = RENOVATION_SCOPES[scope];
    if (!definition) throw new Error(`unknown renovation scope: ${scope}`);

    const cost = building.grossFloorAreaM2 * definition.costPerM2;
    const financingCost = cost * market.financingRate * (definition.durationTicks / TICKS_PER_YEAR);
    const totalInvestment = cost + financingCost;
    const valueGain = market.projectedPropertyValue - market.currentPropertyValue;
    const expectedReturn = totalInvestment > 0
      ? (valueGain - totalInvestment) / totalInvestment
      : valueGain > 0
        ? Number.POSITIVE_INFINITY
        : 0;

    const projectedCondition = Math.max(building.lifecycle.condition, definition.targetCondition);
    const projectedStructuralCondition = Math.max(building.lifecycle.structuralCondition, definition.targetCondition);
    const projectedSystemsCondition = Math.max(building.lifecycle.systemsCondition, definition.targetCondition);
    const projectedExteriorCondition = Math.max(building.lifecycle.exteriorCondition, definition.targetCondition);
    const projectedEffectiveAge = Math.min(
      building.lifecycle.effectiveAge,
      building.lifecycle.effectiveAge * definition.effectiveAgeMultiplier,
    );

    const rejectionReasons: string[] = [];
    if (market.projectedPropertyValue <= market.currentPropertyValue) rejectionReasons.push('no-value-uplift');
    if (expectedReturn < market.hurdleRate) rejectionReasons.push('return-below-hurdle');

    return Object.freeze({
      scope,
      feasible: rejectionReasons.length === 0,
      cost,
      financingCost,
      totalInvestment,
      projectedCondition,
      projectedStructuralCondition,
      projectedSystemsCondition,
      projectedExteriorCondition,
      projectedEffectiveAge,
      expectedReturn,
      requiresVacancy: definition.requiresVacancy,
      durationTicks: definition.durationTicks,
      rejectionReasons: Object.freeze(rejectionReasons),
    });
  }

  evaluateAdaptiveReuse(
    building: BuildingV2,
    destinationUse: UseType,
    envelope: ParcelDevelopmentEnvelope,
    market: RenovationMarketContext,
  ): RenovationEvaluation {
    const typology = getBuildingTypology(building.typologyId);
    const proposal = this.propose(building, typology, market, 'gut');
    const rejectionReasons = [...proposal.rejectionReasons];

    if (!envelope.permittedUses.includes(destinationUse)) {
      rejectionReasons.unshift('destination-use-prohibited');
    }
    if ((typology.conversionSuitability ?? 0) <= 0) {
      rejectionReasons.push('conversion-unsuitable');
    }
    if (!building.parcelIds.includes(envelope.parcelId)) {
      rejectionReasons.push('parcel-mismatch');
    }

    return Object.freeze({
      ...proposal,
      destinationUse,
      feasible: rejectionReasons.length === 0,
      rejectionReasons: Object.freeze(rejectionReasons),
    });
  }

  start(
    building: BuildingV2,
    proposal: RenovationProposal | RenovationEvaluation,
    tick: number,
    relocationComplete: boolean,
  ): BuildingV2 {
    validateTick(tick);
    if (!proposal.feasible) {
      throw new Error(`cannot start infeasible renovation: ${proposal.rejectionReasons.join(', ')}`);
    }
    if (building.status !== 'occupied' && building.status !== 'vacant' && building.status !== 'abandoned') {
      throw new Error(`building status does not permit renovation: ${building.status}`);
    }
    if (building.project && building.project.phase !== 'none') {
      throw new Error(`building already has an active project: ${building.project.phase}`);
    }
    if (proposal.requiresVacancy && !relocationComplete) {
      throw new Error('relocation must be complete before renovation can start');
    }

    const destinationUse = 'destinationUse' in proposal ? proposal.destinationUse : undefined;
    const project: BuildingProjectState = Object.freeze({
      phase: 'fit-out',
      startedTick: tick,
      completionTick: tick + proposal.durationTicks,
      progress: 0,
      kind: destinationUse === undefined ? 'renovation' : 'adaptive-reuse',
      renovationScope: proposal.scope,
      targetCondition: proposal.projectedCondition,
      targetStructuralCondition: proposal.projectedStructuralCondition,
      targetSystemsCondition: proposal.projectedSystemsCondition,
      targetExteriorCondition: proposal.projectedExteriorCondition,
      targetEffectiveAge: proposal.projectedEffectiveAge,
      ...(destinationUse === undefined ? {} : { destinationUse }),
    });

    return Object.freeze({
      ...building,
      status: 'renovation',
      project,
    });
  }

  tick(building: BuildingV2, tick: number): BuildingV2 {
    validateTick(tick);
    const project = building.project;
    if (building.status !== 'renovation' || !project || project.phase !== 'fit-out') return building;
    if (project.startedTick === undefined || project.completionTick === undefined) {
      throw new Error('renovation project is missing timing state');
    }
    if (project.renovationScope === undefined) {
      throw new Error('renovation project is missing scope');
    }

    if (tick < project.completionTick) {
      const duration = Math.max(1, project.completionTick - project.startedTick);
      const progress = clamp((tick - project.startedTick) / duration, 0, 1);
      if (progress === project.progress) return building;
      return Object.freeze({
        ...building,
        project: Object.freeze({ ...project, progress }),
      });
    }

    const targetCondition = requiredTarget(project.targetCondition, 'condition');
    const targetStructuralCondition = requiredTarget(project.targetStructuralCondition, 'structural condition');
    const targetSystemsCondition = requiredTarget(project.targetSystemsCondition, 'systems condition');
    const targetExteriorCondition = requiredTarget(project.targetExteriorCondition, 'exterior condition');
    const targetEffectiveAge = requiredTarget(project.targetEffectiveAge, 'effective age');
    const lifecycle = completedLifecycle(
      building.lifecycle,
      project.renovationScope,
      tick,
      targetCondition,
      targetStructuralCondition,
      targetSystemsCondition,
      targetExteriorCondition,
      targetEffectiveAge,
    );

    const completedProject: BuildingProjectState = Object.freeze({
      ...project,
      phase: 'none',
      progress: 1,
    });
    const entitlement = project.destinationUse === undefined
      ? building.entitlement
      : Object.freeze({
        ...building.entitlement,
        approvedUses: Object.freeze(uniqueUses([...building.entitlement.approvedUses, project.destinationUse])),
      });

    return Object.freeze({
      ...building,
      status: 'occupied',
      lifecycle,
      project: completedProject,
      entitlement,
    });
  }
}

function completedLifecycle(
  previous: BuildingLifecycleState,
  scope: RenovationScope,
  tick: number,
  targetCondition: number,
  targetStructuralCondition: number,
  targetSystemsCondition: number,
  targetExteriorCondition: number,
  targetEffectiveAge: number,
): BuildingLifecycleState {
  const condition = Math.max(previous.condition, targetCondition);
  const structuralCondition = Math.max(previous.structuralCondition, targetStructuralCondition);
  const systemsCondition = Math.max(previous.systemsCondition, targetSystemsCondition);
  const exteriorCondition = Math.max(previous.exteriorCondition, targetExteriorCondition);
  const effectiveAge = Math.min(previous.effectiveAge, targetEffectiveAge);
  const distressScore = clamp((100 - condition) * 0.35, 0, 100);
  const majorRenovationTick = scope === 'major' || scope === 'gut'
    ? tick
    : previous.lastMajorRenovationTick;

  return Object.freeze({
    ageTicks: previous.ageTicks,
    condition,
    structuralCondition,
    systemsCondition,
    exteriorCondition,
    maintenanceBacklog: 0,
    deferredMaintenanceTicks: 0,
    effectiveAge,
    vacancyDurationTicks: 0,
    distressScore,
    ...(majorRenovationTick === undefined ? {} : { lastMajorRenovationTick: majorRenovationTick }),
  });
}

function validateBuilding(building: BuildingV2, typology: BuildingTypology): void {
  if (building.typologyId !== typology.id) {
    throw new Error(`building typology mismatch: ${building.typologyId} !== ${typology.id}`);
  }
  if (!Number.isFinite(building.grossFloorAreaM2) || building.grossFloorAreaM2 <= 0) {
    throw new Error('building grossFloorAreaM2 must be positive and finite');
  }
  for (const [name, value] of [
    ['condition', building.lifecycle.condition],
    ['structuralCondition', building.lifecycle.structuralCondition],
    ['systemsCondition', building.lifecycle.systemsCondition],
    ['exteriorCondition', building.lifecycle.exteriorCondition],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new Error(`building lifecycle ${name} must be within [0, 100]`);
    }
  }
  if (!Number.isFinite(building.lifecycle.effectiveAge) || building.lifecycle.effectiveAge < 0) {
    throw new Error('building lifecycle effectiveAge must be finite and non-negative');
  }
}

function validateMarket(market: RenovationMarketContext): void {
  for (const [name, value] of [
    ['currentPropertyValue', market.currentPropertyValue],
    ['projectedPropertyValue', market.projectedPropertyValue],
    ['hurdleRate', market.hurdleRate],
    ['financingRate', market.financingRate],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be finite and non-negative`);
  }
  if (market.hurdleRate > 1) throw new Error('hurdleRate must not exceed 1');
  if (market.financingRate > 1) throw new Error('financingRate must not exceed 1');
}

function validateTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) throw new Error('tick must be a non-negative integer');
}

function requiredTarget(value: number | undefined, label: string): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`renovation project is missing valid target ${label}`);
  }
  return value;
}

function uniqueUses(uses: readonly UseType[]): UseType[] {
  return [...new Set(uses)].sort((a, b) => a.localeCompare(b));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
