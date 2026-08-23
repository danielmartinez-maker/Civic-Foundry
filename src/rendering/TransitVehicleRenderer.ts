import type { TransitNetworkSystem } from '../simulation/transit/TransitNetworkSystem.ts';
import type { TransitVehicle, TransitVehicleSystem } from '../simulation/transit/TransitVehicleSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import type { CanvasPoint } from './WorldRenderer.ts';

export type TransitVehiclePosition = Readonly<{ x: number; y: number }>;

export function locateTransitVehicle(
  vehicle: TransitVehicle,
  network: TransitNetworkSystem,
  graph: TransportationGraph,
  travelTicksByEdge: ReadonlyMap<string, number>,
): TransitVehiclePosition | null {
  const line = network.getLine(vehicle.lineId);
  if (!line) return null;
  const currentStopId = line.stopIds[vehicle.stopIndex];
  const currentStop = currentStopId ? network.getStop(currentStopId) : undefined;
  if (vehicle.state === 'dwell' || vehicle.state === 'out_of_service') return currentStop ? { x: currentStop.x, y: currentStop.y } : null;

  const nextIndex = vehicle.stopIndex + (vehicle.directionKey === 'forward' ? 1 : -1);
  const nextStopId = line.stopIds[nextIndex];
  const nextStop = nextStopId ? network.getStop(nextStopId) : undefined;
  if (vehicle.mode === 'metro') {
    if (!currentStop || !nextStop) return null;
    const totalTicks = Math.max(10, (Math.abs(currentStop.x - nextStop.x) + Math.abs(currentStop.y - nextStop.y)) * 5);
    const progress = Math.max(0, Math.min(1, 1 - vehicle.dedicatedRemainingTicks / totalTicks));
    return { x: currentStop.x + (nextStop.x - currentStop.x) * progress, y: currentStop.y + (nextStop.y - currentStop.y) * progress };
  }

  const edgeId = vehicle.roadEdgeIds[vehicle.currentRoadEdgeIndex];
  const edge = edgeId ? graph.getEdge(edgeId) : undefined;
  if (!edge) return currentStop ? { x: currentStop.x, y: currentStop.y } : null;
  const from = graph.getNode(edge.from);
  const to = graph.getNode(edge.to);
  if (!from || !to) return null;
  const travelTicks = travelTicksByEdge.get(edge.id) ?? edge.freeFlowTicks;
  const progress = Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
}

export class TransitVehicleRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    network: TransitNetworkSystem,
    graph: TransportationGraph,
    vehicles: TransitVehicleSystem,
    travelTicksByEdge: ReadonlyMap<string, number>,
    worldToCanvas: (x: number, y: number) => CanvasPoint,
    cellSize: number,
  ): void {
    for (const vehicle of vehicles.listVehicles().filter((candidate) => candidate.state !== 'out_of_service')) {
      const location = locateTransitVehicle(vehicle, network, graph, travelTicksByEdge);
      if (!location) continue;
      const point = worldToCanvas(location.x, location.y);
      const width = Math.max(5, cellSize * 0.32);
      const height = Math.max(3, cellSize * 0.18);
      ctx.save();
      ctx.fillStyle = vehicle.mode === 'metro' ? '#bb8cff'
        : vehicle.mode === 'tram' ? '#ffb65f'
        : vehicle.mode === 'brt' ? '#59d8c4'
        : '#68a8ff';
      ctx.strokeStyle = '#0c1114';
      ctx.lineWidth = 1.2;
      ctx.fillRect(point.x + cellSize / 2 - width / 2, point.y + cellSize / 2 - height / 2, width, height);
      ctx.strokeRect(point.x + cellSize / 2 - width / 2, point.y + cellSize / 2 - height / 2, width, height);
      ctx.restore();
    }
  }
}
