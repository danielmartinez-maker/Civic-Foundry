import type { UrbanUse, UrbanUseComponent } from '../simulation/urban/UrbanTypes.ts';

export type UrbanPrototypeTemplate = Readonly<{
  definitionId: string;
  dominantUse: UrbanUse;
  components: readonly UrbanUseComponent[];
}>;

function component(
  use: UrbanUse,
  areaShareBps: number,
  residentCapacity: number,
  jobCapacity: number,
  taxBase: number,
): UrbanUseComponent {
  return Object.freeze({ use, areaShareBps, residentCapacity, jobCapacity, taxBase });
}

function prototype(
  definitionId: string,
  dominantUse: UrbanUse,
  components: readonly UrbanUseComponent[],
): UrbanPrototypeTemplate {
  return Object.freeze({ definitionId, dominantUse, components: Object.freeze(components.slice()) });
}

const templates = [
  prototype('residential_cottage', 'residential', [component('residential', 10_000, 10, 0, 120)]),
  prototype('residential_rowhouse', 'residential', [component('residential', 10_000, 28, 0, 250)]),
  prototype('residential_apartment', 'residential', [component('residential', 10_000, 72, 0, 520)]),
  prototype('commercial_shop', 'commercial', [component('commercial', 10_000, 0, 8, 220)]),
  prototype('commercial_block', 'commercial', [component('commercial', 10_000, 0, 22, 480)]),
  prototype('commercial_office', 'commercial', [component('commercial', 10_000, 0, 45, 900)]),
  prototype('industrial_workshop', 'industrial', [component('industrial', 10_000, 0, 14, 320)]),
  prototype('industrial_warehouse', 'industrial', [component('industrial', 10_000, 0, 32, 650)]),
  prototype('industrial_plant', 'industrial', [component('industrial', 10_000, 0, 70, 1_300)]),
  prototype('residential_mainstreet_mixed', 'residential', [
    component('residential', 7_500, 22, 0, 260),
    component('commercial', 2_500, 0, 6, 90),
  ]),
  prototype('residential_urban_mixed', 'residential', [
    component('residential', 6_500, 52, 0, 480),
    component('commercial', 3_500, 0, 16, 240),
  ]),
  prototype('commercial_mixed_block', 'commercial', [
    component('commercial', 6_000, 0, 18, 420),
    component('residential', 4_000, 14, 0, 180),
  ]),
  prototype('commercial_mixed_tower', 'commercial', [
    component('commercial', 5_500, 0, 38, 760),
    component('residential', 4_500, 30, 0, 360),
  ]),
] as const;

export const URBAN_PROTOTYPES: readonly UrbanPrototypeTemplate[] = Object.freeze(templates.slice());

export const URBAN_PROTOTYPE_BY_DEFINITION_ID: Readonly<Record<string, UrbanPrototypeTemplate>> = Object.freeze(
  Object.fromEntries(URBAN_PROTOTYPES.map((item) => [item.definitionId, item])) as Record<string, UrbanPrototypeTemplate>,
);

export function getUrbanPrototype(definitionId: string): UrbanPrototypeTemplate {
  const result = URBAN_PROTOTYPE_BY_DEFINITION_ID[definitionId];
  if (!result) throw new Error(`unknown urban prototype: ${definitionId}`);
  return result;
}
