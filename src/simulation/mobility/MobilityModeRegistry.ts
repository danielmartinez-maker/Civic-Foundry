import type { MobilityModeDefinition, MobilityModeId } from './MobilityTypes.ts';

const CANONICAL_MODE_ORDER = Object.freeze([
  'walk',
  'bicycle',
  'car',
  'ride_hail',
  'bus',
  'trolleybus',
  'brt',
  'tram',
  'metro',
  'commuter_rail',
  'regional_rail',
  'ferry',
] as const satisfies readonly MobilityModeId[]);

export const MOBILITY_MODE_DEFINITIONS: Readonly<Record<MobilityModeId, MobilityModeDefinition>> = Object.freeze({
  walk: Object.freeze({
    id: 'walk', label: 'Walk', family: 'active', infrastructureFamily: 'pedestrian',
    scheduled: false, capacityConstrained: false, ordinaryRoadCapacity: false,
    dedicatedGuideway: false, providerPriority: 30,
  }),
  bicycle: Object.freeze({
    id: 'bicycle', label: 'Bicycle', family: 'active', infrastructureFamily: 'bicycle',
    scheduled: false, capacityConstrained: false, ordinaryRoadCapacity: false,
    dedicatedGuideway: false, providerPriority: 30,
  }),
  car: Object.freeze({
    id: 'car', label: 'Private Car', family: 'private_vehicle', infrastructureFamily: 'road',
    scheduled: false, capacityConstrained: false, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 10,
  }),
  ride_hail: Object.freeze({
    id: 'ride_hail', label: 'Taxi / Ride-Hail', family: 'for_hire', infrastructureFamily: 'road',
    scheduled: false, capacityConstrained: true, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 30,
  }),
  bus: Object.freeze({
    id: 'bus', label: 'Bus', family: 'surface_transit', infrastructureFamily: 'road',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 20,
  }),
  trolleybus: Object.freeze({
    id: 'trolleybus', label: 'Trolleybus', family: 'surface_transit', infrastructureFamily: 'electric_road',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 30,
  }),
  brt: Object.freeze({
    id: 'brt', label: 'BRT', family: 'surface_transit', infrastructureFamily: 'road',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 20,
  }),
  tram: Object.freeze({
    id: 'tram', label: 'Tram', family: 'surface_transit', infrastructureFamily: 'rail',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: true,
    dedicatedGuideway: false, providerPriority: 20,
  }),
  metro: Object.freeze({
    id: 'metro', label: 'Metro', family: 'rail_transit', infrastructureFamily: 'rail',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: false,
    dedicatedGuideway: true, providerPriority: 20,
  }),
  commuter_rail: Object.freeze({
    id: 'commuter_rail', label: 'Commuter Rail', family: 'rail_transit', infrastructureFamily: 'rail',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: false,
    dedicatedGuideway: true, providerPriority: 30,
  }),
  regional_rail: Object.freeze({
    id: 'regional_rail', label: 'Regional Rail', family: 'rail_transit', infrastructureFamily: 'rail',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: false,
    dedicatedGuideway: true, providerPriority: 30,
  }),
  ferry: Object.freeze({
    id: 'ferry', label: 'Ferry', family: 'water_transit', infrastructureFamily: 'water',
    scheduled: true, capacityConstrained: true, ordinaryRoadCapacity: false,
    dedicatedGuideway: true, providerPriority: 30,
  }),
});

export function getMobilityMode(id: MobilityModeId): MobilityModeDefinition | undefined {
  return MOBILITY_MODE_DEFINITIONS[id];
}

export function listMobilityModes(): readonly MobilityModeDefinition[] {
  return Object.freeze(CANONICAL_MODE_ORDER.map((id) => MOBILITY_MODE_DEFINITIONS[id]));
}
