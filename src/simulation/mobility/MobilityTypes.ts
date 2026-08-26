export type MobilityModeId =
  | 'walk'
  | 'bicycle'
  | 'car'
  | 'ride_hail'
  | 'bus'
  | 'trolleybus'
  | 'brt'
  | 'tram'
  | 'metro'
  | 'commuter_rail'
  | 'regional_rail'
  | 'ferry';

export type MobilityModeFamily =
  | 'active'
  | 'private_vehicle'
  | 'for_hire'
  | 'surface_transit'
  | 'rail_transit'
  | 'water_transit';

export type MobilityInfrastructureFamily =
  | 'pedestrian'
  | 'bicycle'
  | 'road'
  | 'electric_road'
  | 'rail'
  | 'water';

export type MobilityModeDefinition = Readonly<{
  id: MobilityModeId;
  label: string;
  family: MobilityModeFamily;
  infrastructureFamily: MobilityInfrastructureFamily;
  scheduled: boolean;
  capacityConstrained: boolean;
  ordinaryRoadCapacity: boolean;
  dedicatedGuideway: boolean;
  providerPriority: number;
}>;

export type MobilityTravelerCapabilities = Readonly<{
  privateVehicleAccess: boolean;
  licensedDriver: boolean;
  bicycleAccess: boolean;
  rideHailAvailable: boolean;
  mobilityLimited: boolean;
  farePaymentAccess: boolean;
  maxWalkTicks?: number;
}>;

export type MobilityJourneyRequest = Readonly<{
  id: string;
  sourceTripId: string;
  provenance: 'legacy_cohort' | 'person';
  personId?: string;
  originRoadNodeId: string | null;
  destinationRoadNodeId: string | null;
  departureTick: number;
  travelerWeight: number;
  purpose: 'commute' | 'shopping';
  capabilities: MobilityTravelerCapabilities;
  costEpoch: number;
}>;

export type MobilityCostBreakdown = Readonly<{
  accessEgressTicks: number;
  expectedWaitTicks: number;
  movementTicks: number;
  transferPenaltyTicks: number;
  fareImpedanceTicks: number;
  parkingImpedanceTicks: number;
  congestionDelayTicks: number;
  crowdingPenaltyTicks: number;
  reliabilityPenaltyTicks: number;
  switchingPenaltyTicks: number;
  generalizedCost: number;
}>;

export type MobilityAlternative = Readonly<{
  id: string;
  mode: MobilityModeId;
  providerId: string;
  providerPriority: number;
  cost: MobilityCostBreakdown;
  expectedArrivalTick: number;
  execution: unknown;
}>;

export type MobilityChoiceOutcome = Readonly<{
  outcome: MobilityModeId | 'unmet';
  alternative: MobilityAlternative | null;
}>;
