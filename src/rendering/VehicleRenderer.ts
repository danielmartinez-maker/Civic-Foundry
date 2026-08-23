import type { CanvasPoint } from './WorldRenderer.ts';
import type { TrafficSystem } from '../simulation/traffic/TrafficSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';

export class VehicleRenderer {
  draw(
    ctx: CanvasRenderingContext2D,
    graph: TransportationGraph,
    traffic: TrafficSystem,
    worldToCanvas: (x: number, y: number) => CanvasPoint,
    cellSize: number,
  ): void {
    const metricByEdge = new Map(traffic.edgeMetrics.map((metric) => [metric.edgeId, metric]));
    for (const vehicle of traffic.activeVehicles) {
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      if (!edgeId) continue;
      const edge = graph.getEdge(edgeId);
      if (!edge) continue;
      const from = graph.getNode(edge.from);
      const to = graph.getNode(edge.to);
      if (!from || !to) continue;
      const travelTicks = metricByEdge.get(edge.id)?.travelTimeTicks ?? edge.freeFlowTicks;
      const progress = vehicle.status === 'queued' ? 1 : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      const point = worldToCanvas(x, y);
      const radius = Math.max(2.2, cellSize * 0.11);
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x + cellSize * 0.5, point.y + cellSize * 0.5, radius, 0, Math.PI * 2);
      ctx.fillStyle = vehicle.status === 'queued' ? '#ffd166' : '#f6f7f8';
      ctx.fill();
      ctx.strokeStyle = '#1c2328';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }
}
