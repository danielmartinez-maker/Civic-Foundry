import type { ServiceVehicle, ServiceVehicleSystem } from '../simulation/services/ServiceVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import { AssetRegistry } from './assets/AssetRegistry.ts';
import { SpritePainter } from './assets/SpritePainter.ts';
import { serviceVehicleVariantKey, vehicleOrientationFromWorldDelta } from './assets/VehicleVisuals.ts';
import { IsometricCamera } from './isometric/IsometricCamera.ts';
import type { WorldSize } from './isometric/IsometricProjection.ts';

export type ServiceVehiclePosition = Readonly<{ x: number; y: number }>;

export function locateServiceVehicle(vehicle: ServiceVehicle, graph: TransportationGraph, travelTicksByEdge: ReadonlyMap<string, number>): ServiceVehiclePosition | null {
  if (vehicle.state === 'idle' || vehicle.state === 'unavailable') {
    const node = vehicle.currentNodeId ? graph.getNode(vehicle.currentNodeId) : undefined;
    return node ? { x: node.x, y: node.y } : null;
  }
  const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
  if (!edgeId) {
    const node = vehicle.currentNodeId ? graph.getNode(vehicle.currentNodeId) : undefined;
    return node ? { x: node.x, y: node.y } : null;
  }
  const edge = graph.getEdge(edgeId); if (!edge) return null;
  const from = graph.getNode(edge.from); const to = graph.getNode(edge.to); if (!from || !to) return null;
  const travelTicks = travelTicksByEdge.get(edge.id) ?? edge.freeFlowTicks;
  const progress = vehicle.state === 'servicing' ? 1 : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

export class ServiceVehicleRenderer {
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) { this.assets = assets; }

  draw(ctx: CanvasRenderingContext2D, graph: TransportationGraph, vehicles: ServiceVehicleSystem, travelTicksByEdge: ReadonlyMap<string, number>, camera: IsometricCamera, worldSize: WorldSize): void {
    const sourceScale = 0.5 * camera.zoom;
    for (const vehicle of vehicles.listVehicles().filter((item) => item.state !== 'idle' && item.state !== 'unavailable')) {
      const location = locateServiceVehicle(vehicle, graph, travelTicksByEdge); if (!location) continue;
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex]; const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      const from = edge ? graph.getNode(edge.from) : undefined; const to = edge ? graph.getNode(edge.to) : undefined;
      const orientation = from && to ? vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, camera.quarterTurns) : camera.quarterTurns;
      const point = camera.worldToCanvas(location.x, location.y, worldSize);
      this.painter.draw(ctx, this.assets.resolveVariant(serviceVehicleVariantKey(vehicle.vehicleType), orientation), point, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: vehicle.vehicleType.slice(0, 2) });
    }
  }
}
