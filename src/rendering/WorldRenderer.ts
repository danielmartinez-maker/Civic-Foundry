import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import { ROAD_DEFINITIONS } from '../data/roads.ts';
import type { TrafficOverlayMode } from './TrafficOverlayLayer.ts';
import { mapTrafficOverlay } from './TrafficOverlayLayer.ts';
import { VehicleRenderer } from './VehicleRenderer.ts';
import { mapServiceOverlay, type ServiceOverlayMode } from './ServiceOverlayLayer.ts';
import { ServiceVehicleRenderer } from './ServiceVehicleRenderer.ts';
import { mapTransitOverlay, type TransitOverlayMode } from './TransitOverlayLayer.ts';
import { TransitVehicleRenderer } from './TransitVehicleRenderer.ts';

export type CanvasPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;

const TERRAIN_COLORS = { grass: '#7b9365', forest: '#5f7953', rock: '#74777a', water: '#537e9f' } as const;
const ZONE_COLORS = { residential: '#63b36d', commercial: '#5f91d8', industrial: '#c39b58' } as const;
const ROAD_COLORS = { local: '#4b5157', collector: '#383f45', arterial: '#252b30' } as const;
const BUILDING_COLORS = { residential: '#d8e6d0', commercial: '#d4e3f6', industrial: '#ead9b8' } as const;
const FACILITY_LABELS = { power: '⚡', water: '●', landfill: '♻' } as const;
const SERVICE_LABELS = { fire_station: 'F', police_station: 'P', clinic: '+', elementary_school: 'S', landfill: 'W', recycling_center: 'R' } as const;

export class WorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly vehicles = new VehicleRenderer();
  private readonly serviceVehicles = new ServiceVehicleRenderer();
  private readonly transitVehicles = new TransitVehicleRenderer();
  private panX = 36;
  private panY = 36;
  private zoom = 1;
  private quarterTurns = 0;
  private baseCellSize = 24;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  get cellSize(): number { return this.baseCellSize * this.zoom; }

  pan(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  zoomBy(delta: number, anchorX: number, anchorY: number): void {
    const before = this.zoom;
    this.zoom = Math.max(0.45, Math.min(2.5, this.zoom * delta));
    const ratio = this.zoom / before;
    this.panX = anchorX - (anchorX - this.panX) * ratio;
    this.panY = anchorY - (anchorY - this.panY) * ratio;
  }

  rotate(direction: -1 | 1): void {
    this.quarterTurns = (this.quarterTurns + direction + 4) % 4;
  }

  worldToCanvas(x: number, y: number, core: SimulationCore): CanvasPoint {
    const rotated = this.rotateCoord(x, y, core.terrain.width, core.terrain.height);
    return { x: this.panX + rotated.x * this.cellSize, y: this.panY + rotated.y * this.cellSize };
  }

  canvasToCell(clientX: number, clientY: number, core: SimulationCore): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const rx = Math.floor((sx - this.panX) / this.cellSize);
    const ry = Math.floor((sy - this.panY) / this.cellSize);
    const world = this.inverseRotateCoord(rx, ry, core.terrain.width, core.terrain.height);
    return core.terrain.inBounds(world.x, world.y) ? world : null;
  }

  draw(core: SimulationCore, overlayMode: TrafficOverlayMode, selected: CellSelection, previewPath: readonly { x: number; y: number }[] = [], serviceOverlayMode: ServiceOverlayMode = 'none', transitOverlayMode: TransitOverlayMode = 'none'): void {
    this.resize();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const rect = this.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = '#11171b';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (let y = 0; y < core.terrain.height; y++) {
      for (let x = 0; x < core.terrain.width; x++) {
        const terrain = core.terrain.get(x, y);
        const p = this.worldToCanvas(x, y, core);
        const size = this.cellSize;
        ctx.fillStyle = TERRAIN_COLORS[terrain.biome];
        ctx.fillRect(p.x, p.y, size + 0.5, size + 0.5);
        if (!terrain.buildable && !terrain.water) {
          ctx.fillStyle = 'rgba(255,255,255,.10)';
          ctx.fillRect(p.x + size * 0.2, p.y + size * 0.2, size * 0.6, size * 0.6);
        }
      }
    }

    ctx.save();
    ctx.globalAlpha = 0.34;
    for (const zone of core.zoning.list()) {
      const p = this.worldToCanvas(zone.x, zone.y, core);
      ctx.fillStyle = ZONE_COLORS[zone.zone];
      ctx.fillRect(p.x + 1, p.y + 1, this.cellSize - 2, this.cellSize - 2);
    }
    ctx.restore();

    for (const road of core.roads.list()) {
      const p = this.worldToCanvas(road.x, road.y, core);
      const width = this.cellSize * ROAD_DEFINITIONS[road.type].renderWidth;
      const inset = (this.cellSize - width) / 2;
      ctx.fillStyle = ROAD_COLORS[road.type];
      ctx.fillRect(p.x + inset, p.y, width, this.cellSize);
      ctx.fillRect(p.x, p.y + inset, this.cellSize, width);
      if (road.type !== 'local') {
        ctx.strokeStyle = 'rgba(230,220,170,.65)';
        ctx.lineWidth = Math.max(1, this.cellSize * 0.035);
        ctx.setLineDash([this.cellSize * 0.2, this.cellSize * 0.16]);
        ctx.beginPath();
        ctx.moveTo(p.x + this.cellSize * 0.5, p.y + 2);
        ctx.lineTo(p.x + this.cellSize * 0.5, p.y + this.cellSize - 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const building of core.buildings.list()) {
      const p = this.worldToCanvas(building.x, building.y, core);
      const margin = this.cellSize * 0.14;
      ctx.fillStyle = BUILDING_COLORS[building.zone];
      ctx.fillRect(p.x + margin, p.y + margin, this.cellSize - margin * 2, this.cellSize - margin * 2);
      ctx.strokeStyle = building.status === 'construction' ? '#f0b95d' : '#253039';
      ctx.lineWidth = Math.max(1, this.cellSize * 0.06);
      ctx.strokeRect(p.x + margin, p.y + margin, this.cellSize - margin * 2, this.cellSize - margin * 2);
    }

    for (const facility of core.utilities.listFacilities()) {
      const p = this.worldToCanvas(facility.x, facility.y, core);
      ctx.fillStyle = '#242c31';
      ctx.fillRect(p.x + 2, p.y + 2, this.cellSize - 4, this.cellSize - 4);
      ctx.fillStyle = '#f2f5f6';
      ctx.font = `${Math.max(10, this.cellSize * 0.55)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(FACILITY_LABELS[facility.type], p.x + this.cellSize / 2, p.y + this.cellSize / 2);
    }

    for (const facility of core.services.listFacilities()) {
      const p = this.worldToCanvas(facility.x, facility.y, core);
      ctx.fillStyle = facility.department === 'fire' ? '#783b36'
        : facility.department === 'police' ? '#334b70'
        : facility.department === 'healthcare' ? '#42675d'
        : facility.department === 'education' ? '#725f34'
        : '#4f6544';
      ctx.fillRect(p.x + 2, p.y + 2, this.cellSize - 4, this.cellSize - 4);
      ctx.strokeStyle = '#e5ecef';
      ctx.lineWidth = Math.max(1, this.cellSize * 0.05);
      ctx.strokeRect(p.x + 2, p.y + 2, this.cellSize - 4, this.cellSize - 4);
      ctx.fillStyle = '#f4f7f8';
      ctx.font = `700 ${Math.max(9, this.cellSize * 0.43)}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(SERVICE_LABELS[facility.type], p.x + this.cellSize / 2, p.y + this.cellSize / 2);
    }

    this.drawTransitNetwork(core, transitOverlayMode);
    if (serviceOverlayMode !== 'none') this.drawServiceOverlay(core, serviceOverlayMode);
    if (overlayMode !== 'none') this.drawTrafficOverlay(core, overlayMode);
    this.vehicles.draw(ctx, core.transportationGraph, core.traffic, (x, y) => this.worldToCanvas(x, y, core), this.cellSize);
    const travelTicks = new Map(core.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric.travelTimeTicks]));
    this.serviceVehicles.draw(ctx, core.transportationGraph, core.serviceVehicles, travelTicks, (x, y) => this.worldToCanvas(x, y, core), this.cellSize);
    this.transitVehicles.draw(ctx, core.transit, core.transportationGraph, core.mobility.vehicles, travelTicks, (x, y) => this.worldToCanvas(x, y, core), this.cellSize);

    if (previewPath.length > 0) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = '#e8f2f5';
      for (const cell of previewPath) {
        const p = this.worldToCanvas(cell.x, cell.y, core);
        ctx.fillRect(p.x + this.cellSize * 0.28, p.y + this.cellSize * 0.28, this.cellSize * 0.44, this.cellSize * 0.44);
      }
      ctx.restore();
    }

    if (selected) {
      const p = this.worldToCanvas(selected.x, selected.y, core);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x + 1, p.y + 1, this.cellSize - 2, this.cellSize - 2);
    }
  }

  private drawTransitNetwork(core: SimulationCore, mode: TransitOverlayMode): void {
    const snapshot = mapTransitOverlay(core, mode);
    const ctx = this.ctx;
    const routeMax = Math.max(1, ...snapshot.routes.map((route) => route.value));
    const lineDash = (transitMode: string): number[] => transitMode === 'brt' ? [9, 4]
      : transitMode === 'tram' ? [3, 4]
      : transitMode === 'metro' ? [12, 4, 3, 4]
      : [];
    const modeStroke = (transitMode: string): string => transitMode === 'metro' ? '#bb8cff'
      : transitMode === 'tram' ? '#ffb65f'
      : transitMode === 'brt' ? '#59d8c4'
      : '#68a8ff';

    for (const route of snapshot.routes) {
      const line = core.transit.getLine(route.lineId);
      if (!line || line.stopIds.length < 2) continue;
      const normalized = mode === 'ridership' ? Math.max(0.12, route.value / routeMax)
        : mode === 'crowding' || mode === 'reliability' ? Math.max(0.12, route.value)
        : 0.55;
      ctx.save();
      ctx.strokeStyle = modeStroke(route.mode);
      ctx.globalAlpha = mode === 'none' ? 0.42 : 0.9;
      ctx.lineWidth = Math.max(2, this.cellSize * (0.08 + normalized * 0.08));
      ctx.setLineDash(lineDash(route.mode));
      ctx.beginPath();
      line.stopIds.forEach((stopId, index) => {
        const stop = core.transit.getStop(stopId);
        if (!stop) return;
        const point = this.worldToCanvas(stop.x, stop.y, core);
        const px = point.x + this.cellSize / 2;
        const py = point.y + this.cellSize / 2;
        if (index === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.restore();
    }

    for (const stopItem of snapshot.stops) {
      const stop = core.transit.getStop(stopItem.stopId);
      if (!stop) continue;
      const point = this.worldToCanvas(stop.x, stop.y, core);
      const radius = Math.max(3, this.cellSize * 0.16);
      ctx.save();
      if (mode === 'access') {
        ctx.strokeStyle = 'rgba(220,239,248,.55)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(point.x + this.cellSize / 2, point.y + this.cellSize / 2, this.cellSize * 0.48, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = stop.type === 'metro_station' ? '#c8a6ff' : '#dcebf2';
      ctx.strokeStyle = '#12191d';
      ctx.lineWidth = 1.5;
      if (stop.type === 'metro_station') {
        ctx.fillRect(point.x + this.cellSize / 2 - radius, point.y + this.cellSize / 2 - radius, radius * 2, radius * 2);
        ctx.strokeRect(point.x + this.cellSize / 2 - radius, point.y + this.cellSize / 2 - radius, radius * 2, radius * 2);
      } else {
        ctx.beginPath();
        ctx.arc(point.x + this.cellSize / 2, point.y + this.cellSize / 2, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      if (mode === 'wait' && this.cellSize >= 18) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = 'rgba(0,0,0,.75)';
        ctx.lineWidth = 2;
        ctx.font = `700 ${Math.max(8, this.cellSize * 0.28)}px system-ui`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.strokeText(stopItem.label, point.x + this.cellSize / 2, point.y - 2);
        ctx.fillText(stopItem.label, point.x + this.cellSize / 2, point.y - 2);
      }
      ctx.restore();
    }

    if ((mode === 'mode-share' || mode === 'accessibility') && snapshot.globalValue !== undefined) {
      const label = `${mode === 'mode-share' ? 'Transit share' : 'Person access'} ${Math.round(snapshot.globalValue * 100)}%`;
      ctx.save();
      ctx.font = '700 12px system-ui';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const width = ctx.measureText(label).width + 16;
      ctx.fillStyle = 'rgba(11,16,19,.86)';
      ctx.fillRect(12, 12, width, 28);
      ctx.strokeStyle = '#718893';
      ctx.strokeRect(12, 12, width, 28);
      ctx.fillStyle = '#eef5f7';
      ctx.fillText(label, 20, 19);
      ctx.restore();
    }
  }

  private drawServiceOverlay(core: SimulationCore, mode: Exclude<ServiceOverlayMode, 'none'>): void {
    const snapshot = mapServiceOverlay(core, mode);
    for (const item of snapshot.cells) {
      const p = this.worldToCanvas(item.x, item.y, core);
      const normalizedProblem = 1 - item.value;
      const hue = Math.round(120 - 120 * normalizedProblem);
      this.ctx.save();
      this.ctx.fillStyle = `hsla(${hue}, 82%, 52%, .42)`;
      this.ctx.fillRect(p.x + 1, p.y + 1, this.cellSize - 2, this.cellSize - 2);
      if (this.cellSize >= 20) {
        this.ctx.fillStyle = '#ffffff';
        this.ctx.strokeStyle = 'rgba(0,0,0,.65)';
        this.ctx.lineWidth = 2.5;
        this.ctx.font = `700 ${Math.max(8, this.cellSize * 0.30)}px system-ui`;
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.strokeText(item.label, p.x + this.cellSize / 2, p.y + this.cellSize / 2);
        this.ctx.fillText(item.label, p.x + this.cellSize / 2, p.y + this.cellSize / 2);
      }
      this.ctx.restore();
    }
  }

  private drawTrafficOverlay(core: SimulationCore, mode: Exclude<TrafficOverlayMode, 'none'>): void {
    const snapshot = mapTrafficOverlay(core.transportationGraph, core.traffic.edgeMetrics, core.trafficSnapshot, mode);
    const maxSpeed = Math.max(1, ...core.transportationGraph.edges.map((edge) => edge.freeFlowSpeedCellsPerSecond));
    const maxVolume = Math.max(1, ...core.traffic.edgeMetrics.map((metric) => metric.weightedVehicles));
    for (const item of snapshot.edges) {
      if (mode === 'bottlenecks' && item.value <= 0) continue;
      const edge = core.transportationGraph.getEdge(item.edgeId);
      const from = edge ? core.transportationGraph.getNode(edge.from) : undefined;
      const to = edge ? core.transportationGraph.getNode(edge.to) : undefined;
      if (!edge || !from || !to) continue;
      const a = this.worldToCanvas(from.x, from.y, core);
      const b = this.worldToCanvas(to.x, to.y, core);
      const normalized = mode === 'congestion' ? item.value
        : mode === 'speed' ? 1 - Math.min(1, item.value / maxSpeed)
        : mode === 'volume' ? Math.min(1, item.value / maxVolume)
        : item.value;
      ctxOverlay(this.ctx, a, b, this.cellSize, normalized, mode);
    }
  }

  private rotateCoord(x: number, y: number, width: number, height: number): CanvasPoint {
    if (this.quarterTurns === 1) return { x: height - 1 - y, y: x };
    if (this.quarterTurns === 2) return { x: width - 1 - x, y: height - 1 - y };
    if (this.quarterTurns === 3) return { x: y, y: width - 1 - x };
    return { x, y };
  }

  private inverseRotateCoord(x: number, y: number, width: number, height: number): { x: number; y: number } {
    if (this.quarterTurns === 1) return { x: y, y: height - 1 - x };
    if (this.quarterTurns === 2) return { x: width - 1 - x, y: height - 1 - y };
    if (this.quarterTurns === 3) return { x: width - 1 - y, y: x };
    return { x, y };
  }
}

function ctxOverlay(ctx: CanvasRenderingContext2D, a: CanvasPoint, b: CanvasPoint, cellSize: number, normalized: number, mode: string): void {
  const n = Math.max(0, Math.min(1, normalized));
  const hue = Math.round(120 - 120 * n);
  ctx.save();
  ctx.strokeStyle = mode === 'bottlenecks' ? '#ff5b5b' : `hsla(${hue}, 85%, 58%, .82)`;
  ctx.lineWidth = Math.max(2, cellSize * (mode === 'bottlenecks' ? 0.22 : 0.15));
  ctx.beginPath();
  ctx.moveTo(a.x + cellSize / 2, a.y + cellSize / 2);
  ctx.lineTo(b.x + cellSize / 2, b.y + cellSize / 2);
  ctx.stroke();
  ctx.restore();
}
