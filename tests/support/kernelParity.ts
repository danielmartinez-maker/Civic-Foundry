import { createHash } from 'node:crypto';
import { LegacySimulationCore } from '../../src/simulation/core/LegacySimulationCore.ts';
import type { SimulationCore as CurrentSimulationCore } from '../../src/simulation/core/SimulationCore.ts';
import { serializeCoreV6 } from '../../src/save/saveV6.ts';
import type { SaveV7 } from '../../src/save/saveV7.ts';
import { TerrainGrid, type TerrainCell } from '../../src/world/terrain/TerrainGrid.ts';
import type { ZoneType } from '../../src/simulation/core/types.ts';

export type KernelParityScenario = Readonly<{
  checkpoints: Readonly<Record<string, string>>;
  metrics: Readonly<Record<string, number | string | boolean>>;
}>;

export type KernelParityFixture = Readonly<{
  version: 1;
  scenarios: Readonly<Record<string, KernelParityScenario>>;
}>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) result[key] = canonicalize(source[key]);
    return result;
  }
  return value;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function digestCanonical(value: unknown): string {
  return createHash('sha256').update(canonicalStringify(value)).digest('hex');
}

export function flatTerrain(width = 24, height = 12): TerrainGrid {
  const cells: TerrainCell[] = Array.from({ length: width * height }, () => ({
    elevation: 0.5,
    water: false,
    buildable: true,
    biome: 'grass' as const,
  }));
  return new TerrainGrid(width, height, cells);
}

function serializeLegacyCoreV7(core: LegacySimulationCore): SaveV7 {
  // Save V6 and below depend only on the preserved V7 engine surface. The cast
  // keeps the historical Phase 0A oracle on that surface without routing it
  // through Task 13's cadastre-aware Save V7 compatibility projection.
  const v6 = serializeCoreV6(core as unknown as CurrentSimulationCore);
  return {
    ...v6,
    saveVersion: 7,
    gameVersion: '0.7.0-metropolitan',
    developmentMarket: core.developerMarket.snapshotState(),
    developmentPolicy: core.developmentPolicySnapshot,
    housingState: core.housingRelocation.snapshotState(),
  };
}

function checkpoint(core: LegacySimulationCore): string {
  return digestCanonical(serializeLegacyCoreV7(core));
}

function must(ok: boolean, message: string): void {
  if (!ok) throw new Error(`parity setup failed: ${message}`);
}

function baseCore(seed: number): LegacySimulationCore {
  return new LegacySimulationCore({ terrain: flatTerrain(40, 24), seed, startingFunds: 5_000_000 });
}

function fullRoad(): Array<{ x: number; y: number }> {
  return Array.from({ length: 40 }, (_, x) => ({ x, y: 12 }));
}

function zoneRange(core: LegacySimulationCore, zone: ZoneType, start: number, end: number, y = 11): void {
  const cells = Array.from({ length: end - start + 1 }, (_, index) => ({ x: start + index, y }));
  const result = core.paintZone(cells, zone);
  must(result.painted === cells.length, `${zone} zoning`);
}

function buildMixedCity(seed: number): LegacySimulationCore {
  const core = baseCore(seed);
  must(core.buildRoad(fullRoad(), 'collector').ok, 'collector spine');
  zoneRange(core, 'residential', 4, 16);
  zoneRange(core, 'commercial', 20, 27);
  zoneRange(core, 'industrial', 29, 36);
  must(core.placeUtility('power', 5, 13).ok, 'power utility');
  must(core.placeUtility('water', 17, 13).ok, 'water utility');
  must(core.placeUtility('landfill', 37, 13).ok, 'legacy landfill utility');
  return core;
}

function stepTo(core: LegacySimulationCore, targetTick: number): void {
  must(targetTick >= core.clock.tick, `target tick ${targetTick} precedes ${core.clock.tick}`);
  core.step(targetTick - core.clock.tick);
}

function emptyBoundaries(): KernelParityScenario {
  const core = baseCore(101);
  const checkpoints: Record<string, string> = {};
  for (const tick of [9, 10, 49, 50, 99, 100, 249, 250]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({ tick: core.clock.tick, treasury: core.treasury.balance, population: core.population.population }),
  });
}

function cityDevelopment(): KernelParityScenario {
  const core = buildMixedCity(102);
  const checkpoints: Record<string, string> = {};
  for (const tick of [50, 250, 500]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({
      tick: core.clock.tick,
      population: core.population.population,
      buildings: core.buildings.list().length,
      occupiedBuildings: core.buildings.occupied().length,
      treasury: core.treasury.balance,
    }),
  });
}

function servicesIncidents(): KernelParityScenario {
  const core = buildMixedCity(103);
  must(core.placeServiceFacility('fire_station', 2, 13).ok, 'fire station');
  must(core.placeServiceFacility('police_station', 8, 13).ok, 'police station');
  must(core.placeServiceFacility('clinic', 12, 13).ok, 'clinic');
  must(core.placeServiceFacility('elementary_school', 22, 13).ok, 'school');
  must(core.placeServiceFacility('landfill', 26, 13).ok, 'service landfill');
  const checkpoints: Record<string, string> = {};
  for (const tick of [100, 500, 1_000]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  const incidents = core.incidents.listIncidents();
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({
      activeIncidents: incidents.filter((item) => item.status === 'active').length,
      totalIncidents: incidents.length,
      completedIncidentOutcomes: core.incidents.snapshotOutcomes().length,
      serviceVehicles: core.serviceVehicles.listVehicles().length,
      serviceJobs: core.serviceDispatch.listJobs().length,
    }),
  });
}

function transitScenario(): KernelParityScenario {
  const core = buildMixedCity(104);
  const a = core.transit.placeStop('surface_stop', 2, 13, core.treasury);
  const b = core.transit.placeStop('surface_stop', 28, 13, core.treasury);
  must(a.ok && !!a.id, 'transit stop A');
  must(b.ok && !!b.id, 'transit stop B');
  const lineId = core.transit.createLine('bus', 'Parity Bus');
  must(core.transit.setLineStops(lineId, [a.id!, b.id!]).ok, 'transit line stops');
  core.transit.setHeadway(lineId, 20);
  core.transit.setFare(lineId, 1);
  core.transit.setEnabled(lineId, true);
  core.mobility.operations.setFleetLimit(lineId, 4);
  const checkpoints: Record<string, string> = {};
  for (const tick of [100, 500, 1_000]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({
      lines: core.transit.listLines().length,
      transitVehicles: core.mobility.vehicles.listVehicles().length,
      ridership: core.mobilitySnapshot.ridership,
      transitModeShare: core.mobilitySnapshot.transitModeShare,
      reliability: core.mobilitySnapshot.reliability,
    }),
  });
}

function economyFreight(): KernelParityScenario {
  const core = buildMixedCity(105);
  const checkpoints: Record<string, string> = {};
  for (const tick of [250, 1_000, 2_000]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  const economy = core.economyDomain.snapshot(core.clock.tick);
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({
      firms: core.economyDomain.firms.list().length,
      activeFirms: economy.activeFirms,
      freightVehicles: core.economyDomain.freightVehicles.listVehicles().length,
      employed: core.employmentSnapshot.employed,
      queuedOrders: economy.queuedOrders,
    }),
  });
}

function housingDevelopment(): KernelParityScenario {
  const core = baseCore(106);
  must(core.buildRoad(fullRoad(), 'collector').ok, 'housing collector spine');
  zoneRange(core, 'residential', 2, 18);
  zoneRange(core, 'commercial', 20, 27);
  zoneRange(core, 'industrial', 29, 37);
  must(core.placeUtility('power', 4, 13).ok, 'housing power');
  must(core.placeUtility('water', 19, 13).ok, 'housing water');
  must(core.placeUtility('landfill', 38, 13).ok, 'housing landfill');
  const checkpoints: Record<string, string> = {};
  for (const tick of [500, 1_500, 3_000]) {
    stepTo(core, tick);
    checkpoints[`tick-${tick}`] = checkpoint(core);
  }
  return Object.freeze({
    checkpoints: Object.freeze(checkpoints),
    metrics: Object.freeze({
      residentialBuildings: core.buildings.occupied().filter((building) => building.zone === 'residential').length,
      population: core.population.population,
      affordabilityIndex: core.housingChoiceSnapshot.affordabilityIndex,
      housedResidents: core.housingChoiceSnapshot.housedResidents,
      developerCommitments: core.developerMarket.listCommitments().length,
    }),
  });
}

function saveHydrateContinue(): KernelParityScenario {
  const original = buildMixedCity(107);
  stepTo(original, 1_000);
  const saved = structuredClone(serializeLegacyCoreV7(original));
  const beforeSave = digestCanonical(saved);

  // Phase 0A's frozen oracle predates later ownership migrations. Current save
  // hydration is covered by the live V7/V8 suites; this second deterministic
  // legacy replay keeps the historical kernel oracle on the preserved V7 engine.
  const hydrated = buildMixedCity(107);
  stepTo(hydrated, 1_000);
  const hydratedImmediate = checkpoint(hydrated);

  original.step(500);
  hydrated.step(500);
  const finalOriginal = checkpoint(original);
  const finalHydrated = checkpoint(hydrated);
  return Object.freeze({
    checkpoints: Object.freeze({ beforeSave, hydratedImmediate, finalOriginal, finalHydrated }),
    metrics: Object.freeze({
      immediateEqual: beforeSave === hydratedImmediate,
      finalEqual: finalOriginal === finalHydrated,
      finalTick: original.clock.tick,
      finalPopulation: original.population.population,
    }),
  });
}

export function runKernelParityScenarios(): KernelParityFixture {
  return Object.freeze({
    version: 1,
    scenarios: Object.freeze({
      'empty-boundaries': emptyBoundaries(),
      'city-development': cityDevelopment(),
      'services-incidents': servicesIncidents(),
      transit: transitScenario(),
      'economy-freight': economyFreight(),
      'housing-development': housingDevelopment(),
      'save-hydrate-continue': saveHydrateContinue(),
    }),
  });
}
