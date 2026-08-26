import type {
  MobilityAlternative,
  MobilityJourneyRequest,
  MobilityModeId,
  MobilityTravelerCapabilities,
} from '../../src/simulation/mobility/MobilityTypes.ts';

export const mobilityCapabilities = (
  overrides: Partial<MobilityTravelerCapabilities> = {},
): MobilityTravelerCapabilities => Object.freeze({
  privateVehicleAccess: true,
  licensedDriver: true,
  bicycleAccess: false,
  rideHailAvailable: false,
  mobilityLimited: false,
  farePaymentAccess: true,
  ...overrides,
});

export const mobilityRequest = (
  overrides: Partial<MobilityJourneyRequest> = {},
): MobilityJourneyRequest => Object.freeze({
  id: 'journey:1',
  sourceTripId: 'trip:1',
  provenance: 'legacy_cohort',
  originRoadNodeId: 'n:1,1',
  destinationRoadNodeId: 'n:2,1',
  departureTick: 100,
  travelerWeight: 1,
  purpose: 'commute',
  capabilities: mobilityCapabilities(),
  costEpoch: 10,
  ...overrides,
});

export const mobilityAlternative = (
  providerId: string,
  providerPriority: number,
  mode: MobilityModeId,
  id: string,
  generalizedCost: number,
): MobilityAlternative => Object.freeze({
  id,
  mode,
  providerId,
  providerPriority,
  cost: Object.freeze({
    accessEgressTicks: 0,
    expectedWaitTicks: 0,
    movementTicks: generalizedCost,
    transferPenaltyTicks: 0,
    fareImpedanceTicks: 0,
    parkingImpedanceTicks: 0,
    congestionDelayTicks: 0,
    crowdingPenaltyTicks: 0,
    reliabilityPenaltyTicks: 0,
    switchingPenaltyTicks: 0,
    generalizedCost,
  }),
  expectedArrivalTick: 100 + generalizedCost,
  execution: Object.freeze({ kind: 'synthetic' }),
});
