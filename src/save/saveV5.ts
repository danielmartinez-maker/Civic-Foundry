import { hydrateCore as hydrateLegacyCore, serializeCore as serializeLegacyCore, type SaveV4 } from './saveLegacy.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { TransitNetworkSnapshot } from '../simulation/transit/TransitNetworkSystem.ts';
import type { MobilitySchedulerStateSnapshot } from '../simulation/mobility/MobilityScheduler.ts';

export type SaveV5 = Omit<SaveV4, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 5;
  gameVersion: '0.5.0-metropolitan';
  transit: {
    network: TransitNetworkSnapshot;
    mobility: MobilitySchedulerStateSnapshot;
  };
};

export function serializeCoreV5(core: SimulationCore): SaveV5 {
  const legacy = serializeLegacyCore(core);
  return {
    ...legacy,
    saveVersion: 5,
    gameVersion: '0.5.0-metropolitan',
    transit: {
      network: core.transit.snapshot(),
      mobility: core.mobility.snapshotState(),
    },
  };
}

export function hydrateCoreV5(input: unknown): SimulationCore {
  if (!isRecord(input)) throw new Error('save must be an object');
  if (input.saveVersion !== 5) return hydrateLegacyCore(input);
  validateEnvelope(input);
  const save = input as unknown as SaveV5;
  const { transit, ...legacyFields } = save;
  const legacy: SaveV4 = {
    ...legacyFields,
    saveVersion: 4,
    gameVersion: '0.4.0-rebuild',
  };
  const core = hydrateLegacyCore(legacy);
  core.transit.restore(transit.network);
  validateMobilityReferences(core, transit.mobility);
  core.mobility.restoreState(transit.mobility);
  core.mobilitySnapshot = core.mobility.snapshot();

  const loads: Record<string, number> = { ...core.serviceVehicles.edgeLoads() };
  for (const [edgeId, load] of Object.entries(core.mobility.vehicles.edgeLoads())) loads[edgeId] = (loads[edgeId] ?? 0) + load;
  core.traffic.refreshMetrics(core.transportationGraph, loads);
  core.trafficSnapshot = core.trafficAnalytics.evaluate(core.traffic.edgeMetrics, core.traffic.recentOutcomes, core.traffic.activeVehicles.length);
  return core;
}

function validateEnvelope(record: Record<string, unknown>): void {
  if (record.gameVersion !== '0.5.0-metropolitan') throw new Error('invalid V5 game version');
  const transit = requireRecord(record.transit, 'transit');
  requireRecord(transit.network, 'transit.network');
  requireRecord(transit.mobility, 'transit.mobility');
}

function validateMobilityReferences(core: SimulationCore, state: MobilitySchedulerStateSnapshot): void {
  const stopIds = new Set(core.transit.listStops().map((stop) => stop.id));
  const lines = new Map(core.transit.listLines().map((line) => [line.id, line] as const));
  const validateCohort = (cohort: { lineId: string; boardingStopId: string; alightingStopId: string; transferLegs: readonly { lineId: string; boardingStopId: string; alightingStopId: string }[] }): void => {
    if (!lines.has(cohort.lineId) || !stopIds.has(cohort.boardingStopId) || !stopIds.has(cohort.alightingStopId)) throw new Error('invalid transit passenger reference');
    for (const leg of cohort.transferLegs) if (!lines.has(leg.lineId) || !stopIds.has(leg.boardingStopId) || !stopIds.has(leg.alightingStopId)) throw new Error('invalid transit transfer reference');
  };

  for (const queue of state.passengers.queues) {
    if (!lines.has(queue.lineId) || !stopIds.has(queue.stopId)) throw new Error('invalid transit queue reference');
    for (const cohort of queue.cohorts) validateCohort(cohort);
  }
  for (const vehicle of state.vehicles.vehicles) {
    const line = lines.get(vehicle.lineId);
    if (!line) throw new Error('invalid transit vehicle line reference');
    if (vehicle.stopIndex < 0 || vehicle.stopIndex >= line.stopIds.length) throw new Error('invalid transit vehicle stop index');
    for (const edgeId of vehicle.roadEdgeIds) if (!core.transportationGraph.getEdge(edgeId)) throw new Error('invalid transit vehicle road reference');
    for (const cohort of vehicle.onboard) validateCohort(cohort);
  }
  for (const lineState of state.operations.lines) if (!lines.has(lineState.lineId)) throw new Error('invalid transit operations line reference');
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
