import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { locateFreightVehicle } from '../FreightVehicleRenderer.ts';
import { locateServiceVehicle } from '../ServiceVehicleRenderer.ts';
import { locateTransitVehicle } from '../TransitVehicleRenderer.ts';
import { PASS_A_ASSET_MANIFEST } from '../assets/PassAAssetManifest.ts';
import {
  privateVehicleVariantKey,
  serviceVehicleVariantKey,
  transitVehicleVariantKey,
  vehicleOrientationFromWorldDelta,
} from '../assets/VehicleVisuals.ts';
import type { QuarterTurn } from '../isometric/IsometricProjection.ts';
import { GpuAssetCatalog } from './GpuAssetCatalog.ts';

export type VehicleSpriteCommand = Readonly<{
  key: string;
  fingerprint: string;
  assetId: string;
  x: number;
  y: number;
  queued: boolean;
}>;

const catalog = new GpuAssetCatalog(PASS_A_ASSET_MANIFEST);

function resolveAsset(variantKey: string, orientation: 0 | 1 | 2 | 3): string {
  return catalog.resolveVariant(variantKey, orientation)?.assetId ?? `${variantKey}_o${orientation}`;
}

export function buildVehicleSpriteCommands(
  core: SimulationCore,
  quarterTurns: QuarterTurn,
): readonly VehicleSpriteCommand[] {
  const commands: VehicleSpriteCommand[] = [];
  const graph = core.transportationGraph;
  const travelTicks = new Map(core.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric.travelTimeTicks]));

  for (const vehicle of core.traffic.activeVehicles) {
    const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
    const edge = edgeId ? graph.getEdge(edgeId) : undefined;
    if (!edge) continue;
    const from = graph.getNode(edge.from);
    const to = graph.getNode(edge.to);
    if (!from || !to) continue;
    const edgeTicks = travelTicks.get(edge.id) ?? edge.freeFlowTicks;
    const progress = vehicle.status === 'queued'
      ? 1
      : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, edgeTicks)));
    const x = from.x + (to.x - from.x) * progress;
    const y = from.y + (to.y - from.y) * progress;
    const orientation = vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, quarterTurns);
    const assetId = resolveAsset(privateVehicleVariantKey(vehicle.id), orientation);
    commands.push(Object.freeze({
      key: `private:${vehicle.id}`,
      fingerprint: `${assetId}|${vehicle.status}`,
      assetId,
      x,
      y,
      queued: vehicle.status === 'queued',
    }));
  }

  for (const vehicle of core.serviceVehicles.listVehicles()) {
    if (vehicle.state === 'idle' || vehicle.state === 'unavailable') continue;
    const location = locateServiceVehicle(vehicle, graph, travelTicks);
    if (!location) continue;
    const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
    const edge = edgeId ? graph.getEdge(edgeId) : undefined;
    const from = edge ? graph.getNode(edge.from) : undefined;
    const to = edge ? graph.getNode(edge.to) : undefined;
    const orientation = from && to
      ? vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, quarterTurns)
      : quarterTurns;
    const assetId = resolveAsset(serviceVehicleVariantKey(vehicle.vehicleType), orientation);
    commands.push(Object.freeze({
      key: `service:${vehicle.id}`,
      fingerprint: `${assetId}|${vehicle.state}`,
      assetId,
      x: location.x,
      y: location.y,
      queued: false,
    }));
  }

  for (const vehicle of core.mobility.vehicles.listVehicles()) {
    if (vehicle.state === 'out_of_service' || vehicle.mode === 'metro') continue;
    const variantKey = transitVehicleVariantKey(vehicle.mode);
    if (!variantKey) continue;
    const location = locateTransitVehicle(vehicle, core.transit, graph, travelTicks);
    if (!location) continue;
    const edgeId = vehicle.roadEdgeIds[vehicle.currentRoadEdgeIndex];
    const edge = edgeId ? graph.getEdge(edgeId) : undefined;
    const from = edge ? graph.getNode(edge.from) : undefined;
    const to = edge ? graph.getNode(edge.to) : undefined;
    let dx = 1;
    let dy = 0;
    if (from && to) {
      dx = to.x - from.x;
      dy = to.y - from.y;
    } else {
      const line = core.transit.getLine(vehicle.lineId);
      const hereId = line?.stopIds[vehicle.stopIndex];
      const nextIndex = vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1);
      const nextId = line?.stopIds[nextIndex];
      const here = hereId ? core.transit.getStop(hereId) : undefined;
      const next = nextId ? core.transit.getStop(nextId) : undefined;
      if (here && next) {
        dx = next.x - here.x;
        dy = next.y - here.y;
      }
    }
    const orientation = vehicleOrientationFromWorldDelta(dx, dy, quarterTurns);
    const assetId = resolveAsset(variantKey, orientation);
    commands.push(Object.freeze({
      key: `transit:${vehicle.id}`,
      fingerprint: `${assetId}|${vehicle.state}`,
      assetId,
      x: location.x,
      y: location.y,
      queued: false,
    }));
  }

  for (const vehicle of core.economyDomain.freightVehicles.listVehicles()) {
    const location = locateFreightVehicle(vehicle, graph, travelTicks);
    if (!location) continue;
    const edgeId = vehicle.routeEdgeIds[vehicle.currentEdgeIndex];
    const edge = edgeId ? graph.getEdge(edgeId) : undefined;
    if (!edge) continue;
    const from = graph.getNode(edge.from);
    const to = graph.getNode(edge.to);
    if (!from || !to) continue;
    const orientation = vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, quarterTurns);
    const assetId = resolveAsset('vehicle_freight_truck_01', orientation);
    commands.push(Object.freeze({
      key: `freight:${vehicle.id}`,
      fingerprint: assetId,
      assetId,
      x: location.x,
      y: location.y,
      queued: false,
    }));
  }

  return Object.freeze(commands.sort((a, b) => a.key.localeCompare(b.key)));
}
