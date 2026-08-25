export type UrbanUse = 'residential' | 'commercial' | 'industrial';

export type BuildingQualityTier = 'economy' | 'standard' | 'premium' | 'luxury';
export type BuildingConditionBand = 'new' | 'maintained' | 'aging' | 'neglected' | 'abandoned';
export type PrivateParkingProfile = 'legacy-none' | 'reduced' | 'standard' | 'abundant' | 'structured';

export type UrbanLifecycleState =
  | 'construction'
  | 'lease-up'
  | 'stabilized'
  | 'aging'
  | 'neglected'
  | 'renovating'
  | 'condemned'
  | 'abandoned';

export type UrbanUseComponent = Readonly<{
  use: UrbanUse;
  areaShareBps: number;
  residentCapacity: number;
  jobCapacity: number;
  taxBase: number;
}>;

export type UrbanParkingState = Readonly<{
  profile: PrivateParkingProfile;
  spaces: number;
}>;

export type UrbanBuildingState = Readonly<{
  buildingId: string;
  useComponents: readonly UrbanUseComponent[];
  qualityTier: BuildingQualityTier;
  conditionScore: number;
  lifecycleState: UrbanLifecycleState;
  conditionEstablishedTick: number;
  lastConditionTick: number;
  renovationCount: number;
  parking: UrbanParkingState;
}>;

export type UrbanFabricStateSnapshot = Readonly<{
  buildings: readonly UrbanBuildingState[];
}>;

export type RenovationCommitment = Readonly<{
  buildingId: string;
  developerId: string;
  startTick: number;
  completionTick: number;
  cost: number;
  targetCondition: 90;
}>;

export type RenovationStateSnapshot = Readonly<{
  commitments: readonly RenovationCommitment[];
}>;

export type UrbanFabricValidationOptions = Readonly<{
  requireAllLiveBuildings?: boolean;
}>;
