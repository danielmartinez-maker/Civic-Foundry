import type { TransitMode } from '../data/transit.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';

export type TransitOverlayMode = 'none' | 'routes' | 'access' | 'ridership' | 'crowding' | 'wait' | 'reliability' | 'mode-share' | 'accessibility';
export type TransitOverlayStop = Readonly<{ stopId: string; x: number; y: number; value: number; label: string }>;
export type TransitOverlayRoute = Readonly<{ lineId: string; name: string; mode: TransitMode; stopIds: readonly string[]; value: number; label: string }>;
export type TransitOverlaySnapshot = Readonly<{
  mode: TransitOverlayMode;
  stops: readonly TransitOverlayStop[];
  routes: readonly TransitOverlayRoute[];
  globalValue: number | undefined;
  legend: string;
}>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const pct = (value: number): string => `${Math.round(clamp01(value) * 100)}%`;

export function mapTransitOverlay(core: SimulationCore, mode: TransitOverlayMode): TransitOverlaySnapshot {
  const queueSnapshot = core.mobility.passengers.snapshot();
  const queueByStop = new Map<string, { weight: number; waitWeight: number }>();
  for (const queue of queueSnapshot.queues) {
    const state = queueByStop.get(queue.stopId) ?? { weight: 0, waitWeight: 0 };
    for (const cohort of queue.cohorts) {
      const weight = Math.max(0, cohort.travelerWeight);
      state.weight += weight;
      state.waitWeight += Math.max(0, core.clock.tick - cohort.enqueuedTick) * weight;
    }
    queueByStop.set(queue.stopId, state);
  }

  const vehicles = core.mobility.vehicles.listVehicles();
  const routes = core.transit.listLines().map((line): TransitOverlayRoute => {
    const operations = core.mobility.operations.snapshotLineWithVehicles(line.id, core.mobility.vehicles);
    const lineVehicles = vehicles.filter((vehicle) => vehicle.lineId === line.id && vehicle.state !== 'out_of_service');
    const onboard = lineVehicles.reduce((sum, vehicle) => sum + vehicle.onboard.reduce((inner, cohort) => inner + cohort.travelerWeight, 0), 0);
    const capacity = lineVehicles.reduce((sum, vehicle) => sum + vehicle.capacity, 0);
    const crowding = capacity <= 0 ? 0 : onboard / capacity;
    const value = mode === 'ridership' ? operations.completedPassengerWeight
      : mode === 'crowding' ? clamp01(crowding)
      : mode === 'reliability' ? clamp01(operations.reliability)
      : 1;
    const label = mode === 'ridership' ? `${operations.completedPassengerWeight.toFixed(0)} riders`
      : mode === 'crowding' ? pct(crowding)
      : mode === 'reliability' ? pct(operations.reliability)
      : `${line.name} · ${line.mode}`;
    return Object.freeze({ lineId: line.id, name: line.name, mode: line.mode, stopIds: Object.freeze([...line.stopIds]), value, label });
  });

  const stops = core.transit.listStops().map((stop): TransitOverlayStop => {
    const queue = queueByStop.get(stop.id) ?? { weight: 0, waitWeight: 0 };
    const meanWait = queue.weight <= 0 ? 0 : queue.waitWeight / queue.weight;
    const value = mode === 'access' ? 8 : mode === 'wait' ? meanWait : queue.weight;
    const label = mode === 'access' ? '8 ticks access'
      : mode === 'wait' ? `${meanWait.toFixed(1)} ticks`
      : `${queue.weight.toFixed(0)} waiting`;
    return Object.freeze({ stopId: stop.id, x: stop.x, y: stop.y, value, label });
  });

  const globalValue = mode === 'mode-share' ? core.mobilitySnapshot.transitModeShare
    : mode === 'accessibility' ? core.mobilitySnapshot.personAccessibility
    : undefined;
  const maxRidership = Math.max(0, ...routes.map((route) => mode === 'ridership' ? route.value : 0));
  const maxWait = Math.max(core.mobilitySnapshot.meanWaitTicks, ...stops.map((stop) => mode === 'wait' ? stop.value : 0), 0);
  const legends: Record<TransitOverlayMode, string> = {
    none: 'Transit overlay off.',
    routes: 'Transit routes: line labels show mode; route thickness identifies active service.',
    access: 'Stop access connector: 8 walking ticks from an adjacent road node.',
    ridership: `Ridership: 0 → ${Math.max(1, Math.ceil(maxRidership))} completed weighted riders per line.`,
    crowding: 'Vehicle crowding: 0% empty → 100% full capacity.',
    wait: `Passenger wait: 0 → ${Math.max(1, Math.ceil(maxWait))} ticks at stops.`,
    reliability: 'Line reliability: 0% severe delay → 100% on-time operation.',
    'mode-share': `Transit mode share: 0% → 100%; current ${pct(core.mobilitySnapshot.transitModeShare)}.`,
    accessibility: `Person accessibility: 0% → 100%; current ${pct(core.mobilitySnapshot.personAccessibility)}.`,
  };
  return Object.freeze({ mode, stops: Object.freeze(stops), routes: Object.freeze(routes), globalValue, legend: legends[mode] });
}
