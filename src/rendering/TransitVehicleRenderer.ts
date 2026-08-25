import type { TransitNetworkSystem } from '../simulation/transit/TransitNetworkSystem.ts';
import type { TransitVehicle, TransitVehicleSystem } from '../simulation/transit/TransitVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import { AssetRegistry } from './assets/AssetRegistry.ts';
import { SpritePainter } from './assets/SpritePainter.ts';
import { transitVehicleVariantKey, vehicleOrientationFromWorldDelta } from './assets/VehicleVisuals.ts';
import { IsometricCamera } from './isometric/IsometricCamera.ts';
import type { WorldSize } from './isometric/IsometricProjection.ts';

export type TransitVehiclePosition = Readonly<{ x: number; y: number }>;

export function locateTransitVehicle(vehicle: TransitVehicle, network: TransitNetworkSystem, graph: TransportationGraph, travelTicksByEdge: ReadonlyMap<string, number>): TransitVehiclePosition | null {
  const line = network.getLine(vehicle.lineId); if (!line) return null;
  const currentStopId = line.stopIds[vehicle.stopIndex]; const currentStop = currentStopId ? network.getStop(currentStopId) : undefined;
  if (vehicle.state === 'dwell' || vehicle.state === 'out_of_service') return currentStop ? { x: currentStop.x, y: currentStop.y } : null;
  const nextIndex = vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1);
  const nextStopId = line.stopIds[nextIndex]; const nextStop = nextStopId ? network.getStop(nextStopId) : undefined;
  if (vehicle.mode === 'metro') {
    if (!currentStop || !nextStop) return null;
    const totalTicks = Math.max(10, (Math.abs(currentStop.x - nextStop.x) + Math.abs(currentStop.y - nextStop.y)) * 5);
    const progress = Math.max(0, Math.min(1, 1 - vehicle.dedicatedRemainingTicks / totalTicks));
    return { x: currentStop.x + (nextStop.x - currentStop.x) * progress, y: currentStop.y + (nextStop.y - currentStop.y) * progress };
  }
  const edgeId = vehicle.roadEdgeIds[vehicle.currentRoadEdgeIndex]; const edge = edgeId ? graph.getEdge(edgeId) : undefined;
  if (!edge) return currentStop ? { x: currentStop.x, y: currentStop.y } : null;
  const from = graph.getNode(edge.from); const to = graph.getNode(edge.to); if (!from || !to) return null;
  const travelTicks = travelTicksByEdge.get(edge.id) ?? edge.freeFlowTicks;
  const progress = Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

export class TransitVehicleRenderer {
  private readonly painter = new SpritePainter();
  constructor(private readonly assets: AssetRegistry) {}

  draw(ctx: CanvasRenderingContext2D, network: TransitNetworkSystem, graph: TransportationGraph, vehicles: TransitVehicleSystem, travelTicksByEdge: ReadonlyMap<string, number>, camera: IsometricCamera, worldSize: WorldSize): void {
    const sourceScale = 0.5 * camera.zoom;
    for (const vehicle of vehicles.listVehicles().filter((candidate) => candidate.state !== 'out_of_service' && candidate.mode !== 'metro')) {
      const variantKey = transitVehicleVariantKey(vehicle.mode); if (!variantKey) continue;
      const location = locateTransitVehicle(vehicle, network, graph, travelTicksByEdge); if (!location) continue;
      const edgeId = vehicle.roadEdgeIds[vehicle.currentRoadEdgeIndex]; const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      const from = edge ? graph.getNode(edge.from) : undefined; const to = edge ? graph.getNode(edge.to) : undefined;
      let dx = 1; let dy = 0;
      if (from && to) { dx = to.x - from.x; dy = to.y - from.y; }
      else {
        const line = network.getLine(vehicle.lineId); const hereId = line?.stopIds[vehicle.stopIndex];
        const nextIndex = vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1); const nextId = line?.stopIds[nextIndex];
        const here = hereId ? network.getStop(hereId) : undefined; const next = nextId ? network.getStop(nextId) : undefined;
        if (here && next) { dx = next.x - here.x; dy = next.y - here.y; }
      }
      const orientation = vehicleOrientationFromWorldDelta(dx, dy, camera.quarterTurns);
      const point = camera.worldToCanvas(location.x, location.y, worldSize);
      this.painter.draw(ctx, this.assets.resolveVariant(variantKey, orientation), point, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: vehicle.mode.slice(0, 2) });
    }
  }
}
