import type { TrafficSystem } from '../simulation/traffic/TrafficSystem.ts';
import type { TransportationGraph } from '../simulation/traffic/TransportationGraph.ts';
import { AssetRegistry } from './assets/AssetRegistry.ts';
import { SpritePainter } from './assets/SpritePainter.ts';
import { privateVehicleVariantKey, vehicleOrientationFromWorldDelta } from './assets/VehicleVisuals.ts';
import { IsometricCamera } from './isometric/IsometricCamera.ts';
import type { WorldSize } from './isometric/IsometricProjection.ts';

export class VehicleRenderer {
  private readonly painter = new SpritePainter();
  constructor(private readonly assets: AssetRegistry) {}

  draw(ctx: CanvasRenderingContext2D, graph: TransportationGraph, traffic: TrafficSystem, camera: IsometricCamera, worldSize: WorldSize): void {
    const metricByEdge = new Map(traffic.edgeMetrics.map((metric) => [metric.edgeId, metric]));
    const sourceScale = 0.5 * camera.zoom;
    for (const vehicle of traffic.activeVehicles) {
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      if (!edgeId) continue;
      const edge = graph.getEdge(edgeId); if (!edge) continue;
      const from = graph.getNode(edge.from); const to = graph.getNode(edge.to); if (!from || !to) continue;
      const travelTicks = metricByEdge.get(edge.id)?.travelTimeTicks ?? edge.freeFlowTicks;
      const progress = vehicle.status === 'queued' ? 1 : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, travelTicks)));
      const x = from.x + (to.x - from.x) * progress;
      const y = from.y + (to.y - from.y) * progress;
      const point = camera.worldToCanvas(x, y, worldSize);
      const orientation = vehicleOrientationFromWorldDelta(to.x - from.x, to.y - from.y, camera.quarterTurns);
      const variantKey = privateVehicleVariantKey(vehicle.id);
      this.painter.draw(ctx, this.assets.resolveVariant(variantKey, orientation), point, sourceScale, { footprintWidth: 1, footprintHeight: 1, label: 'V' });
      if (vehicle.status === 'queued' && camera.zoom >= 0.8) {
        ctx.save(); ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.arc(point.x, point.y - 7 * camera.zoom, Math.max(1.5, 2 * camera.zoom), 0, Math.PI * 2); ctx.fill(); ctx.restore();
      }
    }
  }
}
