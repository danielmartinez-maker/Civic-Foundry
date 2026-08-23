export type RoadType = 'local' | 'collector' | 'arterial';

export type RoadDefinition = Readonly<{
  id: RoadType;
  constructionCostPerCell: number;
  freeFlowSpeedCellsPerSecond: number;
  weightedVehicleCapacityPerMinute: number;
  intersectionServiceRate: number;
  renderWidth: number;
}>;

export const ROAD_DEFINITIONS: Readonly<Record<RoadType, RoadDefinition>> = Object.freeze({
  local: Object.freeze({
    id: 'local', constructionCostPerCell: 40, freeFlowSpeedCellsPerSecond: 1.5,
    weightedVehicleCapacityPerMinute: 60, intersectionServiceRate: 6, renderWidth: 0.5,
  }),
  collector: Object.freeze({
    id: 'collector', constructionCostPerCell: 65, freeFlowSpeedCellsPerSecond: 2.5,
    weightedVehicleCapacityPerMinute: 120, intersectionServiceRate: 10, renderWidth: 0.68,
  }),
  arterial: Object.freeze({
    id: 'arterial', constructionCostPerCell: 100, freeFlowSpeedCellsPerSecond: 4,
    weightedVehicleCapacityPerMinute: 240, intersectionServiceRate: 16, renderWidth: 0.86,
  }),
});
