import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { mapEconomyOverlay, type EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import { mapServiceOverlay, type ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import { mapTrafficOverlay, type TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import { mapTransitOverlay, type TransitOverlayMode } from '../TransitOverlayLayer.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { drawLabelAtCell, fillCell, strokeWorldSegment } from '../isometric/IsometricOverlayPainter.ts';

export class OverlayRenderPass {
  draw(
    ctx: CanvasRenderingContext2D,
    core: SimulationCore,
    camera: IsometricCamera,
    trafficMode: TrafficOverlayMode,
    serviceMode: ServiceOverlayMode,
    transitMode: TransitOverlayMode,
    economyMode: EconomyOverlayMode,
  ): void {
    this.drawTransit(ctx, core, camera, transitMode);
    if (serviceMode !== 'none') this.drawService(ctx, core, camera, serviceMode);
    if (trafficMode !== 'none') this.drawTraffic(ctx, core, camera, trafficMode);
    if (economyMode !== 'none') this.drawEconomy(ctx, core, camera, economyMode);
  }

  private drawTransit(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, mode: TransitOverlayMode): void {
    const snapshot = mapTransitOverlay(core, mode);
    const size = { width: core.terrain.width, height: core.terrain.height };
    const routeMax = Math.max(1, ...snapshot.routes.map((route) => route.value));
    const lineDash = (transitMode: string): number[] => transitMode === 'brt' ? [9,4] : transitMode === 'tram' ? [3,4] : transitMode === 'metro' ? [12,4,3,4] : [];
    const modeStroke = (transitMode: string): string => transitMode === 'metro' ? '#bb8cff' : transitMode === 'tram' ? '#ffb65f' : transitMode === 'brt' ? '#59d8c4' : '#68a8ff';
    for (const route of snapshot.routes) {
      const line = core.transit.getLine(route.lineId); if (!line || line.stopIds.length < 2) continue;
      const normalized = mode === 'ridership' ? Math.max(0.12, route.value / routeMax) : mode === 'crowding' || mode === 'reliability' ? Math.max(0.12, route.value) : 0.55;
      const stops = line.stopIds.map((id) => core.transit.getStop(id)).filter((stop) => stop !== undefined);
      for (let i = 1; i < stops.length; i += 1) {
        const a = stops[i - 1]!; const b = stops[i]!;
        ctx.save(); ctx.globalAlpha = mode === 'none' ? 0.42 : 0.9;
        strokeWorldSegment(ctx, camera, a, b, size, modeStroke(route.mode), Math.max(2, camera.tileWidth * (0.04 + normalized * 0.04)), lineDash(route.mode));
        ctx.restore();
      }
    }
    for (const item of snapshot.stops) {
      const stop = core.transit.getStop(item.stopId); if (!stop) continue;
      const point = camera.tileCenter(stop.x, stop.y, size); const radius = Math.max(3, camera.tileWidth * 0.08);
      ctx.save(); ctx.fillStyle = stop.type === 'metro_station' ? '#c8a6ff' : '#dcebf2'; ctx.strokeStyle = '#12191d'; ctx.lineWidth = 1.5;
      if (stop.type === 'metro_station') { ctx.fillRect(point.x-radius, point.y-radius, radius*2, radius*2); ctx.strokeRect(point.x-radius, point.y-radius, radius*2, radius*2); }
      else { ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI*2); ctx.fill(); ctx.stroke(); }
      ctx.restore();
      if (mode === 'wait' && camera.tileWidth >= 40) drawLabelAtCell(ctx, camera, stop.x, stop.y, size, item.label, `700 ${Math.max(8, camera.tileWidth * .14)}px system-ui`);
    }
  }

  private drawService(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, mode: Exclude<ServiceOverlayMode,'none'>): void {
    const snapshot = mapServiceOverlay(core, mode); const size = { width: core.terrain.width, height: core.terrain.height };
    for (const item of snapshot.cells) {
      const hue = Math.round(120 - 120 * (1 - item.value));
      fillCell(ctx, camera, item.x, item.y, size, `hsla(${hue},82%,52%,.42)`);
      if (camera.tileWidth >= 40) drawLabelAtCell(ctx, camera, item.x, item.y, size, item.label, `700 ${Math.max(8,camera.tileWidth*.14)}px system-ui`);
    }
  }

  private drawTraffic(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, mode: Exclude<TrafficOverlayMode,'none'>): void {
    const snapshot = mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode);
    const size = { width: core.terrain.width, height: core.terrain.height };
    const maxSpeed = Math.max(1, ...core.transportationGraph.edges.map((edge) => edge.freeFlowSpeedCellsPerSecond));
    const maxVolume = Math.max(1, ...core.traffic.edgeMetrics.map((metric) => metric.weightedVehicles));
    for (const item of snapshot.edges) {
      if (mode === 'bottlenecks' && item.value <= 0) continue;
      const edge = core.transportationGraph.getEdge(item.edgeId); const from = edge ? core.transportationGraph.getNode(edge.from) : undefined; const to = edge ? core.transportationGraph.getNode(edge.to) : undefined;
      if (!edge || !from || !to) continue;
      const normalized = mode === 'congestion' ? item.value : mode === 'speed' ? 1 - Math.min(1,item.value/maxSpeed) : mode === 'volume' ? Math.min(1,item.value/maxVolume) : item.value;
      const n = Math.max(0,Math.min(1,normalized)); const hue = Math.round(120-120*n);
      strokeWorldSegment(ctx,camera,from,to,size,mode === 'bottlenecks' ? '#ff5b5b' : `hsla(${hue},85%,58%,.82)`,Math.max(2,camera.tileWidth*(mode === 'bottlenecks' ? .11 : .075)));
    }
  }

  private drawEconomy(ctx: CanvasRenderingContext2D, core: SimulationCore, camera: IsometricCamera, mode: Exclude<EconomyOverlayMode,'none'>): void {
    const snapshot = mapEconomyOverlay(core, mode); const size = { width: core.terrain.width, height: core.terrain.height }; const routeMax = Math.max(1,...snapshot.routes.map((route)=>route.value));
    for (const item of snapshot.cells) {
      fillCell(ctx,camera,item.x,item.y,size,`rgba(238,177,73,${0.18+Math.max(0,Math.min(1,item.value))*.5})`);
      if (camera.tileWidth >= 40) drawLabelAtCell(ctx,camera,item.x,item.y,size,item.label,`700 ${Math.max(8,camera.tileWidth*.14)}px system-ui`);
    }
    for (const route of snapshot.routes) {
      for (const edgeId of route.edgeIds) {
        const edge=core.transportationGraph.getEdge(edgeId); const from=edge?core.transportationGraph.getNode(edge.from):undefined; const to=edge?core.transportationGraph.getNode(edge.to):undefined; if(!edge||!from||!to)continue;
        strokeWorldSegment(ctx,camera,from,to,size,'#d9a64a',Math.max(2,camera.tileWidth*(.03+.04*Math.min(1,route.value/routeMax))),mode === 'freight-routes' ? [7,4] : []);
      }
    }
    for (const gateway of snapshot.gateways) {
      const p=camera.tileCenter(gateway.x,gateway.y,size); const r=Math.max(4,camera.tileWidth*.11);
      ctx.save();ctx.fillStyle='#f1c36e';ctx.strokeStyle='#151b1f';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y-r);ctx.lineTo(p.x+r,p.y);ctx.lineTo(p.x,p.y+r);ctx.lineTo(p.x-r,p.y);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
    }
  }
}
