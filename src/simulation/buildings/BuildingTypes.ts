import type { PolygonRing } from '../../world/cadastre/Geometry.ts';
import type { UseType } from '../zoning/ZoningTypes.ts';

export type BuildingV2Status =
  | 'proposed'
  | 'entitlement'
  | 'demolition'
  | 'construction'
  | 'occupied'
  | 'renovation'
  | 'vacant'
  | 'abandoned';

export type FloorUseAllocation = Readonly<{
  use: UseType;
  floorAreaM2: number;
  residentialUnits?: number;
  jobs?: number;
  hotelRooms?: number;
  storageCapacity?: number;
}>;

export type BuildingFloor = Readonly<{
  level: number;
  elevationMeters: number;
  grossAreaM2: number;
  usableAreaM2?: number;
  uses: readonly FloorUseAllocation[];
}>;

export type BuildingLifecycleState = Readonly<{
  ageTicks: number;
  condition: number;
  structuralCondition: number;
  systemsCondition: number;
  exteriorCondition: number;
  maintenanceBacklog: number;
  deferredMaintenanceTicks: number;
  lastMajorRenovationTick?: number;
  effectiveAge: number;
  vacancyDurationTicks: number;
  distressScore: number;
}>;

export type BuildingEntitlement = Readonly<{
  approvalTick: number;
  zoningDistrictId: string;
  approvedFAR: number;
  approvedHeightMeters: number;
  approvedUses: readonly UseType[];
  legalNonconforming?: boolean;
}>;

export type BuildingProjectPhase =
  | 'none'
  | 'entitlement'
  | 'relocation'
  | 'demolition'
  | 'foundation'
  | 'structure'
  | 'enclosure'
  | 'fit-out'
  | 'lease-up';

export type BuildingProjectKind = 'new-build' | 'renovation' | 'adaptive-reuse' | 'demolition';
export type BuildingRenovationScope = 'light' | 'major' | 'gut';

export type BuildingProjectState = Readonly<{
  phase: BuildingProjectPhase;
  startedTick?: number;
  completionTick?: number;
  progress: number;
  kind?: BuildingProjectKind;
  renovationScope?: BuildingRenovationScope;
  targetCondition?: number;
  targetStructuralCondition?: number;
  targetSystemsCondition?: number;
  targetExteriorCondition?: number;
  targetEffectiveAge?: number;
  destinationUse?: UseType;
}>;

export type BuildingV2 = Readonly<{
  id: string;
  parcelIds: readonly string[];
  typologyId: string;
  footprint: PolygonRing;
  grossFloorAreaM2: number;
  usableFloorAreaM2: number;
  heightMeters: number;
  stories: number;
  realizedFAR: number;
  coverageRatio: number;
  floors: readonly BuildingFloor[];
  status: BuildingV2Status;
  yearBuilt: number;
  developerId?: string;
  ownerId?: string;
  projectCost: number;
  entitlement: BuildingEntitlement;
  lifecycle: BuildingLifecycleState;
  project?: BuildingProjectState;
}>;

export type BuildingTypology = Readonly<{
  id: string;
  name: string;
  legacyDefinitionId?: string;
  primaryUse: UseType;
  allowedUses: readonly UseType[];
  defaultUseMix: Readonly<Partial<Record<UseType, number>>>;
  preferredStories: number;
  minStories: number;
  maxStories: number;
  floorToFloorHeightMeters: number;
  efficiencyRatio: number;
  costPerM2: number;
  maintenanceCostPerM2: number;
  constructionTicksPer1000M2: number;
  averageResidentialUnitAreaM2: number;
  jobsPer1000M2ByUse: Readonly<Partial<Record<UseType, number>>>;
  powerDemandPer1000M2: number;
  waterDemandPer1000M2: number;
  garbagePer1000M2: number;
  taxBasePerM2: number;
  baseRentPerM2ByUse: Readonly<Partial<Record<UseType, number>>>;
  operatingExpenseRatio: number;
  baseVacancy: number;
  baseCapRate: number;
  minimumAccess: number;
  minimumUtilityRatio: number;
  minimumServiceQuality: number;
  complexityFactor: number;
  riskWeight: number;
  conversionSuitability?: number;
}>;

export type DevelopmentCandidate = Readonly<{
  id: string;
  parcelIds: readonly string[];
  typologyId: string;
  targetUtilization: number;
  footprint: PolygonRing;
  grossFloorAreaM2: number;
  usableFloorAreaM2: number;
  heightMeters: number;
  stories: number;
  realizedFAR: number;
  coverageRatio: number;
  floors: readonly BuildingFloor[];
  uses: readonly UseType[];
  zoningLegal: boolean;
}>;

export type BuildingMetrics = Readonly<{
  grossFloorAreaM2: number;
  usableFloorAreaM2: number;
  floorAreaByUse: Readonly<Record<UseType, number>>;
  residentialUnits: number;
  jobCapacity: number;
  hotelRooms: number;
  storageCapacity: number;
  powerDemand: number;
  waterDemand: number;
  garbageGeneration: number;
  taxBase: number;
}>;

export const NEW_BUILDING_LIFECYCLE: BuildingLifecycleState = Object.freeze({
  ageTicks: 0,
  condition: 100,
  structuralCondition: 100,
  systemsCondition: 100,
  exteriorCondition: 100,
  maintenanceBacklog: 0,
  deferredMaintenanceTicks: 0,
  effectiveAge: 0,
  vacancyDurationTicks: 0,
  distressScore: 0,
});
