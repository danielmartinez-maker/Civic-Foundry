import { TRANSIT_LIMITS, type TransitMode } from '../data/transit.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';

export type TransitCommandResult = Readonly<{ ok: boolean; reason?: string }>;
export type TransitLineConfigPatch = Readonly<{ headwayTicks: number; fare: number; fleetLimit: number; enabled: boolean }>;

export type TransitPanelLineState = Readonly<{
  id: string;
  name: string;
  mode: TransitMode;
  stopIds: readonly string[];
  headwayTicks: number;
  fare: number;
  enabled: boolean;
  fleetLimit: number;
  activeVehicles: number;
  ridership: number;
  reliability: number;
  operatingCost: number;
  fareRevenue: number;
  costRecovery: number;
}>;

export type TransitPanelState = Readonly<{
  stops: readonly Readonly<{ id: string; type: string; x: number; y: number; lines: readonly string[]; waitingWeight: number }>[];
  lines: readonly TransitPanelLineState[];
  modeShare: number;
  personAccessibility: number;
  meanWaitTicks: number;
  crowding: number;
}>;

export function collectTransitPanelState(core: SimulationCore): TransitPanelState {
  const lines = core.transit.listLines().map((line): TransitPanelLineState => {
    const operations = core.mobility.operations.snapshotLineWithVehicles(line.id, core.mobility.vehicles);
    return Object.freeze({
      id: line.id,
      name: line.name,
      mode: line.mode,
      stopIds: Object.freeze([...line.stopIds]),
      headwayTicks: line.headwayTicks,
      fare: line.fare,
      enabled: line.enabled,
      fleetLimit: operations.fleetLimit,
      activeVehicles: operations.activeVehicles,
      ridership: operations.completedPassengerWeight,
      reliability: operations.reliability,
      operatingCost: operations.operatingCost,
      fareRevenue: operations.fareRevenue,
      costRecovery: operations.costRecovery,
    });
  });
  const queueSnapshot = core.mobility.passengers.snapshot();
  const stops = core.transit.listStops().map((stop) => {
    const servedBy = lines.filter((line) => line.stopIds.includes(stop.id)).map((line) => line.id).sort();
    const waitingWeight = queueSnapshot.queues
      .filter((queue) => queue.stopId === stop.id)
      .reduce((sum, queue) => sum + queue.cohorts.reduce((inner, cohort) => inner + cohort.travelerWeight, 0), 0);
    return Object.freeze({ id: stop.id, type: stop.type, x: stop.x, y: stop.y, lines: Object.freeze(servedBy), waitingWeight });
  });
  return Object.freeze({
    stops: Object.freeze(stops),
    lines: Object.freeze(lines),
    modeShare: core.mobilitySnapshot.transitModeShare,
    personAccessibility: core.mobilitySnapshot.personAccessibility,
    meanWaitTicks: core.mobilitySnapshot.meanWaitTicks,
    crowding: core.mobilitySnapshot.crowding,
  });
}

export class TransitPanelController {
  private readonly core: SimulationCore;

  constructor(core: SimulationCore) {
    this.core = core;
  }

  createLine(mode: TransitMode, name = ''): string {
    return this.core.transit.createLine(mode, name);
  }

  setLineStops(lineId: string, stopIds: readonly string[]): TransitCommandResult {
    return this.core.transit.setLineStops(lineId, stopIds);
  }

  appendStop(lineId: string, stopId: string): TransitCommandResult {
    const line = this.core.transit.getLine(lineId);
    if (!line) return { ok: false, reason: 'unknown line' };
    if (line.stopIds.includes(stopId)) return { ok: false, reason: 'stop already belongs to line' };
    return this.setLineStops(lineId, [...line.stopIds, stopId]);
  }

  removeStop(lineId: string, stopId: string): TransitCommandResult {
    const line = this.core.transit.getLine(lineId);
    if (!line) return { ok: false, reason: 'unknown line' };
    const next = line.stopIds.filter((id) => id !== stopId);
    if (next.length < 2) return { ok: false, reason: 'line requires at least two stops' };
    return this.setLineStops(lineId, next);
  }

  applyLineConfig(lineId: string, patch: TransitLineConfigPatch): TransitCommandResult {
    const line = this.core.transit.getLine(lineId);
    if (!line) return { ok: false, reason: 'unknown line' };
    if (!Number.isFinite(patch.headwayTicks)) return { ok: false, reason: 'headway must be finite' };
    if (!Number.isFinite(patch.fare)) return { ok: false, reason: 'fare must be finite' };
    if (!Number.isFinite(patch.fleetLimit) || patch.fleetLimit < 0) return { ok: false, reason: 'fleet limit must be a non-negative finite number' };
    if (patch.enabled && line.stopIds.length < 2) return { ok: false, reason: 'line requires at least two compatible stops' };

    const headway = Math.round(Math.max(TRANSIT_LIMITS.minHeadwayTicks, Math.min(TRANSIT_LIMITS.maxHeadwayTicks, patch.headwayTicks)));
    const fare = Math.round(Math.max(TRANSIT_LIMITS.minFare, Math.min(TRANSIT_LIMITS.maxFare, patch.fare)) * 100) / 100;
    const fleetLimit = Math.max(0, Math.floor(patch.fleetLimit));
    try {
      this.core.transit.setHeadway(lineId, headway);
      this.core.transit.setFare(lineId, fare);
      this.core.mobility.operations.setFleetLimit(lineId, fleetLimit);
      this.core.transit.setEnabled(lineId, patch.enabled);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'transit configuration failed' };
    }
  }

  setHeadway(lineId: string, ticks: number): TransitCommandResult {
    try {
      this.core.transit.setHeadway(lineId, ticks);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'headway update failed' };
    }
  }

  setFare(lineId: string, fare: number): TransitCommandResult {
    try {
      this.core.transit.setFare(lineId, fare);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'fare update failed' };
    }
  }

  setEnabled(lineId: string, enabled: boolean): TransitCommandResult {
    try {
      const accepted = this.core.transit.setEnabled(lineId, enabled);
      return enabled && !accepted ? { ok: false, reason: 'line requires at least two compatible stops' } : { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'line status update failed' };
    }
  }

  setFleetLimit(lineId: string, count: number): TransitCommandResult {
    if (!this.core.transit.getLine(lineId)) return { ok: false, reason: 'unknown line' };
    this.core.mobility.operations.setFleetLimit(lineId, count);
    return { ok: true };
  }
}
