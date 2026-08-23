import type { ServiceVehicle, ServiceVehicleSystem } from '../simulation/services/ServiceVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import type { CanvasPoint } from './WorldRenderer.ts';

export type ServiceVehiclePosition = Readonly<{ x: number; y: number }>;

export function locateServiceVehicle(
  vehicle: ServiceVehicle,
  graph: TransportationGraph,
  travelTicksByEdge: ReadonlyMap<string, number>,
): ServiceVehiclePosition | null {
  if (vehicle.state === 'idle' || vehicle.state === 'unavailable') {
    const node = vehicle.currentNodeId ? graph.getNode(vehicle.currentNodeId) : undefined;
    return node ? { x: node.x, y: node.y } : null;
  }
  const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
  if (!edgeId) {
    const node = vehicle.currentNodeId ? graph.getNode(vehicle.currentNodeId) : undefined;
    return node ? { x: node.x, y: node.y } : null;
  }
  const edge = graph.getEdge(edgeId);
  if (!edge) return null;
  const from = graph.getNode(edge.from);
  const to = graph.getNode(edge.to);
  if (!from || !to) return null;
  const travelTicks = travelTicksByEdge.get(edge.id) ?? edge.freeFlowTicks;
  const progress = vehicle.state === 'servicing' ? 1 : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

export class ServiceVehicleRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    graph: TransportationGraph,
    vehicles: ServiceVehicleSystem,
    travelTicksByEdge: ReadonlyMap<string, number>,
    worldToCanvas: (x: number, y: number) => CanvasPoint,
    cellSize: number,
  ): void {
    for (const vehicle of vehicles.listVehicles().filter((item) => item.state !== 'idle' && item.state !== 'unavailable')) {
      const location = locateServiceVehicle(vehicle, graph, travelTicksByEdge);
      if (!location) continue;
      const point = worldToCanvas(location.x, location.y);
      const radius = Math.max(2.8, cellSize * 0.14);
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x + cellSize / 2, point.y + cellSize / 2, radius, 0, Math.PI * 2);
      ctx.fillStyle = vehicle.vehicleType === 'fire_engine' ? '#ff6b5f'
        : vehicle.vehicleType === 'ambulance' ? '#f6f7f8'
        : vehicle.vehicleType === 'patrol_car' ? '#6ea8ff'
        : '#95c66b';
      ctx.fill();
      ctx.strokeStyle = '#101619';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();
    }
  }
}
