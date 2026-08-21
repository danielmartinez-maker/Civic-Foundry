import type { ZoneType } from '../simulation/core/types.ts';

export type BuildingDefinition = Readonly<{
  id: string;
  zone: ZoneType;
  constructionTicks: number;
  residentCapacity: number;
  jobCapacity: number;
  powerDemand: number;
  waterDemand: number;
  garbageGeneration: number;
  taxBase: number;
}>;

export const BUILDING_DEFINITIONS: Readonly<Record<ZoneType, BuildingDefinition>> = Object.freeze({
  residential: Object.freeze({
    id: 'residential_cottage', zone: 'residential', constructionTicks: 50,
    residentCapacity: 10, jobCapacity: 0, powerDemand: 6, waterDemand: 5,
    garbageGeneration: 2, taxBase: 120,
  }),
  commercial: Object.freeze({
    id: 'commercial_shop', zone: 'commercial', constructionTicks: 65,
    residentCapacity: 0, jobCapacity: 8, powerDemand: 12, waterDemand: 7,
    garbageGeneration: 4, taxBase: 220,
  }),
  industrial: Object.freeze({
    id: 'industrial_workshop', zone: 'industrial', constructionTicks: 80,
    residentCapacity: 0, jobCapacity: 14, powerDemand: 22, waterDemand: 12,
    garbageGeneration: 8, taxBase: 320,
  }),
});
