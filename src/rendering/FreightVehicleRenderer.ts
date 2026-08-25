import type { FreightVehicle, FreightVehicleSystem } from '../simulation/economy/FreightVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import { AssetRegistry } from './assets/AssetRegistry.ts';
import { SpritePainter } from './assets/SpritePainter.ts';
import { vehicleOrientationFromWorldDelta } from './assets/VehicleVisuals.ts';
import { IsometricCamera } from './isometric/IsometricCamera.ts';
import type { WorldSize } from './isometric/IsometricProjection.ts';

export type FreightVehiclePosition = Readonly<{ x: number; y: number }>;
export function locateFreightVehicle(vehicle: FreightVehicle, graph: TransportationGraph, travelTicksByEdge: ReadonlyMap<string, number>): FreightVehiclePosition | null {
  const edgeId = vehicle.routeEdgeIds[vehicle.currentEdgeIndex]; const edge = edgeId ? graph.getEdge(edgeId) : undefined; if (!edge) return null;
  const from = graph.getNode(edge.from); const to = graph.getNode(edge.to); if (!from || !to) return null;
  const travel = travelTicksByEdge.get(edge.id) ?? edge.freeFlowTicks; const progress = Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travel)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

export class FreightVehicleRenderer {
  private readonly painter = new SpritePainter();
  private readonly assets: AssetRegistry;

  constructor(assets: AssetRegistry) { this.assets = assets; }

  draw(ctx: CanvasRenderingContext2D, graph: TransportationGraph, vehicles: FreightVehicleSystem, travelTicksByEdge: ReadonlyMap<string, number>, camera: IsometricCamera, worldSize: WorldSize): void {
    const sourceScale = 0.5 * camera.zoom;
    for (const vehicle of vehicles.listVehicles()) {
      const location = locateFreightVehicle(vehicle, graph, travelTicksByEdge); if (!location) continue;
      const edgeId = vehicle.routeEdgeIds[vehicle.currentEdgeIndex]; const edge = edgeId ? graph.getEdge(edgeId) : undefined; if (!edge) continue;
      const from = graph.getNode(edge.from); const to = graph.getNode(edge.to); if (!from || !to) continue;
      const orientation = vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, camera.quarterTurns);
      const point = camera.worldToCanvas(location.x, location.y, worldSize);
      this.painter.draw(ctx, this.assets.resolveVariant('vehicle_freight_truck_01', orientation), point, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: 'FR' });
    }
  }
}
