import { Application, Container, Graphics } from 'pixi.js';
import type { SimulationCore } from '../../simulation/core/SimulationCore.ts';
import { LEGACY_CELL_SIZE_METERS, type WorldPoint } from '../../world/cadastre/Geometry.ts';
import type { EconomyOverlayMode } from '../EconomyOverlayLayer.ts';
import type { ServiceOverlayMode } from '../ServiceOverlayLayer.ts';
import type { TrafficOverlayMode } from '../TrafficOverlayLayer.ts';
import type { TransitOverlayMode } from '../TransitOverlayLayer.ts';
import type { UrbanFabricOverlayMode } from '../CadastralOverlayLayer.ts';
import { PASS_A_ASSET_MANIFEST } from '../assets/PassAAssetManifest.ts';
import { IsometricCamera } from '../isometric/IsometricCamera.ts';
import { buildBaseSpriteCommands, type BaseSpriteCommand } from './BaseSpriteCommands.ts';
import { GpuAssetRegistry } from './GpuAssetRegistry.ts';
import { RetainedSpriteLayer } from './RetainedSpriteLayer.ts';
import { RetainedVehicleLayer } from './RetainedVehicleLayer.ts';
import { buildVehicleSpriteCommands } from './VehicleSpriteCommands.ts';

export type GpuPoint = Readonly<{ x: number; y: number }>;
export type CellSelection = Readonly<{ x: number; y: number }> | null;
type RendererWorldSize = Readonly<{ width: number; height: number }>;
type CellCoord = Readonly<{ x: number; y: number }>;

const ZONE_COLORS: Readonly<Record<string, string>> = Object.freeze({
  residential: '#53b566',
  commercial: '#4987d7',
  industrial: '#cc9946',
});

const OVERLAY_COLORS = Object.freeze({
  traffic: '#ef6f6c',
  service: '#5bc0be',
  transit: '#8f7ee7',
  economy: '#f3bd59',
  urbanFabric: '#df78c8',
});

export type GpuSceneStats = Readonly<{
  staticActive: number;
  staticCreated: number;
  staticUpdated: number;
  staticRemoved: number;
  vehicleActive: number;
  vehicleCreated: number;
  vehicleReused: number;
  vehiclePooled: number;
}>;

// Presentation-only facade. Authoritative state remains inside SimulationCore.
export class GpuWorldRenderer {
  readonly canvas: HTMLCanvasElement;
  private readonly camera = new IsometricCamera();
  private readonly application = new Application();
  private readonly assets = new GpuAssetRegistry(PASS_A_ASSET_MANIFEST);
  private readonly scene = new Container();
  private readonly terrainContainer = new Container();
  private readonly terrainEffectsLayer = new Graphics();
  private readonly zoningLayer = new Graphics();
  private readonly roadContainer = new Container();
  private readonly roadEffectsLayer = new Graphics();
  private readonly objectContainer = new Container();
  private readonly vehicleContainer = new Container();
  private readonly overlayLayer = new Graphics();
  private readonly selectionLayer = new Graphics();
  private readonly terrainSprites = new RetainedSpriteLayer(this.terrainContainer, this.assets);
  private readonly roadSprites = new RetainedSpriteLayer(this.roadContainer, this.assets);
  private readonly objectSprites = new RetainedSpriteLayer(this.objectContainer, this.assets);
  private readonly vehicleSprites = new RetainedVehicleLayer(this.vehicleContainer, this.assets);
  private readonly initializationPromise: Promise<void>;
  private initialized = false;
  private initializationError: string | null = null;
  private lastWorldSize: RendererWorldSize | null = null;
  private urbanFabricOverlayMode: UrbanFabricOverlayMode = 'none';
  private urbanFabricSelectedParcelId: string | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.initializationPromise = this.initialize().catch((error: unknown) => {
      this.initializationError = error instanceof Error ? error.message : String(error);
    });
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
    await this.initializationPromise;
    if (this.initializationError) throw new Error(`GPU renderer initialization failed: ${this.initializationError}`);
  }

  assetDiagnostics(): readonly string[] {
    const diagnostics = [...this.assets.diagnostics()];
    if (this.initializationError) diagnostics.push(`renderer initialization failed: ${this.initializationError}`);
    return Object.freeze(diagnostics.sort());
  }

  debugSceneStats(): GpuSceneStats {
    const stats = [this.terrainSprites.stats(), this.roadSprites.stats(), this.objectSprites.stats()];
    const vehicle = this.vehicleSprites.stats();
    return Object.freeze({
      staticActive: stats.reduce((sum, item) => sum + item.active, 0),
      staticCreated: stats.reduce((sum, item) => sum + item.created, 0),
      staticUpdated: stats.reduce((sum, item) => sum + item.updated, 0),
      staticRemoved: stats.reduce((sum, item) => sum + item.removed, 0),
      vehicleActive: vehicle.active,
      vehicleCreated: vehicle.created,
      vehicleReused: vehicle.reused,
      vehiclePooled: vehicle.pooled,
    });
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
    const size = this.worldSize(core);
    if (!this.initialized || !this.assets.ready) return;

    const rect = this.canvas.getBoundingClientRect();
    const viewport = { width: rect.width, height: rect.height };
    const commands = buildBaseSpriteCommands(core, this.camera.quarterTurns);
    this.syncBaseSprites(commands, size, viewport);
    this.vehicleSprites.sync(
      buildVehicleSpriteCommands(core, this.camera.quarterTurns),
      this.camera,
      size,
    );

    this.terrainEffectsLayer.clear();
    this.zoningLayer.clear();
    this.roadEffectsLayer.clear();
    this.overlayLayer.clear();
    this.selectionLayer.clear();

    this.drawTerrainEffects(core);
    this.drawZoning(core);
    this.drawRoadDetails(core);
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
    await this.assets.preload();

    this.scene.addChild(
      this.terrainContainer,
      this.terrainEffectsLayer,
      this.zoningLayer,
      this.roadContainer,
      this.roadEffectsLayer,
      this.objectContainer,
      this.vehicleContainer,
      this.overlayLayer,
      this.selectionLayer,
    );
    this.application.stage.addChild(this.scene);
    this.initialized = true;
  }

  private syncBaseSprites(
    commands: readonly BaseSpriteCommand[],
    size: RendererWorldSize,
    viewport: Readonly<{ width: number; height: number }>,
  ): void {
    this.terrainSprites.sync(
      commands.filter((item) => item.category === 'terrain'),
      this.camera,
      size,
      viewport,
    );
    this.roadSprites.sync(
      commands.filter((item) => item.category === 'road'),
      this.camera,
      size,
      viewport,
    );
    this.objectSprites.sync(
      commands.filter((item) => item.category !== 'terrain' && item.category !== 'road'),
      this.camera,
      size,
      viewport,
    );
  }

  private drawTerrainEffects(core: SimulationCore): void {
    const size = this.worldSize(core);
    for (let y = 0; y < core.terrain.height; y += 1) {
      for (let x = 0; x < core.terrain.width; x += 1) {
        const terrain = core.terrain.get(x, y);
        if (!terrain.buildable && !terrain.water) {
          this.fillDiamond(this.terrainEffectsLayer, this.camera.tilePolygon(x, y, size), '#ffffff', 0.07);
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

  private drawRoadDetails(core: SimulationCore): void {
    if (this.camera.zoom < 1.6) return;
    const size = this.worldSize(core);
    for (const road of core.roads.list()) {
      const polygon = this.camera.tilePolygon(road.x, road.y, size);
      this.strokePolygon(this.roadEffectsLayer, polygon, '#ffffff', 1, 0.035);
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

    if (urbanFabric !== 'none' && selectedParcelId && core.cadastre.getParcel(selectedParcelId)) {
      const points = core.cadastre
        .parcelPolygon(selectedParcelId)
        .map((point) => this.worldMetersToCanvas(point, core));
      if (points.length >= 3) this.strokePolygon(this.overlayLayer, points, '#ffe7f7', 3, 0.95);
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
