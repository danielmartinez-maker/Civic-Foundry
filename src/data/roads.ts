export type RoadType = 'local';

export type RoadDefinition = Readonly<{
  id: RoadType;
  constructionCostPerCell: number;
}>;

export const ROAD_DEFINITIONS: Readonly<Record<RoadType, RoadDefinition>> = Object.freeze({
  local: Object.freeze({ id: 'local', constructionCostPerCell: 40 }),
});
