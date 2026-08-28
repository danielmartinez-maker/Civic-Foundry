import { Application, Container, Graphics } from 'pixi.js';
import { definitionForBuilding } from '../../simulation/buildings/BuildingSystem.ts';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { LEGACY_CELL_SIZE_METERS, type WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import type { ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import type { TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import type { TransitOverlayMode } from '../TransitOverlayLayer.ts';
import type { UrbanFabricOverlayMode } from '../CadastralOverlayLayer.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';

export type GpuPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;
type RendererWorldSize = Readonly<{ width: number; height: number }>;
type CellCoord = Readonly<{ x: number; y: number }>;

type BlockCommand = Readonly<{
  x: number;
  y: number;
  height: number;
  topColor: string;
  leftColor: string;
  rightColor: string;
  outlineColor: string;
}>;

const TERRAIN_COLORS: Readonly<Record<string, string>> = Object.freeze({
  water: '#5f94bd',
  wetland: '#789d82',
  hills: '#aa9d78',
  forest: '#68865f',
  plains: '#8ea86f',
  grassland: '#8ea86f',
});

const ZONE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  residential: '#53b566',
  commercial: '#4987d7',
  industrial: '#cc9946',
});

const ROAD_COLORS: Readonly<Record<string, string>> = Object.freeze({
  local: '#66584f',
  collector: '#756054',
  arterial: '#8b6754',
  highway: '#795241',
});

const BUILDING_COLORS = Object.freeze({
  residential: Object.freeze({ top: '#d8dcc9', left: '#a8ad9b', right: '#bdc2ae' }),
  commercial: Object.freeze({ top: '#c9d7e1', left: '#8fa8b8', right: '#a9bdc9' }),
  industrial: Object.freeze({ top: '#d7c6ac', left: '#a99172', right: '#bea785' }),
});

const OVERLAY_COLORS = Object.freeze({
  traffic: '#ef6f6c',
  service: '#5bc0be',
  transit: '#8f7ee7',
  economy: '#f3bd59',
  urbanFabric: '#df78c8',
});

// Presentation-only facade. Authoritative state remains inside SimulationCore.
export class GpuWorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly camera = new IsometricCamera();
  private readonly application = new Application();
  private readonly scene = new Container();
  private readonly terrainLayer = new Graphics();
  private readonly zoningLayer = new Graphics();
  private readonly roadLayer = new Graphics();
  private readonly objectLayer = new Graphics();
  private readonly vehicleLayer = new Graphics();
  private readonly overlayLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private initialized = false;
  private lastWorldSize: RendererWorldSize | null = null;
  private urbanFabricOverlayMode: UrbanFabricOverlayMode = 'none';
  private urbanFabricSelectedParcelId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    void this.initialize();
  }

  get cellSize(): number { return this.camera.tileWidth; }
  get tileWidth(): number { return this.camera.tileWidth; }
  get tileHeight(): number { return this.camera.tileHeight; }
  get zoom(): number { return this.camera.zoom; }
  get quarterTurns(): number { return this.camera.quarterTurns; }
  get currentUrbanFabricOverlayMode(): UrbanFabricOverlayMode { return this.urbanFabricOverlayMode; }
  get currentUrbanFabricSelectedParcelId(): string | null { return this.urbanFabricSelectedParcelId; }

  setUrbanFabricOverlay(mode: UrbanFabricOverlayMode, selectedParcelId: string | null = null): void {
    this.urbanFabricOverlayMode = mode;
    this.urbanFabricSelectedParcelId = selectedParcelId;
  }

  pan(dx: number, dy: number): void { this.camera.pan(dx, dy); }
  zoomBy(factor: number, anchorX: number, anchorY: number): void { this.camera.zoomBy(factor, anchorX, anchorY); }

  rotate(direction: -1 | 1): void {
    const size = this.lastWorldSize;
    const rect = this.canvas.getBoundingClientRect();
    if (size && rect.width > 0 && rect.height > 0) {
      this.camera.rotateAroundCanvasPoint(direction, size, { x: rect.width / 2, y: rect.height / 2 });
      return;
    }
    this.camera.rotate(direction);
  }

  worldToCanvas(x: number, y: number, core: SimulationCore): GpuPoint {
    return this.camera.worldToCanvas(x, y, this.worldSize(core));
  }

  worldMetersToCanvas(point: WorldPoint, core: SimulationCore): GpuPoint {
    return this.worldToCanvas(
      point.x / LEGACY_CELL_SIZE_METERS,
      point.y / LEGACY_CELL_SIZE_METERS,
      core,
    );
  }

  canvasToCell(clientX: number, clientY: number, core: SimulationCore): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    return this.camera.canvasToCell(clientX - rect.left, clientY - rect.top, this.worldSize(core));
  }

  tilePolygon(x: number, y: number, core: SimulationCore): readonly GpuPoint[] {
    return this.camera.tilePolygon(x, y, this.worldSize(core));
  }

  async preloadAssets(): Promise<void> {
    await this.ready();
  }

  assetDiagnostics(): readonly string[] {
    return Object.freeze([]);
  }

  resize(): void {
    if (!this.initialized) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.application.renderer.resize(Math.round(rect.width), Math.round(rect.height));
  }

  draw(
    core: SimulationCore,
    overlayMode: TrafficOverlayMode,
    selected: CellSelection,
    previewPath: readonly CellCoord[] = [],
    serviceOverlayMode: ServiceOverlayMode = 'none',
    transitOverlayMode: TransitOverlayMode = 'none',
    economyOverlayMode: EconomyOverlayMode = 'none',
    urbanFabricOverlayMode?: UrbanFabricOverlayMode,
    selectedParcelId?: string | null,
  ): void {
    this.worldSize(core);
    if (!this.initialized) return;

    this.clearLayers();
    this.drawTerrain(core);
    this.drawZoning(core);
    this.drawRoads(core);
    this.drawObjects(core);
    this.drawVehicles(core);
    this.drawOverlayTint(
      core,
      overlayMode,
      serviceOverlayMode,
      transitOverlayMode,
      economyOverlayMode,
      urbanFabricOverlayMode ?? this.urbanFabricOverlayMode,
      selectedParcelId === undefined ? this.urbanFabricSelectedParcelId : selectedParcelId,
    );
    this.drawSelection(core, selected, previewPath);
  }

  private async initialize(): Promise<void> {
    await this.application.init({
      canvas: this.canvas,
      preference: 'webgl',
      powerPreference: 'high-performance',
      antialias: true,
      autoDensity: true,
      resolution: Math.max(1, window.devicePixelRatio || 1),
      background: '#11171b',
      resizeTo: this.canvas.parentElement ?? window,
    });

    this.scene.addChild(
      this.terrainLayer,
      this.zoningLayer,
      this.roadLayer,
      this.objectLayer,
      this.vehicleLayer,
      this.overlayLayer,
      this.selectionLayer,
    );
    this.application.stage.addChild(this.scene);
    this.initialized = true;
  }

  private async ready(): Promise<void> {
    while (!this.initialized) await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }

  private clearLayers(): void {
    this.terrainLayer.clear();
    this.zoningLayer.clear();
    this.roadLayer.clear();
    this.objectLayer.clear();
    this.vehicleLayer.clear();
    this.overlayLayer.clear();
    this.selectionLayer.clear();
  }

  private drawTerrain(core: SimulationCore): void {
    const size = this.worldSize(core);
    for (let y = 0; y < core.terrain.height; y += 1) {
      for (let x = 0; x < core.terrain.width; x += 1) {
        const terrain = core.terrain.get(x, y);
        const color = TERRAIN_COLORS[terrain.biome] ?? '#8ea86f';
        this.fillDiamond(this.terrainLayer, this.camera.tilePolygon(x, y, size), color, 1, '#1d2929', 0.34);
        if (!terrain.buildable && !terrain.water) {
          this.fillDiamond(this.terrainLayer, this.camera.tilePolygon(x, y, size), '#ffffff', 0.07);
        }
      }
    }
  }

  private drawZoning(core: SimulationCore): void {
    const size = this.worldSize(core);
    for (const zone of core.zoning.list()) {
      this.fillDiamond(
        this.zoningLayer,
        this.camera.tilePolygon(zone.x, zone.y, size),
        ZONE_COLORS[zone.zone] ?? '#ffffff',
        0.26,
      );
    }
  }

  private drawRoads(core: SimulationCore): void {
    const size = this.worldSize(core);
    for (const road of core.roads.list()) {
      const polygon = this.camera.tilePolygon(road.x, road.y, size);
      this.fillDiamond(
        this.roadLayer,
        polygon,
        ROAD_COLORS[road.type] ?? '#66584f',
        1,
        '#c5b7a7',
        this.camera.zoom >= 1.4 ? 0.18 : 0.08,
      );
      const center = this.camera.tileCenter(road.x, road.y, size);
      const half = Math.max(2, this.camera.tileWidth * 0.12);
      this.roadLayer
        .moveTo(center.x - half, center.y)
        .lineTo(center.x + half, center.y)
        .stroke({ color: '#d8d1c8', alpha: 0.2, width: Math.max(1, this.camera.zoom) });
    }
  }

  private drawObjects(core: SimulationCore): void {
    const size = this.worldSize(core);
    const commands: BlockCommand[] = [];

    for (const building of core.buildings.list()) {
      const palette = BUILDING_COLORS[building.zone] ?? BUILDING_COLORS.residential;
      const intensity = definitionForBuilding(building).intensity;
      const intensityHeight = intensity === 'high' ? 38 : intensity === 'medium' ? 27 : 18;
      const constructionScale = building.status === 'construction' ? 0.55 : 1;
      commands.push({
        x: building.x,
        y: building.y,
        height: intensityHeight * this.camera.zoom * constructionScale,
        topColor: building.status === 'construction' ? '#d3b67c' : palette.top,
        leftColor: building.status === 'construction' ? '#9e8152' : palette.left,
        rightColor: building.status === 'construction' ? '#b89a62' : palette.right,
        outlineColor: '#283033',
      });
    }

    for (const facility of core.services.listFacilities()) {
      commands.push({
        x: facility.x,
        y: facility.y,
        height: 30 * this.camera.zoom,
        topColor: '#d9edf0',
        leftColor: '#79a8af',
        rightColor: '#96bdc2',
        outlineColor: '#244248',
      });
    }

    for (const facility of core.utilities.listFacilities()) {
      commands.push({
        x: facility.x,
        y: facility.y,
        height: 25 * this.camera.zoom,
        topColor: '#e6d6a7',
        leftColor: '#9e8950',
        rightColor: '#bba66b',
        outlineColor: '#403a27',
      });
    }

    commands.sort((left, right) => {
      const lp = this.camera.tileCenter(left.x, left.y, size);
      const rp = this.camera.tileCenter(right.x, right.y, size);
      return lp.y - rp.y || lp.x - rp.x;
    });

    for (const command of commands) this.drawBlock(this.objectLayer, command, size);
  }

  private drawVehicles(core: SimulationCore): void {
    const size = this.worldSize(core);
    const graph = core.transportationGraph;
    const travelTicks = new Map(core.traffic.edgeMetrics.map((metric) => [metric.edgeId, metric.travelTimeTicks]));

    for (const vehicle of core.traffic.activeVehicles) {
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      if (!edgeId) continue;
      const edge = graph.getEdge(edgeId);
      if (!edge) continue;
      const from = graph.getNode(edge.from);
      const to = graph.getNode(edge.to);
      if (!from || !to) continue;
      const edgeTicks = travelTicks.get(edge.id) ?? edge.freeFlowTicks;
      const progress = vehicle.status === 'queued'
        ? 1
        : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, edgeTicks)));
      this.drawVehicleMarker(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        size,
        vehicle.status === 'queued' ? '#ffd166' : '#f5f5f4',
        2.6,
      );
    }

    for (const vehicle of core.serviceVehicles.listVehicles()) {
      if (vehicle.state === 'idle' || vehicle.state === 'unavailable') continue;
      const edgeId = vehicle.edgeIds[vehicle.currentEdgeIndex];
      const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      if (!edge) continue;
      const from = graph.getNode(edge.from);
      const to = graph.getNode(edge.to);
      if (!from || !to) continue;
      const edgeTicks = travelTicks.get(edge.id) ?? edge.freeFlowTicks;
      const progress = vehicle.state === 'servicing'
        ? 1
        : Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, edgeTicks)));
      this.drawVehicleMarker(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        size,
        '#56cfe1',
        3.2,
      );
    }

    for (const vehicle of core.mobility.vehicles.listVehicles()) {
      if (vehicle.state === 'out_of_service' || vehicle.mode === 'metro') continue;
      const edgeId = vehicle.roadEdgeIds[vehicle.currentRoadEdgeIndex];
      const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      if (!edge) continue;
      const from = graph.getNode(edge.from);
      const to = graph.getNode(edge.to);
      if (!from || !to) continue;
      const edgeTicks = travelTicks.get(edge.id) ?? edge.freeFlowTicks;
      const progress = Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, edgeTicks)));
      this.drawVehicleMarker(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        size,
        '#9b8afb',
        3.5,
      );
    }

    for (const vehicle of core.economyDomain.freightVehicles.listVehicles()) {
      const edgeId = vehicle.routeEdgeIds[vehicle.currentEdgeIndex];
      const edge = edgeId ? graph.getEdge(edgeId) : undefined;
      if (!edge) continue;
      const from = graph.getNode(edge.from);
      const to = graph.getNode(edge.to);
      if (!from || !to) continue;
      const edgeTicks = travelTicks.get(edge.id) ?? edge.freeFlowTicks;
      const progress = Math.max(0, Math.min(1, vehicle.edgeProgressTicks / Math.max(1, edgeTicks)));
      this.drawVehicleMarker(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
        size,
        '#f0a35e',
        3.8,
      );
    }
  }

  private drawOverlayTint(
    core: SimulationCore,
    traffic: TrafficOverlayMode,
    service: ServiceOverlayMode,
    transit: TransitOverlayMode,
    economy: EconomyOverlayMode,
    urbanFabric: UrbanFabricOverlayMode,
    selectedParcelId: string | null,
  ): void {
    const activeColor = traffic !== 'none'
      ? OVERLAY_COLORS.traffic
      : service !== 'none'
        ? OVERLAY_COLORS.service
        : transit !== 'none'
          ? OVERLAY_COLORS.transit
          : economy !== 'none'
            ? OVERLAY_COLORS.economy
            : urbanFabric !== 'none'
              ? OVERLAY_COLORS.urbanFabric
              : null;
    if (!activeColor) return;

    const size = this.worldSize(core);
    for (let y = 0; y < core.terrain.height; y += 1) {
      for (let x = 0; x < core.terrain.width; x += 1) {
        this.fillDiamond(this.overlayLayer, this.camera.tilePolygon(x, y, size), activeColor, 0.055);
      }
    }

    if (urbanFabric !== 'none' && selectedParcelId) {
      const parcel = core.cadastre.getParcel(selectedParcelId);
      if (parcel) {
        const points = parcel.polygon.map((point) => this.worldMetersToCanvas(point, core));
        if (points.length >= 3) this.strokePolygon(this.overlayLayer, points, '#ffe7f7', 3, 0.95);
      }
    }
  }

  private drawSelection(core: SimulationCore, selected: CellSelection, previewPath: readonly CellCoord[]): void {
    const size = this.worldSize(core);
    for (const cell of previewPath) {
      this.fillDiamond(
        this.selectionLayer,
        this.camera.tilePolygon(cell.x, cell.y, size),
        '#f5c45f',
        0.3,
        '#ffe29a',
        0.7,
        Math.max(1, 1.5 * this.camera.zoom),
      );
    }
    if (!selected) return;
    this.fillDiamond(
      this.selectionLayer,
      this.camera.tilePolygon(selected.x, selected.y, size),
      '#ffffff',
      0.08,
      '#ffffff',
      0.95,
      Math.max(1.5, 2 * this.camera.zoom),
    );
  }

  private drawBlock(graphics: Graphics, command: BlockCommand, size: RendererWorldSize): void {
    const base = this.camera.tilePolygon(command.x, command.y, size);
    if (base.length < 4) return;
    const top = base.map((point) => ({ x: point.x, y: point.y - command.height }));
    const eastSide = [base[1]!, base[2]!, top[2]!, top[1]!];
    const westSide = [base[2]!, base[3]!, top[3]!, top[2]!];
    this.fillPolygon(graphics, westSide, command.leftColor, 1, command.outlineColor, 0.5, 1);
    this.fillPolygon(graphics, eastSide, command.rightColor, 1, command.outlineColor, 0.5, 1);
    this.fillPolygon(graphics, top, command.topColor, 1, command.outlineColor, 0.72, 1);
  }

  private drawVehicleMarker(
    x: number,
    y: number,
    size: RendererWorldSize,
    color: string,
    radius: number,
  ): void {
    const point = this.camera.worldToCanvas(x, y, size);
    this.vehicleLayer
      .circle(point.x, point.y - 2 * this.camera.zoom, Math.max(1.5, radius * this.camera.zoom))
      .fill({ color, alpha: 0.96 })
      .stroke({ color: '#1d2528', alpha: 0.75, width: Math.max(0.8, this.camera.zoom) });
  }

  private fillDiamond(
    graphics: Graphics,
    points: readonly GpuPoint[],
    color: string,
    alpha: number,
    strokeColor?: string,
    strokeAlpha = 0,
    strokeWidth = 1,
  ): void {
    this.fillPolygon(graphics, points, color, alpha, strokeColor, strokeAlpha, strokeWidth);
  }

  private fillPolygon(
    graphics: Graphics,
    points: readonly GpuPoint[],
    color: string,
    alpha: number,
    strokeColor?: string,
    strokeAlpha = 0,
    strokeWidth = 1,
  ): void {
    if (points.length < 3) return;
    graphics.poly(points.flatMap((point) => [point.x, point.y])).fill({ color, alpha });
    if (strokeColor && strokeAlpha > 0) {
      graphics.stroke({ color: strokeColor, alpha: strokeAlpha, width: strokeWidth });
    }
  }

  private strokePolygon(
    graphics: Graphics,
    points: readonly GpuPoint[],
    color: string,
    width: number,
    alpha: number,
  ): void {
    if (points.length < 2) return;
    const closed = [...points, points[0]!];
    graphics.poly(closed.flatMap((point) => [point.x, point.y])).stroke({ color, width, alpha });
  }

  private worldSize(core: SimulationCore): RendererWorldSize {
    const size = { width: core.terrain.width, height: core.terrain.height };
    this.lastWorldSize = size;
    return size;
  }
}
