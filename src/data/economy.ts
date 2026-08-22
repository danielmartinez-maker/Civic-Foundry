export type Commodity = 'industrial_inputs' | 'manufactured_goods' | 'consumer_goods';
export type FirmArchetype = 'retail_local' | 'wholesale_logistics' | 'light_manufacturing' | 'assembly_manufacturing';

export type ArchetypeDefinition = Readonly<{
  zone: 'commercial' | 'industrial';
  jobCapacity: number;
  baseProductivity: number;
  storageCapacity: number;
  targetStock: Partial<Record<Commodity, number>>;
  consumes?: Readonly<{ commodity: Commodity; units: number }>;
  produces?: Readonly<{ commodity: Commodity; units: number }>;
  freightIntensity: number;
}>;

export const ECONOMY_CADENCE = Object.freeze({ production: 50, replenishment: 100, lifecycle: 250 });
export const ECONOMY_PRICES = Object.freeze({
  industrial_inputs: 8,
  manufactured_goods: 16,
  consumer_goods: 24,
  wagePerJob: 0.35,
  utilityPerJob: 0.08,
  taxRateProxy: 0.08,
  gatewayHandlingPerUnit: 0.4,
  logisticsPerTickUnit: 0.002,
});
export const LIFECYCLE = Object.freeze({
  initialCashHealth: 0.6,
  distressHealth: 0.28,
  closeHealth: 0.08,
  recoverHealth: 0.45,
  lossCyclesToClose: 4,
  recoveryCyclesToOperate: 2,
  formationThreshold: 0.35,
  healthMarginScale: 0.012,
});

export const ARCHETYPES: Readonly<Record<FirmArchetype, ArchetypeDefinition>> = Object.freeze({
  retail_local: { zone: 'commercial', jobCapacity: 8, baseProductivity: 1, storageCapacity: 40, targetStock: { consumer_goods: 20 }, consumes: { commodity: 'consumer_goods', units: 2 }, freightIntensity: 1 },
  wholesale_logistics: { zone: 'commercial', jobCapacity: 8, baseProductivity: 1, storageCapacity: 80, targetStock: { manufactured_goods: 30, consumer_goods: 20 }, consumes: { commodity: 'manufactured_goods', units: 2 }, produces: { commodity: 'consumer_goods', units: 2 }, freightIntensity: 1.5 },
  light_manufacturing: { zone: 'industrial', jobCapacity: 14, baseProductivity: 1, storageCapacity: 90, targetStock: { industrial_inputs: 30, manufactured_goods: 15 }, consumes: { commodity: 'industrial_inputs', units: 2 }, produces: { commodity: 'manufactured_goods', units: 2 }, freightIntensity: 1.5 },
  assembly_manufacturing: { zone: 'industrial', jobCapacity: 14, baseProductivity: 1.2, storageCapacity: 120, targetStock: { industrial_inputs: 40, manufactured_goods: 20 }, consumes: { commodity: 'industrial_inputs', units: 3 }, produces: { commodity: 'manufactured_goods', units: 3 }, freightIntensity: 2 },
});
